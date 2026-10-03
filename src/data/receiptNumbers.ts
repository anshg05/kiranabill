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

/** This device's block with numbers left (D38: never another install's). */
async function activeBlockOf(localDb: KiranaBillDB, shopId: string, deviceId: string) {
  // KB-315 (D38): only a block THIS device reserved. Another install's block
  // (e.g. from before an IndexedDB wipe) may have numbers that install already
  // used offline and never pushed - consuming it could reissue them.
  const blocks = await localDb.receiptNumberBlocks.where("shopId").equals(shopId).sortBy("blockStart");
  return blocks.find((b) => b.deviceId === deviceId && b.nextNumber <= b.blockEnd);
}

/**
 * KB-307: takes the next number from this device's active block, or the D23
 * fallback counter when there is none (the offline-exhaustion path). LOCAL
 * tables only (receiptNumberBlocks, syncState, shops) - so it can run inside
 * finalise's Dexie transaction, and a failed finalise rolls the number back
 * with everything else. No network, nothing fired: topping the block up is
 * the caller's job after the commit (topUpReceiptBlock).
 */
export async function takeNextNumber(localDb: KiranaBillDB, shopId: string, deviceId: string): Promise<AllocatedReceiptNumber> {
  const shop = await localDb.shops.get(shopId);
  const prefix = shop?.receiptPrefix ?? "KB";
  const activeBlock = await activeBlockOf(localDb, shopId, deviceId);
  if (!activeBlock) {
    return { receiptNumber: await allocateFallbackNumber(localDb, deviceId, prefix), source: "fallback" };
  }
  const number = activeBlock.nextNumber;
  await localDb.receiptNumberBlocks.update(activeBlock.id, { nextNumber: number + 1, syncStatus: "pending" });
  return { receiptNumber: formatBlockNumber(prefix, number), source: "block" };
}

/** Fewer than RESERVE_THRESHOLD numbers left in this device's block, or no block at all. */
export async function blockNeedsTopUp(localDb: KiranaBillDB, shopId: string, deviceId: string): Promise<boolean> {
  const activeBlock = await activeBlockOf(localDb, shopId, deviceId);
  return !activeBlock || activeBlock.blockEnd - activeBlock.nextNumber + 1 < RESERVE_THRESHOLD;
}

/** KB-307: after a bill is committed - reserve the next block if this one is
 * running low and we're online. Never awaited by finalising; a failure only
 * means the next bill may use a fallback number (never blocks billing). */
export async function topUpReceiptBlock(client: SupabaseClient, localDb: KiranaBillDB, shopId: string, deviceId: string): Promise<void> {
  if (navigator.onLine && (await blockNeedsTopUp(localDb, shopId, deviceId))) {
    await reserveBlock(client, localDb, shopId, deviceId);
  }
}

/**
 * takeNextNumber + a background top-up - for callers outside a transaction
 * (receipt-number tests, e2e). Finalise uses takeNextNumber inside its
 * transaction and tops up after the commit instead.
 */
export async function consumeNextNumber(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
): Promise<AllocatedReceiptNumber> {
  const taken = await takeNextNumber(localDb, shopId, deviceId);
  // Fire-and-forget: reserving proactively must never block this bill.
  if (taken.source === "block") void topUpReceiptBlock(client, localDb, shopId, deviceId);
  return taken;
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
