import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import { KiranaBillDB, type LocalLearningEvent, type LocalShopProduct } from "./db";
import { deriveShopAliases, loadRecentFrequency, removeLearnedAlias } from "./aliasEvidence";
import { loadShopCatalog } from "./shopCatalog";
import { resetLearning } from "./learningAudit";
import { learnFromSavedBill } from "./learnBill";

// KB-323 (D81) and KB-321, on the real local database: what the parser's catalog gains from learning, what a cancelled bill
// or a removal does to it, and how the Catalog's "most used" is counted.

const shopId = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-17T10:00:00.000Z");
const DAY = 86_400_000;
let db: KiranaBillDB;
let n = 0;
beforeEach(() => {
  db = new KiranaBillDB(`alias-${crypto.randomUUID()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const product = (over: Partial<LocalShopProduct>): LocalShopProduct => ({
  id: crypto.randomUUID(), shopId, baseProductId: null, displayName: "X", category: null, unit: "packet", pricePaise: 1000, aliases: [], source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...over,
});
const event = (type: string, over: Partial<LocalLearningEvent> & { alias?: string; product?: string; layer?: string } = {}): LocalLearningEvent => {
  const { alias = "pale ji", product: p = "p-parle", layer = "fastpath", ...rest } = over;
  const t = new Date(NOW - (100 - n) * 1000).toISOString();
  return { localId: `ev-${n++}`, shopId, syncStatus: "synced", billLocalId: "", eventType: type, payload: { alias, shop_product_id: p, source_layer: layer }, createdAt: t, updatedAt: t, deviceId: "d", ...rest };
};
const confirmations = (k: number, over: Parameters<typeof event>[1] = {}) => Array.from({ length: k }, () => event("alias_confirmed", over));

async function bill(localId: string, over: { status?: "final" | "cancelled"; at?: number; lines: (string | null)[]; source?: "voice" | "manual" | "fastpath"; spoken?: string }) {
  await db.bills.add({
    localId, serverId: `srv-${localId}`, shopId, status: over.status ?? "final", syncStatus: "synced", receiptNumber: localId, receiptNumberSource: "block", customerName: "Cash", customerMobile: null,
    subtotalPaise: 0, totalPaise: 0, schemaVersion: 1, deviceId: "d", createdAt: new Date(over.at ?? NOW).toISOString(), finalizedAt: new Date(over.at ?? NOW).toISOString(), syncedAt: null,
  });
  await db.billItems.bulkAdd(over.lines.map((p, i) => ({ billLocalId: localId, shopId, lineNo: i + 1, shopProductId: p, displayName: "x", spokenName: over.spoken ?? "x", qty: 1, unit: "packet", ratePaise: 100, rateUnit: "packet", totalPaise: 100, priceType: "rate" as const, source: over.source ?? "fastpath", reviewFlags: [], wasEdited: false })));
}

describe("a promoted learned alias reaches the parser - in memory only", () => {
  beforeEach(async () => {
    await db.shopProducts.bulkPut([product({ id: "p-parle", displayName: "Parle-G", aliases: ["parle g"] }), product({ id: "p-tide", displayName: "Tide", aliases: ["tide"] })]);
  });

  it("three fast-path confirmations: Layer 1 now reads the phrase, and shop_products is NOT written", async () => {
    await db.learningEvents.bulkAdd(confirmations(3));
    const before = JSON.stringify(await db.shopProducts.toArray());
    const cat = await loadShopCatalog(db, shopId);
    expect(cat.entries.find((e) => e.id === "p-parle")!.aliases).toContain("pale ji");
    expect(parseUtterance("2 pale ji", prepareParserCatalog(cat.entries))![0]).toMatchObject({ catalogId: "p-parle" });
    expect(cat.learned["pale ji"]).toMatchObject({ catalogId: "p-parle", confidence: 0.9 });
    expect(JSON.stringify(await db.shopProducts.toArray())).toBe(before); // D81: a server cache is never rewritten
  });

  it("two confirmations are not enough; neither is a phrase heard once", async () => {
    await db.learningEvents.bulkAdd(confirmations(2));
    const cat = await loadShopCatalog(db, shopId);
    expect(cat.entries.find((e) => e.id === "p-parle")!.aliases).not.toContain("pale ji");
    expect(cat.learned).toEqual({});
  });

  it("a phrase that is another product's exact name or alias is never taken over (KI-52)", async () => {
    await db.learningEvents.bulkAdd(confirmations(5, { alias: "tide", product: "p-parle" }));
    const cat = await loadShopCatalog(db, shopId);
    expect(cat.entries.find((e) => e.id === "p-parle")!.aliases).not.toContain("tide");
    expect(parseUtterance("1 tide", prepareParserCatalog(cat.entries))![0]).toMatchObject({ catalogId: "p-tide" });
  });

  it("an archived product's alias is not used", async () => {
    await db.shopProducts.update("p-parle", { isActive: false });
    await db.learningEvents.bulkAdd(confirmations(3));
    const cat = await loadShopCatalog(db, shopId);
    expect(cat.entries.map((e) => e.id)).toEqual(["p-tide"]);
    expect(cat.learned).toEqual({});
  });

  it("Gemini-sourced: five needed, not three", async () => {
    await db.learningEvents.bulkAdd(confirmations(3, { layer: "gemini" }));
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({});
    await db.learningEvents.bulkAdd(confirmations(2, { layer: "gemini" }));
    expect((await loadShopCatalog(db, shopId)).learned["pale ji"]).toMatchObject({ confidence: 0.8 });
  });

  it("another shop's events never reach this shop's parser (hard rule 12)", async () => {
    await db.learningEvents.bulkAdd(confirmations(3, { shopId: "99999999-9999-4999-8999-999999999999" }));
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({});
  });
});

describe("a cancelled bill's lessons do not count (NI-50)", () => {
  beforeEach(async () => {
    await db.shopProducts.put(product({ id: "p-parle", displayName: "Parle-G" }));
  });
  const cancel = (billLocalId: string) => db.billCancellations.add({ localId: crypto.randomUUID(), shopId, billLocalId, reason: "wrong_item", replacementLocalId: null, cancelledAt: new Date(NOW).toISOString(), deviceId: "d", syncStatus: "synced", updatedAt: new Date(NOW).toISOString() });

  it("this phone's own events: found by the bill's local id", async () => {
    await bill("b3", { status: "cancelled", lines: ["p-parle"] });
    await db.learningEvents.bulkAdd([...confirmations(2), event("alias_confirmed", { billLocalId: "b3" })]);
    await cancel("b3");
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({});
  });

  it("a PULLED event knows its bill only by the server's id - found through the cancelled bill's row", async () => {
    await bill("b3", { status: "cancelled", lines: ["p-parle"] });
    await db.learningEvents.bulkAdd([...confirmations(2), event("alias_confirmed", { billServerId: "srv-b3" })]);
    expect((await loadShopCatalog(db, shopId)).learned["pale ji"]).toMatchObject({ confidence: 0.9 }); // not cancelled yet
    await cancel("b3");
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({}); // the cancellation arrives later: demoted
  });
});

describe("alias_conflict: one phrase, two products (08 section 4) - logged, and the derivation picks the winner", () => {
  beforeEach(async () => {
    await db.shopProducts.bulkPut([product({ id: "p-parle", displayName: "Parle-G" }), product({ id: "p-tide", displayName: "Tide" })]);
  });
  it("a bill that confirms the phrase for ANOTHER product than the current winner writes an alias_conflict event", async () => {
    await db.learningEvents.bulkAdd(confirmations(3)); // pale ji -> p-parle, promoted
    await bill("b1", { lines: ["p-tide"], spoken: "pale ji" });
    await learnFromSavedBill(db, "b1", NOW);
    const conflict = (await db.learningEvents.toArray()).find((e) => e.eventType === "alias_conflict")!;
    expect(conflict).toMatchObject({ billLocalId: "b1", syncStatus: "pending", payload: { alias: "pale ji", from_product: "p-parle", to_product: "p-tide" } });
    // the winner is still the product with the evidence - one confirmation for the rival does not take the phrase over
    expect((await loadShopCatalog(db, shopId)).learned["pale ji"]).toMatchObject({ catalogId: "p-parle" });
  });
  it("no conflict when the phrase goes to the same product, or when nothing was learned for it yet", async () => {
    await db.learningEvents.bulkAdd(confirmations(3));
    await bill("b1", { lines: ["p-parle"], spoken: "pale ji" });
    await bill("b2", { lines: ["p-tide"], spoken: "nayi cheez" });
    await learnFromSavedBill(db, "b1", NOW);
    await learnFromSavedBill(db, "b2", NOW);
    expect((await db.learningEvents.toArray()).filter((e) => e.eventType === "alias_conflict")).toEqual([]);
  });
});

describe("Not this: removeLearnedAlias", () => {
  it("writes one bill-less, pending, append-only event; the alias is retired at once; nothing else is touched", async () => {
    await db.shopProducts.put(product({ id: "p-parle", displayName: "Parle-G" }));
    await db.learningEvents.bulkAdd(confirmations(3));
    await removeLearnedAlias(db, shopId, "dev-1", "pale ji", "p-parle", NOW);
    const removed = (await db.learningEvents.toArray()).find((e) => e.eventType === "alias_removed")!;
    expect(removed).toMatchObject({ shopId, billLocalId: "", syncStatus: "pending", deviceId: "dev-1", payload: { alias: "pale ji", shop_product_id: "p-parle", trigger: "not_this" } });
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({});
    expect((await deriveShopAliases(db, shopId))[0]).toMatchObject({ active: false });
  });
});

describe("a Reset of learning clears the alias evidence too (the shop's reset cutoff)", () => {
  it("every alias event of this shop is gone, another shop's stay; the reset is logged", async () => {
    await db.learningEvents.bulkAdd([...confirmations(3), event("alias_removed"), event("alias_conflict"), event("alias_confirmed", { shopId: "99999999-9999-4999-8999-999999999999" })]);
    await resetLearning(db, shopId, NOW, "dev-1");
    const left = await db.learningEvents.toArray();
    expect(left.filter((e) => e.shopId === shopId).map((e) => e.eventType)).toEqual(["learning_reset"]);
    expect(left.filter((e) => e.shopId !== shopId)).toHaveLength(1);
  });
});

describe("a device that joins late computes the same confidence", () => {
  it("the events inserted in any order, split over two pulls, give the same derived alias", async () => {
    const all = [...confirmations(4), event("alias_suppressed"), ...confirmations(2, { layer: "gemini" }), event("alias_confirmed", { product: "p-other" })];
    const early = new KiranaBillDB(`early-${crypto.randomUUID()}`);
    await early.learningEvents.bulkAdd(all);
    await db.learningEvents.bulkAdd([...all].slice(5).reverse());
    await db.learningEvents.bulkAdd([...all].slice(0, 5));
    expect(await deriveShopAliases(db, shopId)).toEqual(await deriveShopAliases(early, shopId));
    early.close();
    await early.delete();
  });
});

describe("KB-321: recent usage, counted from this shop's own final bills", () => {
  it("bills in the last 30 days, once per bill per product, hand-added lines included", async () => {
    await bill("b1", { lines: ["a", "a", "b"] }); // a twice on one bill = once
    await bill("b2", { lines: ["a"], source: "manual" }); // typed by hand: counts
    await bill("b3", { lines: ["b", null] }); // a line with no product: out
    await bill("old", { at: NOW - 31 * DAY, lines: ["a"] });
    expect(await loadRecentFrequency(db, shopId, NOW)).toEqual({ a: 2, b: 2 });
  });

  it("a cancelled bill is out; its replacement is a final bill and counts - the sale happened once", async () => {
    await bill("orig", { status: "cancelled", lines: ["a"] });
    await bill("fix", { lines: ["a"] });
    expect(await loadRecentFrequency(db, shopId, NOW)).toEqual({ a: 1 });
  });

  it("another shop's bills never count; an empty shop is {}", async () => {
    expect(await loadRecentFrequency(db, shopId, NOW)).toEqual({});
    await db.bills.add({ localId: "x", shopId: "99999999-9999-4999-8999-999999999999", status: "final", syncStatus: "synced", receiptNumber: "x", receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 0, totalPaise: 0, schemaVersion: 1, deviceId: "d", createdAt: new Date(NOW).toISOString(), finalizedAt: new Date(NOW).toISOString(), syncedAt: null });
    await db.billItems.add({ billLocalId: "x", shopId: "99999999-9999-4999-8999-999999999999", lineNo: 1, shopProductId: "a", displayName: "x", spokenName: "x", qty: 1, unit: "kg", ratePaise: 1, rateUnit: "kg", totalPaise: 1, priceType: "rate", source: "fastpath", reviewFlags: [], wasEdited: false });
    expect(await loadRecentFrequency(db, shopId, NOW)).toEqual({});
  });

  it("loadShopCatalog carries it as recentFrequency beside useCount", async () => {
    await db.shopProducts.put(product({ id: "a", displayName: "Alpha", useCount: 0 }));
    await bill("b1", { at: Date.now(), lines: ["a"] });
    expect((await loadShopCatalog(db, shopId)).usageById["a"]).toEqual({ useCount: 0, recentFrequency: 1 });
  });
});
