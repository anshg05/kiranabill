/**
 * KB-210 - the real functions Settings -> Developer Mode would call
 * (docs/08-LEARNING-ENGINE.md section 9: "learned aliases with
 * confidence, provisional products with counts, pending price
 * suggestions, and a reset-learning action"). No UI here - S7 (Settings)
 * doesn't exist yet, same reasoning KB-208 used to stay domain-only.
 * Lives in data/, not domain/ - real Dexie I/O disqualifies it from
 * domain/'s zero-I/O rule (hard rule 3).
 */

import type { KiranaBillDB, LocalLearnedAlias, LocalProvisionalProduct } from "./db.js";
import {
  PRICE_SUGGESTION_IGNORE_MS,
  getPriceSuggestions,
  type LearningState,
  type PriceSuggestion,
  type PriceTrackedProduct,
} from "@/domain/learning";

export async function listLearnedAliases(db: KiranaBillDB, shopId: string): Promise<LocalLearnedAlias[]> {
  return db.learnedAliases.where("shopId").equals(shopId).toArray();
}

export async function listProvisionalProducts(
  db: KiranaBillDB,
  shopId: string,
): Promise<LocalProvisionalProduct[]> {
  return db.provisionalProducts.where("shopId").equals(shopId).toArray();
}

/** KB-329 (D78): the learning event a tap on [Ignore] writes. Append-only, so it syncs like the rest of the learning state. */
export const PRICE_IGNORE_EVENT = "price_suggestion_ignored";

/**
 * product id -> the LATEST ignoredUntil (ms) among this shop's ignore events, local and pulled. Every ignore is "tap + 90
 * days", so the latest end date is the latest tap: last-write-wins (D74) from an append-only log - a second phone's later
 * tap extends it and nothing can shorten it. A malformed payload is skipped.
 */
async function ignoredUntilByProduct(db: KiranaBillDB, shopId: string): Promise<Map<string, number>> {
  const events = await db.learningEvents.where("shopId").equals(shopId).filter((e) => e.eventType === PRICE_IGNORE_EVENT).toArray();
  const until = new Map<string, number>();
  for (const e of events) {
    const { shopProductId, ignoredUntil } = e.payload;
    const ms = typeof ignoredUntil === "string" ? Date.parse(ignoredUntil) : NaN;
    if (typeof shopProductId !== "string" || !Number.isFinite(ms)) continue;
    if (ms > (until.get(shopProductId) ?? -Infinity)) until.set(shopProductId, ms);
  }
  return until;
}

/** [Ignore]: hide this product's price suggestion for 90 days. Writes one pending event; never touches a price (hard rule 7). */
export async function ignorePriceSuggestionFor(db: KiranaBillDB, shopId: string, shopProductId: string, deviceId: string, nowMs: number): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  await db.learningEvents.add({
    localId: crypto.randomUUID(),
    shopId,
    syncStatus: "pending",
    billLocalId: "",
    eventType: PRICE_IGNORE_EVENT,
    payload: { shopProductId, ignoredUntil: new Date(nowMs + PRICE_SUGGESTION_IGNORE_MS).toISOString() },
    createdAt: nowIso,
    updatedAt: nowIso,
    deviceId,
  });
}

/**
 * Marshals this shop's LocalPriceObservation rows into the
 * LearningState.priceObservations shape learning.ts's real
 * getPriceSuggestions() already expects, then calls it - no duplicate
 * suggestion logic. ignoredUntilMs comes from the shop's `price_suggestion_ignored`
 * learning events (KB-329, D78) - LocalPriceObservation itself is append-only.
 */
async function priceState(db: KiranaBillDB, shopId: string, withIgnores: boolean): Promise<LearningState> {
  const rows = await db.priceObservations.where("shopId").equals(shopId).toArray();
  const ignored = withIgnores ? await ignoredUntilByProduct(db, shopId) : new Map<string, number>();

  const byProduct: Record<string, PriceTrackedProduct> = {};
  for (const row of rows) {
    const existing = byProduct[row.shopProductId];
    const observation = { pricePaise: row.observedPricePaise, observedAtMs: new Date(row.occurredAt).getTime() };
    byProduct[row.shopProductId] = {
      catalogId: row.shopProductId,
      observations: existing ? [...existing.observations, observation] : [observation],
      ignoredUntilMs: ignored.get(row.shopProductId) ?? null,
    };
  }
  return { provisionalProducts: {}, learnedAliases: {}, priceObservations: byProduct };
}

