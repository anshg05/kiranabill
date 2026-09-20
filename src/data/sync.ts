import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/data/supabaseClient";
import { db as defaultDb, type KiranaBillDB, type SyncStatus } from "@/data/db";

// KB-110: the sync worker. Not a literal Web Worker - a main-thread async
// loop (setInterval + online/offline listeners + a manual syncNow()).
// Nothing in 11-STACK-DECISIONS.md mandates a dedicated Worker thread, and
// the UI already never blocks on the network by design (02-ARCHITECTURE.md
// section 2) - a real Worker would add message-passing overhead for no
// stated benefit.

const BASE_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * A Postgres/PostgREST error carries a real SQLSTATE-shaped `code`
 * (5 characters - "42501" for an RLS rejection, "P0001" for a plpgsql
 * raise, confirmed against KB-104/KB-105's own findings). A network-level
 * failure (timeout, fetch throws, no response) has no such code. That
 * distinction is exactly what syncStatus's third state, "conflict", is
 * for: a permanent rejection should stop retrying and surface to the
 * user, not burn backoff cycles forever on something that will never
 * succeed.
 */
function isPermanentError(error: PostgrestError | null): boolean {
  return typeof error?.code === "string" && error.code.length === 5;
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
// Phase 1: push bills (and, per bill, its items) - awaited to completion
// before phase 2 (learningEvents) ever starts. Structured as two
// sequential top-level steps in syncNow(), not an interleaved loop, so a
// learningEvent can never be checked against a parent bill push that
// hasn't resolved yet this cycle.
// ---------------------------------------------------------------------

async function pushBillItemsForBill(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  billLocalId: string,
  serverBillId: string,
  shopId: string,
): Promise<boolean> {
  const items = await localDb.billItems.where("billLocalId").equals(billLocalId).toArray();

  // No unique constraint exists on bill_items beyond its own primary key
  // (checked directly against supabase/migrations/20260917194832_billing.sql -
  // there is no unique(bill_id, line_no)), so there is no natural upsert
  // target for a line item. Delete-then-reinsert the full current set
  // instead - safe specifically because bill_items can only be freely
  // mutated while the parent bill is still draft (bill_items_enforce_immutability,
  // KB-103), so this never runs against an already-immutable set.
  //
  // Known, deliberate limitation: this is not atomic across the two
  // requests. A network drop between the delete and the reinsert leaves
  // the server with zero items for this bill until the next successful
  // retry. Acceptable for MVP (single device per shop, app always reads
  // from local storage, never from another device's view of server data)
  // but worth revisiting with an atomic RPC if this ever becomes a real
  // problem outside single-device use.
  const { error: deleteError } = await client.from("bill_items").delete().eq("bill_id", serverBillId);
  if (deleteError) {
    console.warn(`[sync] bill_items delete failed for bill ${serverBillId}: ${deleteError.message}`);
    return false;
  }

  if (items.length === 0) return true;

  const { error: insertError } = await client.from("bill_items").insert(
    items.map((item) => ({
      bill_id: serverBillId,
      shop_id: shopId,
      line_no: item.lineNo,
      shop_product_id: item.shopProductId,
      display_name: item.displayName,
      spoken_name: item.spokenName,
      qty: item.qty,
      unit: item.unit,
      rate_paise: item.ratePaise,
      total_paise: item.totalPaise,
      price_type: item.priceType,
      source: item.source,
      review_flags: item.reviewFlags,
      was_edited: item.wasEdited,
    })),
  );

  if (insertError) {
    console.warn(`[sync] bill_items insert failed for bill ${serverBillId}: ${insertError.message}`);
    return false;
  }

  return true;
}

export async function pushBills(client: SupabaseClient, localDb: KiranaBillDB): Promise<PushResult> {
  const pending = await localDb.bills.where("syncStatus").equals("pending").sortBy("createdAt");
  let anyTransientFailure = false;

  for (const bill of pending) {
    const { data, error } = await client
      .from("bills")
      .upsert(
        {
          shop_id: bill.shopId,
          local_id: bill.localId,
          receipt_number: bill.receiptNumber,
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
        { onConflict: "shop_id,local_id" },
      )
      .select("id")
      .single();

    if (error || !data) {
      if (isPermanentError(error)) {
        await localDb.bills.update(bill.localId, { syncStatus: "conflict" as SyncStatus });
        console.warn(
          `[sync] bills: permanent failure for localId=${bill.localId}: ${error?.code} ${error?.message}`,
        );
      } else {
        anyTransientFailure = true;
      }
      continue;
    }

    const itemsOk = await pushBillItemsForBill(client, localDb, bill.localId, data.id, bill.shopId);
    if (!itemsOk) {
      // Bill itself synced; items didn't. Leave the bill pending so this
      // whole bill (and its items) is retried together next cycle, rather
      // than marking the bill synced while its items silently lag behind.
      anyTransientFailure = true;
      continue;
    }

    await localDb.bills.update(bill.localId, {
      syncStatus: "synced" as SyncStatus,
      serverId: data.id,
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

export async function pullShopProducts(client: SupabaseClient, localDb: KiranaBillDB, shopId: string): Promise<void> {
  const state = await localDb.syncState.get("shopProducts");
  const cursor = state?.lastSyncedAt ?? null;

  let query = client.from("shop_products").select("*").eq("shop_id", shopId);
  if (cursor) query = query.gt("updated_at", cursor);
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
    tableName: "shopProducts",
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
// Hybrid: receiptNumberBlocks. Never created locally (reserved via a real
// online round-trip - KB-111's job, not this ticket's). This ticket's job
// is only the generic mechanics: pull newly-reserved blocks, push a
// locally-mutated nextNumber.
// ---------------------------------------------------------------------

export async function pullReceiptNumberBlocks(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
): Promise<void> {
  const { data, error } = await client.from("receipt_number_blocks").select("*").eq("shop_id", shopId);
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
  localDb?: KiranaBillDB;
  shopId: string;
}

export async function syncNow(options: SyncNowOptions): Promise<{ anyTransientFailure: boolean }> {
  const client = options.client ?? supabase;
  const localDb = options.localDb ?? defaultDb;
  const shopId = options.shopId;

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
  await pullReceiptNumberBlocks(client, localDb, shopId);
  await pullShop(client, localDb, shopId);

  return mergeResults([billsResult, learningEventsResult, ...otherPushResults]);
}

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let currentBackoffMs = BASE_INTERVAL_MS;

async function runLoop(options: SyncNowOptions): Promise<void> {
  const { anyTransientFailure } = await syncNow(options);
  currentBackoffMs = anyTransientFailure ? Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS) : BASE_INTERVAL_MS;
  loopTimer = setTimeout(() => void runLoop(options), currentBackoffMs);
}

export function startSyncLoop(options: SyncNowOptions): void {
  if (loopTimer) return;
  currentBackoffMs = BASE_INTERVAL_MS;
  void runLoop(options);
  window.addEventListener("online", () => void syncNow(options));
}

export function stopSyncLoop(): void {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
}
