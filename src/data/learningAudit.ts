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

/**
 * Marshals this shop's LocalPriceObservation rows into the
 * LearningState.priceObservations shape learning.ts's real
 * getPriceSuggestions() already expects, then calls it - no duplicate
 * suggestion logic. ignoredUntilMs is always null: LocalPriceObservation
 * has no persisted ignore-state field today, and nothing writes one yet
 * either (KB-208's real-data check confirmed this is a real, permanent
 * gap in the current schema, not an oversight in this function).
 */
export async function listPendingPriceSuggestions(
  db: KiranaBillDB,
  shopId: string,
  nowMs: number,
): Promise<readonly PriceSuggestion[]> {
  const rows = await db.priceObservations.where("shopId").equals(shopId).toArray();

  const byProduct: Record<string, PriceTrackedProduct> = {};
  for (const row of rows) {
    const existing = byProduct[row.shopProductId];
    const observation = { pricePaise: row.observedPricePaise, observedAtMs: new Date(row.occurredAt).getTime() };
    byProduct[row.shopProductId] = {
      catalogId: row.shopProductId,
      observations: existing ? [...existing.observations, observation] : [observation],
      ignoredUntilMs: null,
    };
  }

  const state: LearningState = {
    provisionalProducts: {},
    learnedAliases: {},
    priceObservations: byProduct,
  };

  return getPriceSuggestions(state, nowMs);
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