export async function listPendingPriceSuggestions(
  db: KiranaBillDB,
  shopId: string,
  nowMs: number,
): Promise<readonly PriceSuggestion[]> {
  return getPriceSuggestions(await priceState(db, shopId, true), nowMs);
}

/** Developer mode: the suggestions hidden by [Ignore] right now, with the end of each ignore. */
export async function listIgnoredPriceSuggestions(
  db: KiranaBillDB,
  shopId: string,
  nowMs: number,
): Promise<readonly { suggestion: PriceSuggestion; ignoredUntilMs: number }[]> {
  const ignored = await ignoredUntilByProduct(db, shopId);
  const pending = new Set((await listPendingPriceSuggestions(db, shopId, nowMs)).map((s) => s.catalogId));
  const all = getPriceSuggestions(await priceState(db, shopId, false), nowMs);
  return all.flatMap((suggestion) => {
    const until = ignored.get(suggestion.catalogId);
    return until !== undefined && until > nowMs && !pending.has(suggestion.catalogId) ? [{ suggestion, ignoredUntilMs: until }] : [];
  });
}

export interface ResetLearningResult {
  readonly shopId: string;
  readonly clearedCounts: {
    readonly learnedAliases: number;
    readonly provisionalProducts: number;
    readonly priceObservations: number;
  };
  /**
   * Always the literal `true` - never a plain boolean. This makes it
   * structurally impossible for a caller to write a success path that
   * doesn't handle the limitation: KB-110's sync worker has no
   * generalized delete-propagation mechanism today (push-only, plus
   * bill_items' specific delete-then-reinsert, which doesn't generalize -
   * see docs/12-PARKED.md NI-27), so matching rows on the server are NOT
   * deleted by this function and can resurrect this shop's "reset"
   * learning state on its next sync.
   */
  readonly remoteDeletionNotPerformed: true;
  readonly warning: string;
}

/**
 * Local-only reset, by design (owner's explicit call, KB-210) - building
 * real delete-sync as a side effect of a settings action would be scope
 * creep onto infrastructure KB-110 doesn't have. Does NOT clear
 * learningEvents - docs/08-LEARNING-ENGINE.md section 10 rule 6 ("every
 * decision is logged") applies to the reset itself, not just what it
 * clears; an audit log that goes silent on the one action most worth
 * auditing has a hole exactly where it matters most. Instead, appends a
 * real learning_reset event recording what was cleared.
 */
export async function resetLearning(
  db: KiranaBillDB,
  shopId: string,
  nowMs: number,
  deviceId: string,
): Promise<ResetLearningResult> {
  const [learnedAliasesCount, provisionalProductsCount, priceObservationsCount] = await Promise.all([
    db.learnedAliases.where("shopId").equals(shopId).count(),
    db.provisionalProducts.where("shopId").equals(shopId).count(),
    db.priceObservations.where("shopId").equals(shopId).count(),
  ]);

  await Promise.all([
    db.learnedAliases.where("shopId").equals(shopId).delete(),
    db.provisionalProducts.where("shopId").equals(shopId).delete(),
    db.priceObservations.where("shopId").equals(shopId).delete(),
    // KB-329: the ignores are cleared like the rest. The bill_learned markers stay - they stop bills being learned twice.
    db.learningEvents.where("shopId").equals(shopId).filter((e) => e.eventType === PRICE_IGNORE_EVENT).delete(),
  ]);

  const clearedCounts = {
    learnedAliases: learnedAliasesCount,
    provisionalProducts: provisionalProductsCount,
    priceObservations: priceObservationsCount,
  };

  const nowIso = new Date(nowMs).toISOString();
  await db.learningEvents.add({
    localId: crypto.randomUUID(),
    shopId,
    syncStatus: "pending",
    billLocalId: "",
    eventType: "learning_reset",
    payload: { clearedCounts },
    createdAt: nowIso,
    updatedAt: nowIso,
    deviceId,
  });

  return {
    shopId,
    clearedCounts,
    remoteDeletionNotPerformed: true,
    warning:
      "Local learning data cleared. Matching rows on the server were not deleted and may reappear the next time this device syncs.",
  };
}
