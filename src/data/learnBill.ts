import type { CatalogEntry } from "@/domain/catalog";
import { deterministicUuid } from "@/domain/ids";
import { learnFromBill, type LearnLine, type LearningDecision, type LearningState, type PriceTrackedProduct, type ProvisionalProduct, type LearnedAlias } from "@/domain/learning";
import type { KiranaBillDB, LocalLearnedAlias, LocalLearningEvent, LocalPriceObservation, LocalProvisionalProduct } from "./db";

// KB-307 commit 3 (owner, 3 Oct 2026; docs/08-LEARNING-ENGINE.md §8): learning
// runs AFTER the bill is committed and the receipt shown, in its OWN Dexie
// transaction, from the committed bill - so a learning bug can never stop or
// slow a bill (safety rule 7). The marshalling the KB-307 row asked for lives
// here: Dexie rows <-> domain/learning.ts's LearningState.
//
// Idempotent (owner): every row's id is derived from the bill (or, for the
// one-per-alias / one-per-product rows, from the shop + key), and a
// "bill_learned" marker event is written in the same transaction. A bill whose
// marker exists is skipped - recovery after a crash, or two tabs at once
// (KI-39), changes nothing. Hard rule 8: only FINAL bills are ever read.

const MARKER = "bill_learned";

const key = (text: string) => text.trim().toLowerCase();
const markerId = (billLocalId: string) => deterministicUuid(MARKER, billLocalId);

export interface LearnResult {
  /** False when the bill had already been learned (or isn't final) - nothing written. */
  readonly learned: boolean;
  readonly decisions: number;
}

/** Event payloads: snake_case, the decision's facts only - never customer data. */
function payloadOf(d: LearningDecision): Record<string, unknown> {
  switch (d.kind) {
    case "alias_confirmed":
      return { alias: d.alias, shop_product_id: d.shopProductId, source_layer: d.sourceLayer, confidence_before: d.confidenceBefore, confidence_after: d.confidenceAfter, hit_count: d.hitCount, promoted: d.promoted, trigger: "confirmed_without_edit" };
    case "alias_suppressed":
      return { alias: d.alias, shop_product_id: d.shopProductId, source_layer: d.sourceLayer, confidence_before: d.confidenceBefore, confidence_after: d.confidenceAfter, retired: d.retired, trigger: "line_deleted" };
    case "price_observed":
      return { shop_product_id: d.shopProductId, observed_price_paise: d.observedPricePaise, shop_price_paise: d.shopPricePaise };
    case "product_sighted":
      return { spoken_name: d.spokenName, unit: d.unit, price_paise: d.pricePaise, seen_count: d.seenCount, promotion_due: d.promotionDue };
  }
}

const positionOf = (d: LearningDecision) => (d.kind === "alias_suppressed" ? `removed-${d.index}` : `line-${d.lineNo}`);

