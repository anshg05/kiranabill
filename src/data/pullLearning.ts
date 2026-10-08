import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB, LocalLearnedAlias, LocalPriceObservation, LocalProvisionalProduct } from "./db";

// KB-326 (docs/07-DECISIONS.md D66): learned aliases, provisional products and price observations are pushed
// by the device that learned them - and now PULLED, so a wiped or new phone keeps its Catalog suggestions (and,
// with KB-323, its voice accuracy). Per shop, never global (hard rule 12): every query is `.eq("shop_id")` plus RLS.
//
// Identity: every learning row's local_id is deterministic (shop + alias, shop + spoken name, bill + line), so a
// pulled row IS the row this phone would have made - a pull is an upsert by local_id, never a duplicate.
//
// Clocks (D62, D64): the cursor and the learning_reset cutoff are the SERVER's updated_at (migration
// 20261011090000 - a trigger on all four tables); re-read the last 60 s before the cursor (a transaction can commit
// after the cursor passed its start time); stamps are compared as the server wrote them.
//
// learning_reset (KB-312): the server keeps its rows (NI-27), so a pull drops every row stamped at or before the
// shop's latest reset event - and does not pull AT ALL while a reset of this phone has not reached the server (a
// pull would bring everything back). sync.ts never pushes learning rows after a reset event that failed to push, so
// no post-reset row can carry an older stamp than its reset.

/** Owner, D66: the suggestion rule reads 30 days; 35 gives it margin. Revisit if a later feature reads further back. */
export const LEARNING_OBSERVATION_WINDOW_DAYS = 35;
/** The same re-read window as D62 / D63. */
const OVERLAP_MS = 60_000;
const PAGE = 500;
const DAY_MS = 86_400_000;

export interface PullLearningResult {
  /** All three tables were pulled up to date (and the learning gate is open). */
  done: boolean;
  skipped?: "reset-not-pushed" | "error";
}

const stateKey = (shopId: string) => `learning:${shopId}`;
const tableKey = (table: string, shopId: string) => `learning:${table}:${shopId}`;

/** The learning gate: true once this phone's first learning pull for the shop has succeeded. */
export async function isLearningPullDone(db: KiranaBillDB, shopId: string): Promise<boolean> {
  return ((await db.syncState.get(stateKey(shopId)))?.cursor ?? "") === "done";
}

export async function markLearningPullDone(db: KiranaBillDB, shopId: string): Promise<void> {
  const prior = await db.syncState.get(stateKey(shopId));
  await db.syncState.put({ tableName: stateKey(shopId), lastSyncedAt: prior?.lastSyncedAt ?? null, cursor: "done", pendingCount: 0 });
}

/** A learning_reset of THIS phone the server does not have (pending, or stuck in conflict). */
export async function hasUnsyncedReset(db: KiranaBillDB, shopId: string): Promise<boolean> {
  const events = await db.learningEvents.where("shopId").equals(shopId).filter((e) => e.eventType === "learning_reset" && e.syncStatus !== "synced").count();
  return events > 0;
}

type Row = Record<string, unknown>;

interface TableSpec {
  table: "learned_aliases" | "provisional_products" | "price_observations";
  /** Only rows whose occurred_at is inside the window (price observations). */
  windowed?: boolean;
  write: (db: KiranaBillDB, rows: Row[]) => Promise<void>;
}

const SPECS: TableSpec[] = [
  {
    table: "learned_aliases",
    write: (db, rows) =>
      db.transaction("rw", db.learnedAliases, async () => {
        const mapped = rows.map((r): LocalLearnedAlias => ({
          localId: r.local_id as string,
          serverId: r.id as string,
          shopId: r.shop_id as string,
          syncStatus: "synced",
          alias: r.alias as string,
          shopProductId: r.shop_product_id as string,
          hitCount: Number(r.hit_count),
          confidence: Number(r.confidence),
          source: r.source as LocalLearnedAlias["source"],
          updatedAt: r.updated_at as string,
          deviceId: r.device_id as string,
        }));
        const existing = await db.learnedAliases.bulkGet(mapped.map((m) => m.localId));
        // D64: a row with an edit not yet pushed is never overwritten by a pull.
        await db.learnedAliases.bulkPut(mapped.filter((_, i) => existing[i]?.syncStatus !== "pending"));
      }),
  },
  {
    table: "provisional_products",
    write: (db, rows) =>
      db.transaction("rw", db.provisionalProducts, async () => {
        const mapped = rows.map((r): LocalProvisionalProduct => ({
          localId: r.local_id as string,
          serverId: r.id as string,
          shopId: r.shop_id as string,
          syncStatus: "synced",
          spokenName: r.spoken_name as string,
          seenCount: Number(r.seen_count),
          suggestedUnit: (r.suggested_unit as string | null) ?? null,
          suggestedPricePaise: r.suggested_price_paise === null ? null : Number(r.suggested_price_paise),
          promotedAt: (r.promoted_at as string | null) ?? null,
          promotedShopProductId: (r.promoted_shop_product_id as string | null) ?? null,
          updatedAt: r.updated_at as string,
          deviceId: r.device_id as string,
        }));
        const existing = await db.provisionalProducts.bulkGet(mapped.map((m) => m.localId));
        await db.provisionalProducts.bulkPut(mapped.filter((_, i) => existing[i]?.syncStatus !== "pending"));
      }),
  },
  {
    table: "price_observations",
    windowed: true,
    write: (db, rows) =>
      db.transaction("rw", db.priceObservations, async () => {
        const observations = rows.map((r): LocalPriceObservation => ({
          localId: r.local_id as string,
          serverId: r.id as string,
          shopId: r.shop_id as string,
          syncStatus: "synced",
          shopProductId: r.shop_product_id as string,
          observedPricePaise: Number(r.observed_price_paise),
          occurredAt: new Date(r.occurred_at as string).toISOString(),
          updatedAt: r.updated_at as string,
          deviceId: r.device_id as string,
        }));
        const existing = await db.priceObservations.bulkGet(observations.map((o) => o.localId));
        await db.priceObservations.bulkAdd(observations.filter((_, i) => !existing[i])); // append-only: never changed
      }),
  },
];

