import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import { changeProduct } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB, type LocalLearningEvent } from "./db";
import type { FinaliseInput } from "./finalise";
import { finaliseBill } from "./testNumbers";
import { learnFromSavedBill } from "./learnBill";
import { deriveShopAliases } from "./aliasEvidence";
import { cancelBillLocal } from "./cancelBill";
import { loadShopCatalog } from "./shopCatalog";

// KB-336 (D83): a changed product on a line, end to end on the local database: what finalise keeps (locally), what learning
// writes (a +0.4 correction for the chosen product, -0.2 for an abandoned learned mapping, a logged conflict), and that a
// cancelled bill's correction counts for nothing.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-17T12:00:00.000Z");
let db: KiranaBillDB;
const entryNamed = (name: string) => SEED_PARSER_CATALOG.entries.find((e) => e.displayName === name)!;
const PARLE = entryNamed("Parle-G 10");
const TIDE = entryNamed("Tide");

beforeEach(async () => {
  db = new KiranaBillDB(`chg-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Test", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "hi", receiptPrefix: "KB", updatedAt: "2026-10-17T00:00:00.000Z", deviceId } as never);
  await db.shopProducts.bulkPut(SEED_PARSER_CATALOG.entries.map((e) => ({ id: e.id, shopId, baseProductId: e.id, displayName: e.displayName, category: null, unit: e.unit, pricePaise: e.suggestedPricePaise, aliases: e.aliases, source: "base" as const, useCount: 0, sku: null, barcode: null, isActive: true })));
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};
/** "2 packet parle jee" read by Layer 1 (Parle-G 10) - then the shopkeeper picks `to`. */
function corrected(n: number, to: typeof TIDE | null, source: FinalLine["source"] = "fastpath"): FinalLine {
  const [original] = parseUtterance("2 packet parle jee", SEED_PARSER_CATALOG)!;
  const item = to ? ok(changeProduct(original!, to)) : original!;
  return { id: `l${n}`, utteranceId: n, item, original: original!, displayName: (to ?? PARLE).displayName, source };
}
const bill = (lines: FinalLine[]): FinaliseInput => ({ localId: crypto.randomUUID(), shopId, deviceId, startedAt: "2026-10-17T10:00:00.000Z", customer: { name: "Cash", mobile: null }, lines, flags: [] });
async function save(lines: FinalLine[]): Promise<string> {
  const input = bill(lines);
  await finaliseBill(db, input);
  return input.localId;
}
const events = async (type: string) => (await db.learningEvents.toArray()).filter((e) => e.eventType === type);
const seeded = (n: number, product: string): LocalLearningEvent[] =>
  Array.from({ length: n }, (_, i) => ({ localId: `old-${product}-${i}`, shopId, syncStatus: "synced" as const, billLocalId: "", eventType: "alias_confirmed", payload: { alias: "parle jee", shop_product_id: product, source_layer: "fastpath" }, createdAt: new Date(NOW - 100_000 + i).toISOString(), updatedAt: "x", deviceId: "d" }));

describe("finalise keeps the product the line was first read as (locally)", () => {
  it("a changed line carries originalProductId and was_edited; an unchanged line carries neither", async () => {
    const id = await save([corrected(1, TIDE), corrected(2, null)]);
    const [changed, same] = await db.billItems.where("billLocalId").equals(id).sortBy("lineNo");
    expect(changed).toMatchObject({ shopProductId: TIDE.id, originalProductId: PARLE.id, wasEdited: true, spokenName: "parle jee" });
    expect(same!.originalProductId).toBeUndefined();
    expect(same!.wasEdited).toBe(false);
  });
});

describe("learning from a corrected line", () => {
  it("one correction: a +0.4 event for the CHOSEN product, remembering the first one - not promoted on its own", async () => {
    const id = await save([corrected(1, TIDE)]);
    await learnFromSavedBill(db, id, NOW);
    expect((await events("alias_confirmed"))[0]).toMatchObject({ billLocalId: id, payload: { alias: "parle jee", shop_product_id: TIDE.id, source_layer: "correction", corrected_from: PARLE.id } });
    expect((await deriveShopAliases(db, shopId))[0]).toMatchObject({ aliasKey: "parle jee", catalogId: TIDE.id, confidence: 0.7 });
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({});
  });

  it("the second correction promotes it - Layer 1 then reads the phrase as the chosen product", async () => {
    await learnFromSavedBill(db, await save([corrected(1, TIDE)]), NOW);
    await learnFromSavedBill(db, await save([corrected(1, TIDE)]), NOW + 1000);
    const cat = await loadShopCatalog(db, shopId);
    expect(cat.learned["parle jee"]).toMatchObject({ catalogId: TIDE.id });
    expect(parseUtterance("1 parle jee", prepareParserCatalog(cat.entries))![0]).toMatchObject({ catalogId: TIDE.id });
  });

  it("correcting away from a learned mapping: the abandoned product gets -0.2 and the conflict is logged", async () => {
    await db.learningEvents.bulkAdd(seeded(3, PARLE.id)); // "parle jee" -> Parle-G 10, promoted (0.9)
    expect((await deriveShopAliases(db, shopId))[0]).toMatchObject({ catalogId: PARLE.id, confidence: 0.9 });
    await learnFromSavedBill(db, await save([corrected(1, TIDE)]), NOW);
    expect((await events("alias_suppressed"))[0]).toMatchObject({ payload: { alias: "parle jee", shop_product_id: PARLE.id, source_layer: "correction", trigger: "product_changed" } });
    expect((await events("alias_conflict"))[0]).toMatchObject({ payload: { alias: "parle jee", from_product: PARLE.id, to_product: TIDE.id } });
    const a = (await deriveShopAliases(db, shopId))[0]!;
    expect(a.confidence).toBeLessThan(0.8); // neither product is trusted after one correction
    expect((await loadShopCatalog(db, shopId)).learned).toEqual({});
  });

  it("no abandoned-mapping suppression when nothing was learned for the first product", async () => {
    await learnFromSavedBill(db, await save([corrected(1, TIDE)]), NOW);
    expect(await events("alias_suppressed")).toEqual([]);
  });

  it("a cancelled bill's correction counts for nothing (NI-50, D81)", async () => {
    const id = await save([corrected(1, TIDE)]);
    await learnFromSavedBill(db, id, NOW);
    expect(await deriveShopAliases(db, shopId)).toHaveLength(1);
    expect((await cancelBillLocal(db, { shopId, billLocalId: id, reason: "wrong_item", deviceId, replacementLocalId: null })).ok).toBe(true);
    expect(await deriveShopAliases(db, shopId)).toEqual([]);
  });

  it("a line added by hand teaches nothing, however its product changed", async () => {
    await learnFromSavedBill(db, await save([corrected(1, TIDE, "manual")]), NOW);
    expect(await events("alias_confirmed")).toEqual([]);
  });
});
