import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB, LocalLearnedAlias, LocalLearningEvent, LocalPriceObservation, LocalProvisionalProduct } from "./db";
import { ALIAS_PULL_TYPES } from "./aliasEvidence";
import { PRICE_IGNORE_EVENT } from "./learningAudit";

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
/** KB-329 (D78): an ignore lasts 90 days; 100 gives margin. Only ignore events are pulled - never the bill_learned markers. */
export const IGNORE_EVENT_WINDOW_DAYS = 100;
/** The same re-read window as D62 / D63. */
const OVERLAP_MS = 60_000;
const PAGE = 500;
// KB-323 (D81): the ALIAS events are pulled WITHOUT a time window - alias confidence is a sum over every event since the
// shop's reset (the cutoff below), so a window would make two phones disagree. Paged, and the place is saved after every
// page, so a pull cut off half way (a bad connection) resumes instead of starting over.
const DAY_MS = 86_400_000;

export interface PullLearningResult {
  /** All the learning tables were pulled up to date (and the learning gate is open). */
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
  table: "learned_aliases" | "provisional_products" | "price_observations" | "learning_events";
  /** Only rows whose occurred_at is inside the window (price observations). */
  windowed?: boolean;
  /** The syncState key part when two specs read one table (the ignore events and the alias events both read learning_events). */
  key?: string;
  /** Only these event types of learning_events. */
  eventTypes?: readonly string[];
  /** KB-329: only the last IGNORE_EVENT_WINDOW_DAYS of them (by created_at). No window = every one since the reset cutoff. */
  windowDays?: number;
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
  {
    // KB-329 (D78): the ignore of a price suggestion. Append-only; a row already here (this phone pushed it) is left as it is.
    table: "learning_events",
    eventTypes: [PRICE_IGNORE_EVENT],
    windowDays: IGNORE_EVENT_WINDOW_DAYS,
    write: (db, rows) =>
      db.transaction("rw", db.learningEvents, async () => {
        const events = rows.map((r): LocalLearningEvent => ({
          localId: r.local_id as string,
          serverId: r.id as string,
          shopId: r.shop_id as string,
          syncStatus: "synced",
          billLocalId: "",
          eventType: r.event_type as string,
          payload: (r.payload as Record<string, unknown> | null) ?? {},
          createdAt: new Date(r.created_at as string).toISOString(),
          updatedAt: r.updated_at as string,
          deviceId: r.device_id as string,
        }));
        const existing = await db.learningEvents.bulkGet(events.map((e) => e.localId));
        await db.learningEvents.bulkAdd(events.filter((_, i) => !existing[i]));
      }),
  },
  {
    // KB-323 (D81): every alias_confirmed / alias_suppressed / alias_removed / alias_conflict event. A row already here (this
    // phone pushed it) is left as it is. A pulled event knows its bill only by the server's id (billServerId).
    table: "learning_events",
    key: "learning_events_alias",
    eventTypes: ALIAS_PULL_TYPES,
    write: (db, rows) =>
      db.transaction("rw", db.learningEvents, async () => {
        const events = rows.map((r): LocalLearningEvent => ({
          localId: r.local_id as string,
          serverId: r.id as string,
          shopId: r.shop_id as string,
          syncStatus: "synced",
          billLocalId: "",
          billServerId: (r.bill_id as string | null) ?? undefined,
          eventType: r.event_type as string,
          payload: (r.payload as Record<string, unknown> | null) ?? {},
          createdAt: new Date(r.created_at as string).toISOString(),
          updatedAt: r.updated_at as string,
          deviceId: r.device_id as string,
        }));
        const existing = await db.learningEvents.bulkGet(events.map((e) => e.localId));
        await db.learningEvents.bulkAdd(events.filter((_, i) => !existing[i]));
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

async function pullTable(client: SupabaseClient, db: KiranaBillDB, shopId: string, spec: TableSpec, cutoff: string | null, pageSize: number): Promise<void> {
  const key = tableKey(spec.key ?? spec.table, shopId);
  const cursor = (await db.syncState.get(key))?.lastSyncedAt ?? null;
  const overlapFrom = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;
  // Rows stamped at or before the shop's latest reset are never pulled: the lower bound is the later of the two.
  const lower = cutoff && (!overlapFrom || new Date(cutoff).getTime() >= new Date(overlapFrom).getTime()) ? cutoff : overlapFrom;
  const windowStart = new Date(Date.now() - LEARNING_OBSERVATION_WINDOW_DAYS * DAY_MS).toISOString();
  const eventWindowStart = spec.windowDays ? new Date(Date.now() - spec.windowDays * DAY_MS).toISOString() : null;

  let newest = cursor;
  let after: { at: string; id: string } | null = null;
  for (;;) {
    let query = client.from(spec.table).select("*").eq("shop_id", shopId).order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(pageSize);
    if (spec.windowed) query = query.gte("occurred_at", windowStart);
    if (spec.eventTypes) query = query.in("event_type", [...spec.eventTypes]);
    if (eventWindowStart) query = query.gte("created_at", eventWindowStart);
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
    // The place is kept after every page: a pull cut off here resumes from it (the 60 s overlap re-reads, never skips).
    await db.syncState.put({ tableName: key, lastSyncedAt: newest, cursor: null, pendingCount: 0 });
    if (data.length < pageSize) break;
  }
}

export async function pullLearningState(client: SupabaseClient, db: KiranaBillDB, shopId: string, opts: { pageSize?: number } = {}): Promise<PullLearningResult> {
  // Rule A: a reset the server does not know yet would be undone by this pull.
  if (await hasUnsyncedReset(db, shopId)) return { done: false, skipped: "reset-not-pushed" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { done: false, skipped: "error" };
  try {
    const cutoff = await refreshResetCutoff(client, db, shopId);
    for (const spec of SPECS) await pullTable(client, db, shopId, spec, cutoff, opts.pageSize ?? PAGE);
    await markLearningPullDone(db, shopId);
    return { done: true };
  } catch (err) {
    // Only a code - an error message can echo a row (customer data).
    console.warn(`[sync] learning pull stopped: ${err instanceof PullError ? err.message : "unexpected error"}`);
    return { done: false, skipped: "error" };
  }
}