/** The newer of two server stamps (same producer, same format - compared as written; Date only to order). */
const newerStamp = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : new Date(b).getTime() > new Date(a).getTime() || (new Date(b).getTime() === new Date(a).getTime() && b > a) ? b : a);

class PullError extends Error {}

async function refreshResetCutoff(client: SupabaseClient, db: KiranaBillDB, shopId: string): Promise<string | null> {
  const { data, error } = await client
    .from("learning_events")
    .select("updated_at")
    .eq("shop_id", shopId)
    .eq("event_type", "learning_reset")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error || !data) throw new PullError(error?.code ?? "no data");
  const prior = await db.syncState.get(stateKey(shopId));
  const cutoff = newerStamp(prior?.lastSyncedAt ?? null, (data[0]?.updated_at as string | undefined) ?? null);
  if (cutoff !== (prior?.lastSyncedAt ?? null)) {
    await db.syncState.put({ tableName: stateKey(shopId), lastSyncedAt: cutoff, cursor: prior?.cursor ?? null, pendingCount: 0 });
  }
  return cutoff;
}

async function pullTable(client: SupabaseClient, db: KiranaBillDB, shopId: string, spec: TableSpec, cutoff: string | null): Promise<void> {
  const key = tableKey(spec.table, shopId);
  const cursor = (await db.syncState.get(key))?.lastSyncedAt ?? null;
  const overlapFrom = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;
  // Rows stamped at or before the shop's latest reset are never pulled: the lower bound is the later of the two.
  const lower = cutoff && (!overlapFrom || new Date(cutoff).getTime() >= new Date(overlapFrom).getTime()) ? cutoff : overlapFrom;
  const windowStart = new Date(Date.now() - LEARNING_OBSERVATION_WINDOW_DAYS * DAY_MS).toISOString();

  let newest = cursor;
  let after: { at: string; id: string } | null = null;
  for (;;) {
    let query = client.from(spec.table).select("*").eq("shop_id", shopId).order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(PAGE);
    if (spec.windowed) query = query.gte("occurred_at", windowStart);
    if (after) query = query.or(`updated_at.gt.${after.at},and(updated_at.eq.${after.at},id.gt.${after.id})`);
    else if (lower) query = query.gt("updated_at", lower);
    const { data, error } = await query;
    if (error || !data) throw new PullError(error?.code ?? "no data");
    if (data.length > 0) await spec.write(db, data as Row[]);
    const last = data[data.length - 1] as Row | undefined;
    if (last) {
      after = { at: last.updated_at as string, id: last.id as string };
      newest = newerStamp(newest, last.updated_at as string);
    }
    if (data.length < PAGE) break;
  }
  await db.syncState.put({ tableName: key, lastSyncedAt: newest, cursor: null, pendingCount: 0 });
}

export async function pullLearningState(client: SupabaseClient, db: KiranaBillDB, shopId: string): Promise<PullLearningResult> {
  // Rule A: a reset the server does not know yet would be undone by this pull.
  if (await hasUnsyncedReset(db, shopId)) return { done: false, skipped: "reset-not-pushed" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { done: false, skipped: "error" };
  try {
    const cutoff = await refreshResetCutoff(client, db, shopId);
    for (const spec of SPECS) await pullTable(client, db, shopId, spec, cutoff);
    await markLearningPullDone(db, shopId);
    return { done: true };
  } catch (err) {
    // Only a code - an error message can echo a row (customer data).
    console.warn(`[sync] learning pull stopped: ${err instanceof PullError ? err.message : "unexpected error"}`);
    return { done: false, skipped: "error" };
  }
}
