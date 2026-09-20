import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB } from "@/data/db";

// KB-111: receipt number allocation (02-ARCHITECTURE.md section 4).
// KB-110 already built the generic hybrid sync mechanics for
// receipt_number_blocks (pull newly-reserved blocks, push a locally
// mutated nextNumber). This file is the actual allocation POLICY on top
// of that: reserve, consume, and the offline-exhaustion fallback.

const BLOCK_SIZE = 50;
const RESERVE_THRESHOLD = 10;
const FALLBACK_COUNTER_KEY = "receiptNumberFallback";

function formatBlockNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

/**
 * The full device UUID, not a truncated prefix - see 07-DECISIONS.md D23.
 * A shortened prefix's birthday-paradox collision probability looks low
 * in isolation, but the fallback counter below is device-local and
 * starts fresh each time a device enters exhaustion mode - a prefix
 * collision between two devices would produce a near-certain immediate
 * duplicate, not just a small chance of one, since the two counters
 * aren't independent once the prefixes match. The full UUID's collision
 * probability is cryptographically negligible instead of merely
 * statistically low.
 */
function formatFallbackNumber(prefix: string, deviceId: string, n: number): string {
  return `${prefix}-${deviceId}-${n}`;
}

/**
 * Reserves the next 50-number block for a shop. Plain SELECT-then-INSERT,
 * not an atomic RPC - a deliberate MVP simplification (07-DECISIONS.md
 * D22), not an oversight. The real race window: two devices reserving
 * for the same shop within the same query round-trip could both read the
 * same max(block_end) and insert overlapping ranges. Accepted because
 * Offline Level 4 (multi-device concurrent use) is explicitly out of
 * scope for this project's MVP. Revisit before any multi-device support
 * ships - not discovered via a real collision during the pilot.
 */
export async function reserveBlock(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
): Promise<void> {
  const { data: existing, error: maxError } = await client
    .from("receipt_number_blocks")
    .select("block_end")
    .eq("shop_id", shopId)
    .order("block_end", { ascending: false })
    .limit(1);

  if (maxError) {
    console.warn(`[receiptNumbers] reserveBlock: failed to read existing blocks: ${maxError.message}`);
    return;
  }

  const blockStart = ((existing?.[0]?.block_end as number | undefined) ?? 0) + 1;
  const blockEnd = blockStart + BLOCK_SIZE - 1;
  const allocatedAt = new Date().toISOString();

  const { data, error } = await client
    .from("receipt_number_blocks")
    .insert({
      shop_id: shopId,
      device_id: deviceId,
      block_start: blockStart,
      block_end: blockEnd,
      next_number: blockStart,
      allocated_at: allocatedAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.warn(`[receiptNumbers] reserveBlock: insert failed: ${error?.message}`);
    return;
  }

  // Optimistic local write: this block was just successfully created via
  // a real online round-trip, so it's already synced - no need to wait
  // for KB-110's next pull cycle to be able to use it immediately.
  await localDb.receiptNumberBlocks.put({
    id: data.id,
    shopId,
    deviceId,
    blockStart,
    blockEnd,
    nextNumber: blockStart,
    allocatedAt,
    syncStatus: "synced",
  });
}

interface AllocatedReceiptNumber {
  receiptNumber: string;
  source: "block" | "fallback";
}

/**
 * Consumes the next number from the shop's active local block. If no
 * block has numbers remaining, falls back to a device-scoped, ever-
 * incrementing local counter (never a server round-trip - this is
 * exactly the offline-exhaustion path). Never blocks billing (hard rule
 * 5/6) - a background reservation is fired, not awaited, when remaining
 * numbers drop below the threshold.
 */
export async function consumeNextNumber(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
): Promise<AllocatedReceiptNumber> {
  const shop = await localDb.shops.get(shopId);
  const prefix = shop?.receiptPrefix ?? "KB";

  const blocks = await localDb.receiptNumberBlocks.where("shopId").equals(shopId).sortBy("blockStart");
  const activeBlock = blocks.find((b) => b.nextNumber <= b.blockEnd);

  if (!activeBlock) {
    return { receiptNumber: await allocateFallbackNumber(localDb, deviceId, prefix), source: "fallback" };
  }

  const number = activeBlock.nextNumber;
  const newNextNumber = number + 1;
  await localDb.receiptNumberBlocks.update(activeBlock.id, {
    nextNumber: newNextNumber,
    syncStatus: "pending",
  });

  const remaining = activeBlock.blockEnd - newNextNumber + 1;
  if (remaining < RESERVE_THRESHOLD && navigator.onLine) {
    // Fire-and-forget: reserving proactively must never block finalising
    // this bill.
    void reserveBlock(client, localDb, shopId, deviceId);
  }

  return { receiptNumber: formatBlockNumber(prefix, number), source: "block" };
}

/**
 * A device-local, ever-incrementing counter, distinct from any block -
 * reused from the generic syncState table (tableName as a key, pendingCount
 * repurposed as the counter value) rather than adding a new Dexie table
 * for a single number. Never touches the server - this is the path that
 * exists specifically because the server is unreachable.
 */
async function allocateFallbackNumber(localDb: KiranaBillDB, deviceId: string, prefix: string): Promise<string> {
  const state = await localDb.syncState.get(FALLBACK_COUNTER_KEY);
  const next = (state?.pendingCount ?? 0) + 1;

  // Deliberate special-cased overload of syncState's schema for a single
  // device-local counter under a fake "tableName" - NOT a real per-table
  // sync entry. pendingCount means something specific everywhere else in
  // this table (rows waiting to sync); here it's repurposed as a raw
  // integer counter. Flagged explicitly so a future reader of the real
  // syncState rows doesn't assume this one means the same thing.
  await localDb.syncState.put({
    tableName: FALLBACK_COUNTER_KEY,
    lastSyncedAt: null,
    cursor: null,
    pendingCount: next,
  });

  return formatFallbackNumber(prefix, deviceId, next);
}