/** Learns one finalised bill, once. Throws if the write fails - nothing is then written, and recovery tries again. */
export async function learnFromSavedBill(localDb: KiranaBillDB, billLocalId: string, nowMs: number = Date.now()): Promise<LearnResult> {
  const tables = [localDb.learnedAliases, localDb.provisionalProducts, localDb.priceObservations, localDb.learningEvents, localDb.bills, localDb.billItems, localDb.shopProducts];
  return localDb.transaction("rw", tables, async () => {
    if (await localDb.learningEvents.get(markerId(billLocalId))) return { learned: false, decisions: 0 };
    const bill = await localDb.bills.get(billLocalId);
    if (!bill || bill.status !== "final") return { learned: false, decisions: 0 };
    const { shopId, deviceId } = bill;
    const nowIso = new Date(nowMs).toISOString();

    const items = await localDb.billItems.where("billLocalId").equals(billLocalId).sortBy("lineNo");
    const catalog: CatalogEntry[] = (await localDb.shopProducts.where("shopId").equals(shopId).toArray()).map((p) => ({
      id: p.id, displayName: p.displayName, aliases: p.aliases, unit: p.unit, suggestedPricePaise: p.pricePaise,
      isActive: p.isActive, sourceCategory: p.category ?? "", guardCategory: "other",
    }));

    // Dexie -> LearningState (this shop only - hard rule 12).
    const aliasRows = await localDb.learnedAliases.where("shopId").equals(shopId).toArray();
    const provisionalRows = (await localDb.provisionalProducts.where("shopId").equals(shopId).toArray()).filter((p) => p.promotedAt === null);
    const observationRows = await localDb.priceObservations.where("shopId").equals(shopId).toArray();
    const aliasByKey = new Map(aliasRows.map((a) => [key(a.alias), a]));
    const provisionalByKey = new Map(provisionalRows.map((p) => [key(p.spokenName), p]));
    const priceObservations: Record<string, PriceTrackedProduct> = {};
    for (const o of observationRows) {
      const tracked = priceObservations[o.shopProductId];
      const obs = { pricePaise: o.observedPricePaise, observedAtMs: Date.parse(o.occurredAt) };
      priceObservations[o.shopProductId] = { catalogId: o.shopProductId, observations: [...(tracked?.observations ?? []), obs], ignoredUntilMs: null };
    }
    const state: LearningState = {
      learnedAliases: Object.fromEntries(aliasRows.map((a): [string, LearnedAlias] => [key(a.alias), { aliasKey: key(a.alias), catalogId: a.shopProductId, confidence: a.confidence, hitCount: a.hitCount }])),
      // Only the latest suggested price is stored per provisional product, so that's the history the modal price sees.
      provisionalProducts: Object.fromEntries(provisionalRows.map((p): [string, ProvisionalProduct] => [key(p.spokenName), { spokenName: p.spokenName, displayName: p.spokenName, unit: p.suggestedUnit ?? "", seenCount: p.seenCount, priceObservations: p.suggestedPricePaise === null ? [] : [p.suggestedPricePaise] }])),
      priceObservations,
    };

    const lines: LearnLine[] = items.map((i) => ({
      lineNo: i.lineNo, shopProductId: i.shopProductId, spokenName: i.spokenName, displayName: i.displayName,
      unit: i.unit, ratePaise: i.ratePaise, rateUnit: i.rateUnit, source: i.source, wasEdited: i.wasEdited,
    }));
    const { decisions } = learnFromBill(state, { lines, discarded: bill.discardedLines ?? [] }, catalog, nowMs);

    const events: LocalLearningEvent[] = [];
    const event = (eventType: string, position: string, payload: Record<string, unknown>) =>
      events.push({ localId: deterministicUuid("learning_event", billLocalId, eventType, position), shopId, syncStatus: "pending", billLocalId, eventType, payload, createdAt: nowIso, updatedAt: nowIso, deviceId });

    for (const d of decisions) {
      if (d.kind === "alias_confirmed" || d.kind === "alias_suppressed") {
        const existing = aliasByKey.get(key(d.alias));
        const row: LocalLearnedAlias = {
          ...(existing ?? {}),
          localId: existing?.localId ?? deterministicUuid("learned_alias", shopId, key(d.alias)),
          shopId,
          syncStatus: "pending",
          alias: existing?.alias ?? d.alias,
          shopProductId: d.shopProductId,
          hitCount: d.kind === "alias_confirmed" ? d.hitCount : (existing?.hitCount ?? 0),
          // A retired alias is kept at its last confidence (<= 0.3), not deleted:
          // deletes don't sync (NI-27), and the server must learn it too.
          confidence: d.confidenceAfter,
          source: "confirmation",
          updatedAt: nowIso,
          deviceId,
        };
        await localDb.learnedAliases.put(row);
        aliasByKey.set(key(d.alias), row);
      } else if (d.kind === "price_observed") {
        const row: LocalPriceObservation = {
          localId: deterministicUuid("price_observation", billLocalId, d.lineNo),
          shopId, syncStatus: "pending", shopProductId: d.shopProductId, observedPricePaise: d.observedPricePaise,
          occurredAt: bill.finalizedAt ?? nowIso, updatedAt: nowIso, deviceId,
        };
        await localDb.priceObservations.put(row);
      } else {
        const existing = provisionalByKey.get(key(d.spokenName));
        const row: LocalProvisionalProduct = {
          ...(existing ?? {}),
          localId: existing?.localId ?? deterministicUuid("provisional_product", shopId, key(d.spokenName)),
          shopId, syncStatus: "pending", spokenName: existing?.spokenName ?? d.spokenName, seenCount: d.seenCount,
          suggestedUnit: d.unit ?? existing?.suggestedUnit ?? null,
          suggestedPricePaise: d.pricePaise ?? existing?.suggestedPricePaise ?? null,
          // "Promotion due" is an event; creating the shop_product is KB-320.
          promotedAt: null, promotedShopProductId: null, updatedAt: nowIso, deviceId,
        };
        await localDb.provisionalProducts.put(row);
        provisionalByKey.set(key(d.spokenName), row);
        if (d.promotionDue) event("product_promotion_due", positionOf(d), { spoken_name: d.spokenName, seen_count: d.seenCount });
      }
      event(d.kind, positionOf(d), payloadOf(d));
    }

    event(MARKER, "bill", { lines: items.length, decisions: decisions.length });
    events[events.length - 1] = { ...events[events.length - 1]!, localId: markerId(billLocalId) };
    await localDb.learningEvents.bulkPut(events);
    return { learned: true, decisions: decisions.length };
  });
}

/** Recovery on start (and after every save): learns each FINAL bill of this
 * shop that has no marker yet. Returns how many were learned. */
export async function learnPendingBills(localDb: KiranaBillDB, shopId: string, nowMs: number = Date.now()): Promise<number> {
  const finals = (await localDb.bills.where("shopId").equals(shopId).toArray()).filter((b) => b.status === "final");
  let learned = 0;
  for (const bill of finals) {
    if (await localDb.learningEvents.get(markerId(bill.localId))) continue;
    if ((await learnFromSavedBill(localDb, bill.localId, nowMs)).learned) learned += 1;
  }
  return learned;
}
