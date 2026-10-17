import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import { KiranaBillDB, type LocalLearningEvent, type LocalShopProduct } from "./db";
import { learnThenReload } from "./learnBill";
import { markLearningPullDone } from "./pullLearning";
import { loadShopCatalog } from "./shopCatalog";

// KB-323 (D81): "after a bill's learning promotes an alias, the parser catalog reloads, so the very NEXT utterance uses it."
// The billing screen runs learnThenReload when a bill is saved; its `reload` is the catalog reload.

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
beforeEach(async () => {
  db = new KiranaBillDB(`ltr-${crypto.randomUUID()}`);
  await markLearningPullDone(db, shopId);
  const p = (id: string, name: string): LocalShopProduct => ({ id, shopId, baseProductId: null, displayName: name, category: null, unit: "packet", pricePaise: 1000, aliases: [name], source: "custom", useCount: 0, sku: null, barcode: null, isActive: true });
  await db.shopProducts.bulkPut([p("p-parle", "Parle-G"), p("p-tide", "Tide")]);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const confirmed = (i: number): LocalLearningEvent => ({ localId: `old-${i}`, shopId, syncStatus: "synced", billLocalId: "", eventType: "alias_confirmed", payload: { alias: "pale ji", shop_product_id: "p-parle", source_layer: "fastpath" }, createdAt: new Date(Date.now() - 100_000 + i).toISOString(), updatedAt: new Date().toISOString(), deviceId: "d" });
async function savedBillWithPhrase() {
  const at = new Date().toISOString();
  await db.bills.add({ localId: "b-new", serverId: undefined, shopId, status: "final", syncStatus: "pending", receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 1000, totalPaise: 1000, schemaVersion: 1, deviceId: "d", createdAt: at, finalizedAt: at, syncedAt: null });
  await db.billItems.add({ billLocalId: "b-new", shopId, lineNo: 1, shopProductId: "p-parle", displayName: "Parle-G", spokenName: "pale ji", qty: 1, unit: "packet", ratePaise: 1000, rateUnit: "packet", totalPaise: 1000, priceType: "rate", source: "fastpath", reviewFlags: [], wasEdited: false });
}

describe("learnThenReload", () => {
  it("the third confirmation promotes the alias, and the catalog the reload sees already reads it - the next utterance uses it", async () => {
    await db.learningEvents.bulkAdd([confirmed(1), confirmed(2)]); // 0.7: not yet
    await savedBillWithPhrase(); // this bill is the third
    let parsedAtReload: unknown = null;
    const reload = vi.fn(async () => {
      const cat = await loadShopCatalog(db, shopId);
      parsedAtReload = parseUtterance("2 pale ji", prepareParserCatalog(cat.entries))?.[0]?.catalogId ?? null;
    });
    await learnThenReload(db, shopId, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(parsedAtReload).toBe("p-parle");
  });

  it("the reload happens AFTER the learning (a reload first would show the old catalog)", async () => {
    await db.learningEvents.bulkAdd([confirmed(1), confirmed(2)]);
    await savedBillWithPhrase();
    const seen: number[] = [];
    await learnThenReload(db, shopId, async () => {
      seen.push((await db.learningEvents.toArray()).filter((e) => e.eventType === "alias_confirmed").length);
    });
    expect(seen).toEqual([3]); // 2 old + this bill's
  });

  it("a learning failure never stops the reload (the bill is saved either way)", async () => {
    const reload = vi.fn(async () => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.close(); // every read now throws
    await expect(learnThenReload(db, shopId, reload)).resolves.toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
