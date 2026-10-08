import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/data/supabaseClient";
import type { KiranaBillDB, LocalBill, LocalBillItem, SyncStatus } from "@/data/db";
import { billSearchRowOf } from "@/data/db";
import type { BillSearchRow } from "@/domain/billSearch";
import { emitBillsPull, noteBillsWritten } from "@/data/billsPullStatus";

// KB-110: the sync worker. Not a literal Web Worker - a main-thread async
// loop (setInterval + online/offline listeners + a manual syncNow()).
// Nothing in 11-STACK-DECISIONS.md mandates a dedicated Worker thread, and
// the UI already never blocks on the network by design (02-ARCHITECTURE.md
// section 2) - a real Worker would add message-passing overhead for no
// stated benefit.

const BASE_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * KB-110b: which failures are PERMANENT (mark the row `conflict`, stop
 * retrying) and which are TRANSIENT (leave it `pending`, back off, retry).
 * Shared by every push function in this file.
 *
 * This used to be `code.length === 5` - "any real SQLSTATE is permanent".
 * That stranded a real bill as `conflict` on a momentary database hiccup:
 * deadlock (40P01), serialization failure (40001), statement timeout (57014),
 * connection trouble (08xxx), resource exhaustion (53xxx) and lock-not-
 * available (55P03) are all 5-character SQLSTATEs and all transient.
 *
 * Now an explicit list. PERMANENT - the same request will fail the same way
 * forever: RLS/permission (42501), a trigger raise (P0001), integrity
 * violations (23xxx: 23505 unique, 23503 FK, 23502 not-null, 23514 check),
 * data exceptions (22xxx: 22P02 bad uuid/number, ...), and push_bill's own
 * KB400 (a draft was pushed - a client bug) / KB409 (the server already has
 * different content for this bill) / KB422 (KB-307, KI-41: a final or
 * cancelled bill with no items, or totals that don't add up).
 *
 * Everything else is TRANSIENT, including codes this list has never seen:
 * a retrying bill is recoverable, a false `conflict` is not (docs/07-
 * DECISIONS.md D37). Unknown codes are logged so they can be classified.
 * No code at all = a network-layer failure = transient.
 */
const PERMANENT_CODES = new Set(["42501", "P0001", "KB400", "KB409", "KB422"]);
const KNOWN_TRANSIENT_PREFIXES = ["08", "40", "53", "57"];

export function isPermanentError(error: PostgrestError | null): boolean {
  const code = error?.code;
  if (typeof code !== "string" || code.length === 0) return false;
  if (PERMANENT_CODES.has(code)) return true;
  if (code.length === 5 && (code.startsWith("23") || code.startsWith("22"))) return true;
  const knownTransient =
    code.startsWith("PGRST") || code === "55P03" || (code.length === 5 && KNOWN_TRANSIENT_PREFIXES.some((p) => code.startsWith(p)));
  if (!knownTransient) {
    console.warn(`[sync] unclassified error code ${code} - treated as transient (retrying): ${error?.message}`);
  }
  return false;
}

interface PushResult {
  anyTransientFailure: boolean;
}

/**
 * price_observations and learning_events are append-only by design
 * (03-DATA-MODEL.md section 5) and have ONLY select/insert RLS policies -
 * no update policy at all (confirmed directly against
 * supabase/migrations/20260920095526_rls.sql). .upsert() issues
 * INSERT ... ON CONFLICT DO UPDATE, and a retry of an already-successful
 * insert (the response to the first attempt was lost, but the row landed)
 * hits that DO UPDATE branch on the conflicting row - which RLS rejects
 * outright (there is no update policy to satisfy), surfacing as a genuine
 * 42501 and getting the row wrongly marked "conflict" even though it had
 * already synced correctly.
 *
 * Fixed by using a plain .insert() for these two tables and treating a
 * 23505 (unique_violation on the (shop_id, local_id) constraint) as
 * SUCCESS, not a failure of any kind - it means a previous attempt's
 * insert landed even though its confirmation never reached this device.
 * The existing row is re-fetched by (shop_id, local_id) to recover its
 * real server id, since a duplicate-key insert returns no row of its own.
 */
async function insertAppendOnly(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  shopId: string,
  localId: string,
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const inserted = await client.from(table).insert(row).select("id").single();
  if (!inserted.error) {
    return { data: inserted.data as { id: string }, error: null };
  }

  if (inserted.error.code === "23505") {
    const existing = await client
      .from(table)
      .select("id")
      .eq("shop_id", shopId)
      .eq("local_id", localId)
      .single();
    return { data: existing.data as { id: string } | null, error: existing.error };
  }

  return { data: null, error: inserted.error };
}

function mergeResults(results: PushResult[]): PushResult {
  return { anyTransientFailure: results.some((r) => r.anyTransientFailure) };
}

/**
 * Logs a discarded local edit somewhere durable - the last-write-wins
 * rule (02-ARCHITECTURE.md section 2) stays exactly as specified, this
 * only makes sure "silently" doesn't also mean "unrecoverably
 * untraceable." Structured console.warn, not a UI surface - the doc is
 * explicit that this kind of conflict never blocks or alarms the user.
 */
function logDiscardedEdit(params: {
  table: string;
  id: string;
  discardedLocal: unknown;
  wonRemote: unknown;
}): void {
  console.warn(
    `[sync] last-write-wins: discarded local edit on ${params.table} id=${params.id}`,
    { discardedLocal: params.discardedLocal, wonRemote: params.wonRemote },
  );
}

// ---------------------------------------------------------------------
// Phase 1: push bills - awaited to completion before phase 2
// (learningEvents) ever starts, so a learningEvent can never be checked
// against a parent bill push that hasn't resolved yet this cycle.
//
// KB-110b (docs/07-DECISIONS.md D37, docs/12-PARKED.md KI-29): each bill and
// ALL its items go up in ONE call to the push_bill() Postgres function
// (SECURITY INVOKER - RLS stays the boundary), which inserts the bill as
// draft, inserts the items, then finalises - in one transaction. The old
// path upserted the bill as "final" first and inserted items after, which
// bill_items_immutability always rejected, and whose retry then hit
// bills_immutability (final->final) and marked the bill conflict with zero
// items server-side. push_bill also makes a lost-response retry a no-op
// success (identical content -> same id) and a divergent one a KB409.
//
// Only final and cancelled bills are pushed. Drafts stay on the device
// (D37): bills.receipt_number is NOT NULL and a draft has no number yet.
// ---------------------------------------------------------------------

export async function pushBills(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = (await localDb.bills.where("syncStatus").equals("pending").sortBy("createdAt")).filter(
    (bill) => bill.status === "final" || bill.status === "cancelled",
  );
  let anyTransientFailure = false;

  for (const bill of pending) {
    const items = await localDb.billItems.where("billLocalId").equals(bill.localId).sortBy("lineNo");

    const { data, error } = await client.rpc("push_bill", {
      p_bill: {
        shop_id: bill.shopId,
        local_id: bill.localId,
        receipt_number: bill.receiptNumber,
        receipt_number_source: bill.receiptNumberSource,
        customer_name: bill.customerName,
        customer_mobile: bill.customerMobile,
        subtotal_paise: bill.subtotalPaise,
        total_paise: bill.totalPaise,
        status: bill.status,
        schema_version: bill.schemaVersion,
        device_id: bill.deviceId,
        created_at: bill.createdAt,
        finalized_at: bill.finalizedAt,
      },
      p_items: items.map((item) => ({
        line_no: item.lineNo,
        shop_product_id: item.shopProductId,
        display_name: item.displayName,
        spoken_name: item.spokenName,
        qty: item.qty,
        unit: item.unit,
        rate_paise: item.ratePaise,
        rate_unit: item.rateUnit,
        total_paise: item.totalPaise,
        price_type: item.priceType,
        source: item.source,
        review_flags: item.reviewFlags,
        was_edited: item.wasEdited,
      })),
    });

    if (error || typeof data !== "string") {
      if (isPermanentError(error)) {
        await localDb.bills.update(bill.localId, { syncStatus: "conflict" as SyncStatus });
        // KB-306 (owner): only which bill and the error code - never the bill, its
        // items or Postgres' message/details (a CHECK failure echoes the row:
        // customer names and numbers are personal data, DPDP Act 2023).
        console.warn(`[sync] bills: permanent failure for localId=${bill.localId}: ${error?.code ?? "no code"}`);
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.bills.update(bill.localId, {
      syncStatus: "synced" as SyncStatus,
      serverId: data,
      syncedAt: new Date().toISOString(),
    });
  }

  return { anyTransientFailure };
}

// ---------------------------------------------------------------------
// Phase 2: learningEvents. Only ever attempted after phase 1 has fully
// resolved (see syncNow() below) - billLocalId -> serverId lookups here
// read whatever pushBills() just wrote to localDb.bills, never a
// same-cycle push that's still in flight.
// ---------------------------------------------------------------------

export async function pushLearningEvents(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.learningEvents.where("syncStatus").equals("pending").sortBy("createdAt");
  let anyTransientFailure = false;

  for (const event of pending) {
    const parentBill = await localDb.bills.get(event.billLocalId);
    if (!parentBill?.serverId) {
      // Parent hasn't synced yet - not an error, not a retry-with-backoff.
      // Resolves itself next cycle once the bill syncs.
      continue;
    }

    const { data, error } = await insertAppendOnly(
      client,
      "learning_events",
      {
        shop_id: event.shopId,
        local_id: event.localId,
        bill_id: parentBill.serverId,
        event_type: event.eventType,
        payload: event.payload,
        created_at: event.createdAt,
        device_id: event.deviceId,
      },
      event.shopId,
      event.localId,
    );

    if (error || !data) {
      if (isPermanentError(error)) {
        await localDb.learningEvents.update(event.localId, { syncStatus: "conflict" as SyncStatus });
        console.warn(
          `[sync] learningEvents: permanent failure for localId=${event.localId}: ${error?.code} ${error?.message}`,
        );
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.learningEvents.update(event.localId, {
      syncStatus: "synced" as SyncStatus,
      serverId: data.id,
      updatedAt: new Date().toISOString(),
    });
  }

  return { anyTransientFailure };
}

// ---------------------------------------------------------------------
// The other push-first tables: independent of bill serverIds, so they
// don't need their own phase relative to bills/learningEvents - only
// learningEvents has that dependency.
// ---------------------------------------------------------------------

export async function pushLearnedAliases(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.learnedAliases.where("syncStatus").equals("pending").sortBy("updatedAt");
  let anyTransientFailure = false;

  for (const alias of pending) {
    const { data, error } = await client
      .from("learned_aliases")
      .upsert(
        {
          shop_id: alias.shopId,
          local_id: alias.localId,
          alias: alias.alias,
          shop_product_id: alias.shopProductId,
          hit_count: alias.hitCount,
          confidence: alias.confidence,
          source: alias.source,
          device_id: alias.deviceId,
        },
        { onConflict: "shop_id,local_id" },
      )
      .select("id")
      .single();

    if (error || !data) {
      if (isPermanentError(error)) {
        await localDb.learnedAliases.update(alias.localId, { syncStatus: "conflict" });
        console.warn(
          `[sync] learned_aliases: permanent failure for localId=${alias.localId}: ${error?.code} ${error?.message}`,
        );
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.learnedAliases.update(alias.localId, {
      syncStatus: "synced",
      serverId: data.id,
      updatedAt: new Date().toISOString(),
    });
  }

  return { anyTransientFailure };
}

export async function pushProvisionalProducts(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.provisionalProducts.where("syncStatus").equals("pending").sortBy("updatedAt");
  let anyTransientFailure = false;

  for (const product of pending) {
    const { data, error } = await client
      .from("provisional_products")
      .upsert(
        {
          shop_id: product.shopId,
          local_id: product.localId,
          spoken_name: product.spokenName,
          seen_count: product.seenCount,
          suggested_unit: product.suggestedUnit,
          suggested_price_paise: product.suggestedPricePaise,
          promoted_at: product.promotedAt,
          promoted_shop_product_id: product.promotedShopProductId,
          device_id: product.deviceId,
        },
        { onConflict: "shop_id,local_id" },
      )
      .select("id")
      .single();

    if (error || !data) {
      if (isPermanentError(error)) {
        await localDb.provisionalProducts.update(product.localId, { syncStatus: "conflict" });
        console.warn(
          `[sync] provisional_products: permanent failure for localId=${product.localId}: ${error?.code} ${error?.message}`,
        );
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.provisionalProducts.update(product.localId, {
      syncStatus: "synced",
      serverId: data.id,
      updatedAt: new Date().toISOString(),
    });
  }

  return { anyTransientFailure };
}

export async function pushPriceObservations(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.priceObservations.where("syncStatus").equals("pending").sortBy("updatedAt");
  let anyTransientFailure = false;

  for (const observation of pending) {
    const { data, error } = await insertAppendOnly(
      client,
      "price_observations",
      {
        shop_id: observation.shopId,
        local_id: observation.localId,
        shop_product_id: observation.shopProductId,
        observed_price_paise: observation.observedPricePaise,
        occurred_at: observation.occurredAt,
        device_id: observation.deviceId,
      },
      observation.shopId,
      observation.localId,
    );

    if (error || !data) {
      if (isPermanentError(error)) {
        await localDb.priceObservations.update(observation.localId, { syncStatus: "conflict" });
        console.warn(
          `[sync] price_observations: permanent failure for localId=${observation.localId}: ${error?.code} ${error?.message}`,
        );
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.priceObservations.update(observation.localId, {
      syncStatus: "synced",
      serverId: data.id,
      updatedAt: new Date().toISOString(),
    });
  }

  return { anyTransientFailure };
}

// ---------------------------------------------------------------------
// Read-cache (pull-only): shopProducts, baseProducts. Never pushed - a
// local edit to these tables should never exist (KB-109's type shapes
// don't even have a syncStatus field to set one "pending" in the first
// place).
// ---------------------------------------------------------------------

// KB-315: the pull cursor is kept PER SHOP (it used to be one global
// "shopProducts" key - a second shop on the same database would have skipped
// every product older than the first shop's cursor).
function shopProductsCursorKey(shopId: string): string {
  return `shopProducts:${shopId}`;
}

// KB-311: updated_at is the server's now() - the time the writing transaction
// STARTED, not when it committed. A slow transaction from another device can
// commit after this device's cursor already passed its updated_at; "> cursor"
// alone would skip that row forever. So every pull re-reads the last minute
// before the cursor (bulkPut by id makes the re-read rows harmless).
export const SHOP_PRODUCTS_PULL_OVERLAP_MS = 60_000;

export async function pullShopProducts(client: SupabaseClient, localDb: KiranaBillDB, shopId: string): Promise<void> {
  const state = await localDb.syncState.get(shopProductsCursorKey(shopId));
  const cursor = state?.lastSyncedAt ?? null;

  let query = client.from("shop_products").select("*").eq("shop_id", shopId);
  if (cursor) query = query.gt("updated_at", new Date(new Date(cursor).getTime() - SHOP_PRODUCTS_PULL_OVERLAP_MS).toISOString());
  const { data, error } = await query;
  if (error || !data) {
    console.warn(`[sync] shopProducts pull failed: ${error?.message}`);
    return;
  }

  await localDb.shopProducts.bulkPut(
    data.map((row) => ({
      id: row.id,
      shopId: row.shop_id,
      baseProductId: row.base_product_id,
      displayName: row.display_name,
      category: row.category,
      unit: row.unit,
      pricePaise: row.price_paise,
      aliases: row.aliases,
      source: row.source,
      useCount: row.use_count,
      sku: row.sku,
      barcode: row.barcode,
      isActive: row.is_active,
    })),
  );

  const newestUpdatedAt = data.reduce<string | null>(
    (max, row) => (max === null || row.updated_at > max ? row.updated_at : max),
    cursor,
  );
  await localDb.syncState.put({
    tableName: shopProductsCursorKey(shopId),
    lastSyncedAt: newestUpdatedAt,
    cursor: null,
    pendingCount: 0,
  });
}

/**
 * base_products has no updated_at column at all (checked directly against
 * supabase/migrations/20260920154306_seed_base_products.sql) - it is a
 * rarely-reseeded global catalog, not an actively-mutated one, so there is
 * no cursor to do an incremental pull against. Known, deliberate
 * limitation: this pulls the FULL table once, only when the local cache
 * is empty (first run) - it will not pick up a later re-seed with a new
 * catalog_version without a schema change (adding updated_at) or a
 * manual cache-clear. Not solved here; flagged rather than silently
 * assumed to auto-refresh.
 */
export async function pullBaseProducts(client: SupabaseClient, localDb: KiranaBillDB): Promise<void> {
  const alreadyCached = (await localDb.baseProducts.count()) > 0;
  if (alreadyCached) return;

  const { data, error } = await client.from("base_products").select("*").eq("is_active", true);
  if (error || !data) {
    console.warn(`[sync] baseProducts pull failed: ${error?.message}`);
    return;
  }

  await localDb.baseProducts.bulkPut(
    data.map((row) => ({
      id: row.id,
      catalogVersion: row.catalog_version,
      displayName: row.display_name,
      sourceCategory: row.source_category,
      guardCategory: row.guard_category,
      defaultUnit: row.default_unit,
      suggestedPricePaise: row.suggested_price_paise,
      aliases: row.aliases,
      isActive: row.is_active,
    })),
  );
}

// ---------------------------------------------------------------------
// KB-324: pull bills. Bills were pushed, never pulled - a cleared phone, a new
// phone or a new draft address showed an empty History though the server had
// every bill. Finalised bills are immutable, so this is read-only: a bill that
// already exists locally (same local_id) is never touched.
//
// Two phases, both resumable (sync_state key `bills:<shopId>`):
//  1. BACKFILL - every bill, newest first, by keyset on (created_at, id), a page
//     at a time (so the recent bills show up first and an interrupted pull
//     resumes). Before it starts, the newest server `synced_at` is recorded as
//     the incremental cursor.
//  2. INCREMENTAL - `synced_at > cursor - 60 s` (D62's overlap). synced_at is the
//     SERVER's time (trigger, migration 20261009090000): created_at is the
//     device's, so a bill made offline yesterday and pushed today looks old.
//     Bills from before the migration have a null synced_at - the backfill
//     covers them.
// A pulled bill, its items and its billSearch row (D61) are written in one
// transaction. It is stored synced (never re-pushed) and with `pulledAt` (never
// teaches). It runs only inside a sync cycle (real session, D38) and only while
// the browser is online - offline it waits, no polling of its own (NI-38).
// ---------------------------------------------------------------------

export const BILLS_PAGE_SIZE = 200;
const BILLS_SELECT = "*, bill_items(*)";

interface BillsPullState {
  phase: "backfill" | "done";
  /** Backfill position: the last (created_at, id) written; null = not started. */
  before: { createdAt: string; id: string } | null;
}

export interface PullBillsOptions {
  pageSize?: number;
  /** Stop the backfill after this many pages (tests; a half-way pull). */
  maxPages?: number;
  /** Await the backfill. Default false: the cycle starts it in the background and carries on pushing. */
  awaitBackfill?: boolean;
}

const billsCursorKey = (shopId: string) => `bills:${shopId}`;
const iso = (serverTime: string) => new Date(serverTime).toISOString(); // the device's format, so strings sort

function parseBillsState(cursor: string | null): BillsPullState {
  try {
    if (cursor) return JSON.parse(cursor) as BillsPullState;
  } catch {
    /* fall through - a damaged state restarts the backfill, which is idempotent */
  }
  return { phase: "backfill", before: null };
}

async function writePulledBills(localDb: KiranaBillDB, shopId: string, rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  const nowIso = new Date().toISOString();
  await localDb.transaction("rw", [localDb.bills, localDb.billItems, localDb.billSearch], async () => {
    const existing = await localDb.bills.bulkGet(rows.map((r) => r.local_id as string));
    const newBills: LocalBill[] = [];
    const newItems: LocalBillItem[] = [];
    const newSearch: BillSearchRow[] = [];
    for (const [i, row] of rows.entries()) {
      if (existing[i]) continue; // already here: pushed from this device, or on an overlapping page
      const bill: LocalBill = {
        localId: row.local_id,
        serverId: row.id,
        shopId,
        status: row.status,
        syncStatus: "synced",
        receiptNumber: row.receipt_number,
        receiptNumberSource: row.receipt_number_source,
        customerName: row.customer_name,
        customerMobile: row.customer_mobile,
        subtotalPaise: Number(row.subtotal_paise),
        totalPaise: Number(row.total_paise),
        schemaVersion: row.schema_version,
        deviceId: row.device_id,
        createdAt: iso(row.created_at),
        finalizedAt: row.finalized_at ? iso(row.finalized_at) : null,
        syncedAt: nowIso,
        pulledAt: nowIso,
      };
      const items: LocalBillItem[] = [...(row.bill_items ?? [])]
        .sort((a: { line_no: number }, b: { line_no: number }) => a.line_no - b.line_no)
        .map((it: Record<string, unknown>) => ({
          billLocalId: bill.localId,
          shopId,
          lineNo: it.line_no as number,
          shopProductId: (it.shop_product_id as string | null) ?? null,
          displayName: it.display_name as string,
          spokenName: (it.spoken_name as string | null) ?? null,
          qty: it.qty === null || it.qty === undefined ? null : Number(it.qty),
          unit: (it.unit as string | null) ?? null,
          ratePaise: it.rate_paise === null || it.rate_paise === undefined ? null : Number(it.rate_paise),
          rateUnit: (it.rate_unit as string | null) ?? null,
          totalPaise: Number(it.total_paise),
          priceType: it.price_type as LocalBillItem["priceType"],
          source: it.source as LocalBillItem["source"],
          reviewFlags: (it.review_flags as LocalBillItem["reviewFlags"]) ?? [],
          wasEdited: Boolean(it.was_edited),
        }));
      newBills.push(bill);
      newItems.push(...items);
      // D61: one search row per FINAL bill - a bill that arrives already cancelled is stored, not listed.
      if (bill.status === "final") newSearch.push(billSearchRowOf(bill, items));
    }
    // One bulk write per table - a page of 200 bills is ~1,400 rows.
    await localDb.bills.bulkAdd(newBills);
    await localDb.billItems.bulkAdd(newItems);
    await localDb.billSearch.bulkAdd(newSearch);
  });
  noteBillsWritten(localDb.name);
}

// One detached backfill per shop database at a time.
const backfillsInFlight = new Map<string, Promise<void>>();

async function backfillBills(client: SupabaseClient, localDb: KiranaBillDB, shopId: string, opts: PullBillsOptions): Promise<void> {
  const pageSize = opts.pageSize ?? BILLS_PAGE_SIZE;
  let pages = 0;
  for (;;) {
    const state = parseBillsState((await localDb.syncState.get(billsCursorKey(shopId)))?.cursor ?? null);
    if (state.phase === "done" || !localDb.isOpen()) return;
    if (opts.maxPages !== undefined && pages >= opts.maxPages) return;

    let query = client
      .from("bills")
      .select(BILLS_SELECT)
      .eq("shop_id", shopId)
      .in("status", ["final", "cancelled"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize);
    if (state.before) {
      const { createdAt, id } = state.before;
      query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
    }
    const { data, error } = await query;
    if (error || !data) {
      console.warn(`[sync] bills backfill stopped: ${error?.code ?? "no data"}`); // never the message - it can echo a row
      return;
    }
    await writePulledBills(localDb, shopId, data);
    pages += 1;
    const last = data[data.length - 1];
    const next: BillsPullState =
      data.length < pageSize || !last ? { phase: "done", before: null } : { phase: "backfill", before: { createdAt: last.created_at, id: last.id } };
    const prior = await localDb.syncState.get(billsCursorKey(shopId));
    await localDb.syncState.put({ tableName: billsCursorKey(shopId), lastSyncedAt: prior?.lastSyncedAt ?? null, cursor: JSON.stringify(next), pendingCount: 0 });
  }
}

async function incrementalBills(client: SupabaseClient, localDb: KiranaBillDB, shopId: string, pageSize: number): Promise<void> {
  const key = billsCursorKey(shopId);
  let newest = (await localDb.syncState.get(key))?.lastSyncedAt ?? null;
  const from = newest ? new Date(new Date(newest).getTime() - SHOP_PRODUCTS_PULL_OVERLAP_MS).toISOString() : null;
  let after: { syncedAt: string; id: string } | null = null;
  for (;;) {
    // Light first: ids only. The window is re-read every cycle (the overlap), so downloading
    // the bills' items each time would cost mobile data for nothing - items come only for bills this phone lacks.
    let query = client
      .from("bills")
      .select("id, local_id, synced_at")
      .eq("shop_id", shopId)
      .in("status", ["final", "cancelled"])
      .order("synced_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);
    if (after) query = query.or(`synced_at.gt.${after.syncedAt},and(synced_at.eq.${after.syncedAt},id.gt.${after.id})`);
    else if (from) query = query.gt("synced_at", from);
    else query = query.not("synced_at", "is", null);
    const { data, error } = await query;
    if (error || !data) {
      console.warn(`[sync] bills pull failed: ${error?.code ?? "no data"}`);
      return;
    }
    const have = await localDb.bills.bulkGet(data.map((r) => r.local_id as string));
    const missing = data.filter((_, i) => !have[i]).map((r) => r.id as string);
    // 50 ids a request: 200 uuids would make an 8 KB URL, which some proxies refuse.
    for (let i = 0; i < missing.length; i += 50) {
      const full = await client.from("bills").select(BILLS_SELECT).in("id", missing.slice(i, i + 50));
      if (full.error || !full.data) {
        console.warn(`[sync] bills pull failed: ${full.error?.code ?? "no data"}`);
        return; // the cursor stays where it was; the next cycle asks again
      }
      await writePulledBills(localDb, shopId, full.data);
    }
    const last = data[data.length - 1];
    if (last?.synced_at) {
      after = { syncedAt: last.synced_at, id: last.id };
      if (!newest || new Date(last.synced_at) > new Date(newest)) newest = last.synced_at;
    }
    if (data.length < pageSize || !last) break;
  }
  const state = await localDb.syncState.get(key);
  await localDb.syncState.put({ tableName: key, lastSyncedAt: newest, cursor: state?.cursor ?? null, pendingCount: 0 });
}

export async function pullBills(client: SupabaseClient, localDb: KiranaBillDB, shopId: string, opts: PullBillsOptions = {}): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return; // offline: wait quietly (NI-38)
  const key = billsCursorKey(shopId);
  try {
    if (!(await localDb.syncState.get(key))) {
      // First pull on this database: note the server's newest synced_at BEFORE the backfill starts.
      const { data, error } = await client
        .from("bills")
        .select("synced_at")
        .eq("shop_id", shopId)
        .not("synced_at", "is", null)
        .order("synced_at", { ascending: false })
        .limit(1);
      if (error || !data) {
        console.warn(`[sync] bills pull failed: ${error?.code ?? "no data"}`);
        return;
      }
      await localDb.syncState.put({
        tableName: key,
        lastSyncedAt: data[0]?.synced_at ?? null,
        cursor: JSON.stringify({ phase: "backfill", before: null } satisfies BillsPullState),
        pendingCount: 0,
      });
    }

    const phase = () => localDb.syncState.get(key).then((s) => parseBillsState(s?.cursor ?? null).phase);
    if ((await phase()) === "backfill") {
      let flight = backfillsInFlight.get(localDb.name);
      if (!flight) {
        flight = backfillBills(client, localDb, shopId, opts)
          .catch((err: unknown) => console.warn("[sync] bills backfill stopped:", err instanceof Error ? err.message : err))
          .finally(() => {
            backfillsInFlight.delete(localDb.name);
            emitBillsPull(localDb.name); // the first pull ended (or stopped) - History re-reads its state
          });
        backfillsInFlight.set(localDb.name, flight);
      }
      if (!opts.awaitBackfill) return; // carry on with the cycle; the backfill continues in the background
      await flight;
    }
    if ((await phase()) === "done") await incrementalBills(client, localDb, shopId, opts.pageSize ?? BILLS_PAGE_SIZE);
  } catch (err) {
    // e.g. the database was closed by sign-out mid-pull, or the network dropped.
    console.warn("[sync] bills pull stopped:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------
// Hybrid: receiptNumberBlocks. Never created locally (reserved via a real
// online round-trip - KB-111's job, not this ticket's). This ticket's job
// is only the generic mechanics: pull newly-reserved blocks, push a
// locally-mutated nextNumber.
// ---------------------------------------------------------------------

// KB-315 (docs/07-DECISIONS.md D38): only THIS device's blocks. Pulling every
// block of the shop let a device (e.g. one whose IndexedDB was wiped and now
// has a new deviceId) pull another install's block back and reissue numbers
// that install had already used offline but never pushed.
export async function pullReceiptNumberBlocks(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
): Promise<void> {
  const { data, error } = await client
    .from("receipt_number_blocks")
    .select("*")
    .eq("shop_id", shopId)
    .eq("device_id", deviceId);
  if (error || !data) {
    console.warn(`[sync] receiptNumberBlocks pull failed: ${error?.message}`);
    return;
  }

  for (const row of data) {
    const existing = await localDb.receiptNumberBlocks.get(row.id);
    // Never overwrite a block whose nextNumber has been locally advanced
    // and not yet pushed - this pull only adds newly-reserved blocks or
    // refreshes ones this device hasn't touched.
    if (existing && existing.syncStatus === "pending") continue;

    await localDb.receiptNumberBlocks.put({
      id: row.id,
      shopId: row.shop_id,
      deviceId: row.device_id,
      blockStart: row.block_start,
      blockEnd: row.block_end,
      nextNumber: row.next_number,
      allocatedAt: row.allocated_at,
      syncStatus: "synced",
    });
  }
}

export async function pushReceiptNumberBlocks(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.receiptNumberBlocks.where("syncStatus").equals("pending").toArray();
  let anyTransientFailure = false;

  for (const block of pending) {
    // .select("id") (returning an array, not .single()) so a zero-row
    // result is checked explicitly rather than relying on an error being
    // thrown - KB-105 already proved RLS UPDATE is a silent zero-row
    // filter, not a raised error, for exactly this shape of statement.
    const { data, error } = await client
      .from("receipt_number_blocks")
      .update({ next_number: block.nextNumber })
      .eq("id", block.id)
      .select("id");

    if (error || !data || data.length === 0) {
      if (isPermanentError(error) || (!error && data?.length === 0)) {
        console.warn(
          `[sync] receiptNumberBlocks: ${
            error ? `permanent failure (${error.code})` : "update silently affected 0 rows (RLS filtered)"
          } for id=${block.id}: ${error?.message ?? "no matching row visible to this session"}`,
        );
        // No "conflict" status for this table's mutation path - a rejected
        // nextNumber update is surfaced via the same log, but the block
        // stays pending so KB-111's allocation logic can decide what to
        // do (e.g. reserve a fresh block) rather than this generic worker
        // guessing at a receipt-numbering-specific recovery.
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.receiptNumberBlocks.update(block.id, { syncStatus: "synced" });
  }

  return { anyTransientFailure };
}

// ---------------------------------------------------------------------
// shops: bidirectional, last-write-wins on updated_at (02-ARCHITECTURE.md
// section 2's own conflict-strategy table). Discard-the-loser semantics
// implemented exactly as specified - not softened - but every discard is
// logged (logDiscardedEdit) so "silently" doesn't also mean
// "unrecoverably untraceable."
//
// A pull only ever overwrites a LOCAL ROW ALREADY IN "synced" STATE. A
// row still "pending" (a local edit not yet even attempted against the
// server) is left alone this cycle - overwriting an edit the user hasn't
// had a chance to push yet would be a worse, more silent loss than the
// documented conflict case, which is about two already-synced bases
// diverging, not about clobbering an in-flight local write.
// ---------------------------------------------------------------------

export async function pushShop(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.shops.where("syncStatus").equals("pending").toArray();
  let anyTransientFailure = false;

  for (const shop of pending) {
    // .select("id") (an array, not .single()) so a zero-row result is
    // checked explicitly - same reasoning as pushReceiptNumberBlocks:
    // RLS UPDATE is a silent zero-row filter, not a raised error.
    const { data, error } = await client
      .from("shops")
      .update({
        name: shop.name,
        phone: shop.phone,
        address: shop.address,
        logo_url: shop.logoUrl,
        bill_language: shop.billLanguage,
        receipt_prefix: shop.receiptPrefix,
        updated_at: shop.updatedAt,
      })
      .eq("id", shop.id)
      .select("id");

    if (error || !data || data.length === 0) {
      if (isPermanentError(error) || (!error && data?.length === 0)) {
        await localDb.shops.update(shop.id, { syncStatus: "conflict" });
        console.warn(
          `[sync] shops: ${
            error ? `permanent failure (${error.code})` : "update silently affected 0 rows (RLS filtered)"
          } for id=${shop.id}: ${error?.message ?? "no matching row visible to this session"}`,
        );
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    await localDb.shops.update(shop.id, { syncStatus: "synced" });
  }

  return { anyTransientFailure };
}

export async function pullShop(client: SupabaseClient, localDb: KiranaBillDB, shopId: string): Promise<void> {
  const { data, error } = await client.from("shops").select("*").eq("id", shopId).single();
  if (error || !data) {
    console.warn(`[sync] shops pull failed: ${error?.message}`);
    return;
  }

  const local = await localDb.shops.get(shopId);

  if (local && local.syncStatus === "pending") {
    // A not-yet-pushed local edit exists - never clobber it from a pull.
    return;
  }

  if (local && local.updatedAt >= data.updated_at) {
    // Local is already at least as new - nothing to do.
    return;
  }

  if (local) {
    logDiscardedEdit({
      table: "shops",
      id: shopId,
      discardedLocal: local,
      wonRemote: data,
    });
  }

  await localDb.shops.put({
    id: data.id,
    syncStatus: "synced",
    name: data.name,
    phone: data.phone,
    address: data.address,
    logoUrl: data.logo_url,
    catalogMode: data.catalog_mode,
    billLanguage: data.bill_language,
    receiptPrefix: data.receipt_prefix,
    updatedAt: data.updated_at,
  });
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------

export interface SyncNowOptions {
  client?: SupabaseClient;
  /** The signed-in user's own database (openShopDb(userId), D38). */
  localDb: KiranaBillDB;
  shopId: string;
  /** This installation's id (device.ts) - blocks are pulled per device. */
  deviceId: string;
}

export interface SyncCycleResult {
  anyTransientFailure: boolean;
  /** True when the cycle did nothing because there was no live session. */
  skippedNoSession?: boolean;
}

/**
 * KB-110b: only one sync run at a time. startSyncLoop's timer and its
 * "online" listener can both call syncNow() - two overlapping runs would push
 * the same pending bill twice at once. push_bill absorbs that race (the
 * loser re-reads and compares), but there's no reason to cause it: a second
 * caller simply joins the run already in flight.
 */
let syncInFlight: Promise<SyncCycleResult> | null = null;

export function syncNow(options: SyncNowOptions): Promise<SyncCycleResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSyncCycle(options).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSyncCycle(options: SyncNowOptions): Promise<SyncCycleResult> {
  const client = options.client ?? supabase;
  const { localDb, shopId, deviceId } = options;

  // KB-315 (docs/07-DECISIONS.md D38): NEVER sync without a real session.
  // In offline-session mode, or after auth-js drops a session whose refresh
  // token was rejected, every request would go out as anon: push_bill would
  // answer 42501 and every offline-created bill would be marked a PERMANENT
  // conflict. So no live session -> skip the whole cycle; everything stays
  // pending; report it as transient so the loop backs off and retries. A real
  // 42501 then only ever means a real RLS rejection.
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    return { anyTransientFailure: true, skippedNoSession: true };
  }

  // Phase 1: bills (and their items). Fully awaited before phase 2 starts -
  // a strict two-phase cycle, not an interleaved loop, so a learningEvent
  // can never be checked against a same-cycle bill push that hasn't
  // resolved yet.
  const billsResult = await pushBills(client, localDb);

  // Phase 2: learningEvents, only now that phase 1 has fully resolved and
  // every bill that could sync this cycle already has (or doesn't have) a
  // serverId written to localDb.
  const learningEventsResult = await pushLearningEvents(client, localDb);

  // The remaining push-first tables have no dependency on bill serverIds.
  const otherPushResults = await Promise.all([
    pushLearnedAliases(client, localDb),
    pushProvisionalProducts(client, localDb),
    pushPriceObservations(client, localDb),
    pushReceiptNumberBlocks(client, localDb),
    pushShop(client, localDb),
  ]);

  // Pulls.
  await pullShopProducts(client, localDb, shopId);
  await pullBaseProducts(client, localDb);
  await pullReceiptNumberBlocks(client, localDb, shopId, deviceId);
  await pullShop(client, localDb, shopId);
  await pullBills(client, localDb, shopId);

  return mergeResults([billsResult, learningEventsResult, ...otherPushResults]);
}

// ---------------------------------------------------------------------
// The loop. KB-315: started once a shop is active, stopped on sign-out.
// Idempotent start (a running flag - the old `if (loopTimer)` check let two
// quick calls both start, since the timer is only set after the first cycle),
// and the "online" listener is removed on stop (it used to leak). The event
// source is injectable: Node (tests, e2e) has no `window`.
// ---------------------------------------------------------------------

export interface OnlineEventSource {
  addEventListener(type: "online", listener: () => void): void;
  removeEventListener(type: "online", listener: () => void): void;
}

let loopRunning = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let currentBackoffMs = BASE_INTERVAL_MS;
let onlineSource: OnlineEventSource | null = null;
let onlineListener: (() => void) | null = null;

async function runLoop(options: SyncNowOptions): Promise<void> {
  if (!loopRunning) return;
  let anyTransientFailure = true;
  try {
    ({ anyTransientFailure } = await syncNow(options));
  } catch (err) {
    // e.g. the database was closed by sign-out mid-cycle. Never let an
    // exception kill the loop silently - log, back off, try again.
    console.warn("[sync] cycle failed:", err);
  }
  if (!loopRunning) return;
  currentBackoffMs = anyTransientFailure ? Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS) : BASE_INTERVAL_MS;
  loopTimer = setTimeout(() => void runLoop(options), currentBackoffMs);
}

export function startSyncLoop(
  options: SyncNowOptions,
  eventSource: OnlineEventSource | null = typeof window !== "undefined" ? window : null,
): void {
  if (loopRunning) return;
  loopRunning = true;
  currentBackoffMs = BASE_INTERVAL_MS;
  onlineSource = eventSource;
  onlineListener = () => void syncNow(options);
  onlineSource?.addEventListener("online", onlineListener);
  void runLoop(options);
}

export function stopSyncLoop(): void {
  loopRunning = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  if (onlineSource && onlineListener) onlineSource.removeEventListener("online", onlineListener);
  onlineSource = null;
  onlineListener = null;
}

export function isSyncLoopRunning(): boolean {
  return loopRunning;
}
