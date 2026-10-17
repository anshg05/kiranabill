import { aliasKeyOf, deriveAliases, type AliasEvent, type DerivedAlias } from "@/domain/aliasEvidence";
import type { KiranaBillDB, LocalLearningEvent } from "./db";

// KB-323 (D81) / KB-321: reading the learning evidence back. Everything here is read-only over the local database except
// removeLearnedAlias (one append-only event) - nothing writes a bill, a price or a catalog row.

/** The events alias confidence is derived from. */
export const ALIAS_EVIDENCE_TYPES = ["alias_confirmed", "alias_suppressed", "alias_removed"] as const;
/** Everything about aliases the pull must bring (alias_conflict is the audit trail of a winner change - read, never summed). */
export const ALIAS_PULL_TYPES = [...ALIAS_EVIDENCE_TYPES, "alias_conflict"] as const;
export const USAGE_WINDOW_DAYS = 30;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Bills of this shop that were cancelled, by both ids (an own event knows its bill's local id, a pulled one its server id). */
async function cancelledBillIds(db: KiranaBillDB, shopId: string): Promise<{ local: Set<string>; server: Set<string> }> {
  const cancelled = await db.billCancellations.where("shopId").equals(shopId).toArray();
  const local = new Set(cancelled.map((c) => c.billLocalId));
  const bills = await db.bills.bulkGet([...local]);
  return { local, server: new Set(bills.flatMap((b) => (b?.serverId ? [b.serverId] : []))) };
}

function toAliasEvent(e: LocalLearningEvent, cancelled: { local: Set<string>; server: Set<string> }): AliasEvent | null {
  const alias = str(e.payload.alias);
  const shopProductId = str(e.payload.shop_product_id);
  if (!alias || !shopProductId) return null; // a damaged event teaches nothing
  return {
    localId: e.localId,
    eventType: e.eventType as AliasEvent["eventType"],
    alias,
    shopProductId,
    sourceLayer: str(e.payload.source_layer),
    createdAt: e.createdAt,
    cancelled: (!!e.billLocalId && cancelled.local.has(e.billLocalId)) || (!!e.billServerId && cancelled.server.has(e.billServerId)),
  };
}

export async function loadAliasEvents(db: KiranaBillDB, shopId: string): Promise<AliasEvent[]> {
  const rows = await db.learningEvents.where("[shopId+eventType]").anyOf(ALIAS_EVIDENCE_TYPES.map((t) => [shopId, t])).toArray();
  const cancelled = await cancelledBillIds(db, shopId);
  return rows.flatMap((r) => toAliasEvent(r, cancelled) ?? []);
}

/** This shop's aliases as the events say they are (active or not; the caller filters). */
export async function deriveShopAliases(db: KiranaBillDB, shopId: string): Promise<DerivedAlias[]> {
  return deriveAliases(await loadAliasEvents(db, shopId));
}

/**
 * "Not this" / Remove: one strong, append-only event (-1.0). Bill-less like learning_reset (bill_id null on the server),
 * so it syncs at once and every device derives the alias as retired. The alias row is not touched.
 */
export async function removeLearnedAlias(db: KiranaBillDB, shopId: string, deviceId: string, alias: string, shopProductId: string, nowMs: number = Date.now()): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  await db.learningEvents.add({
    localId: crypto.randomUUID(),
    shopId,
    syncStatus: "pending",
    billLocalId: "",
    eventType: "alias_removed",
    payload: { alias, shop_product_id: shopProductId, source_layer: "manual", trigger: "not_this" },
    createdAt: nowIso,
    updatedAt: nowIso,
    deviceId,
  });
}

/**
 * KB-321: how many of this shop's finalised bills in the last 30 days carried each product. Counted once per bill, by the
 * shop product id, whoever typed or said it. A cancelled bill is not final, so it is out; its replacement is a final bill
 * and counts - the sale happened once. Local only: the server's use_count is a pull-only cache (D62) nothing writes.
 */
export async function loadRecentFrequency(db: KiranaBillDB, shopId: string, nowMs: number = Date.now()): Promise<Record<string, number>> {
  const since = new Date(nowMs - USAGE_WINDOW_DAYS * 86_400_000).toISOString();
  const bills = await db.bills.where("shopId").equals(shopId).filter((b) => b.status === "final" && !!b.finalizedAt && b.finalizedAt >= since).toArray();
  if (bills.length === 0) return {};
  const items = await db.billItems.where("billLocalId").anyOf(bills.map((b) => b.localId)).toArray();
  const seen = new Set<string>();
  const freq: Record<string, number> = {};
  for (const i of items) {
    if (!i.shopProductId) continue;
    const once = `${i.billLocalId}|${i.shopProductId}`;
    if (seen.has(once)) continue;
    seen.add(once);
    freq[i.shopProductId] = (freq[i.shopProductId] ?? 0) + 1;
  }
  return freq;
}

export { aliasKeyOf };
