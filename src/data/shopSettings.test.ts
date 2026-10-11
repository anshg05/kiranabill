import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB, type LocalShop } from "./db";
import { updateShopSettings } from "./shopSettings";
import { loadReceipt } from "./receipt";

// KB-312 (S7): a shop edit is written locally first, marked pending with a new updatedAt (that is
// also the "version" the push checks - D64), and pushed by the ordinary sync. Works offline.
const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
let dbName: string;

const shop = (over: Partial<LocalShop> = {}): LocalShop => ({
  id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: "Gali 4", logoUrl: null, catalogMode: "custom_only",
  billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-08T10:00:00.123456+00:00", ...over,
});

beforeEach(async () => {
  dbName = `shop-settings-${crypto.randomUUID()}`;
  db = new KiranaBillDB(dbName);
  await db.shops.put(shop());
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe("updateShopSettings", () => {
  it("writes the change locally, marks it pending with a new updatedAt, and touches nothing else", async () => {
    const saved = await updateShopSettings(db, shopId, { name: "Gupta Store", phone: "9876543210", billLanguage: "hi" }, Date.parse("2026-10-08T11:00:00.000Z"));
    expect(saved).toMatchObject({ name: "Gupta Store", phone: "9876543210", billLanguage: "hi", syncStatus: "pending", updatedAt: "2026-10-08T11:00:00.000Z" });
    expect(await db.shops.get(shopId)).toEqual(shop({ name: "Gupta Store", phone: "9876543210", billLanguage: "hi", syncStatus: "pending", pendingFields: ["name", "phone", "billLanguage"], updatedAt: "2026-10-08T11:00:00.000Z" })); // address, prefix, logo untouched
  });

  it("a change that changes nothing is a no-op: still synced, same updatedAt", async () => {
    const saved = await updateShopSettings(db, shopId, { name: "Sharma Kirana", phone: null, billLanguage: "en" });
    expect(saved).toMatchObject({ syncStatus: "synced", updatedAt: "2026-10-08T10:00:00.123456+00:00" });
  });

  it("two edits in the same millisecond still get different updatedAt values - it is the version the push checks", async () => {
    const t = Date.parse("2026-10-08T11:00:00.000Z");
    const a = await updateShopSettings(db, shopId, { name: "One" }, t);
    const b = await updateShopSettings(db, shopId, { name: "Two" }, t);
    expect(b!.updatedAt).not.toBe(a!.updatedAt);
    expect(b!.name).toBe("Two");
  });

  it("refuses a language that isn't en / hi / both, and an empty name - nothing is written", async () => {
    await expect(updateShopSettings(db, shopId, { billLanguage: "fr" as never })).rejects.toThrow();
    await expect(updateShopSettings(db, shopId, { name: "  " })).rejects.toThrow();
    expect(await db.shops.get(shopId)).toEqual(shop());
  });

  it("a shop that isn't on this phone is null - never created", async () => {
    expect(await updateShopSettings(db, "99999999-9999-4999-8999-999999999999", { name: "Ghost" })).toBeNull();
    expect(await db.shops.count()).toBe(1);
  });

  it("a past bill reopened shows TODAY's shop name, phone and language (owner Q4 - receipts are built from the shop row)", async () => {
    const billLocalId = crypto.randomUUID();
    await db.bills.add({ localId: billLocalId, shopId, status: "final", syncStatus: "synced", receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId: "d", createdAt: "2026-10-01T10:00:00.000Z", finalizedAt: "2026-10-01T10:00:00.000Z", syncedAt: null });
    await db.billItems.add({ billLocalId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: null, qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000, priceType: "rate", source: "manual", reviewFlags: [], wasEdited: false });
    const before = await loadReceipt(db, billLocalId);
    expect(before?.shopName).toBe("Sharma Kirana");
    expect(before?.shopPhone).toBeNull();
    expect(before?.thanks).not.toMatch(/\p{Script=Devanagari}/u); // English
    await updateShopSettings(db, shopId, { name: "Gupta Store", phone: "9876543210", billLanguage: "hi" });
    const after = await loadReceipt(db, billLocalId);
    expect(after?.shopName).toBe("Gupta Store");
    expect(after?.shopPhone).toBe("98765 43210");
    expect(after?.thanks).toMatch(/\p{Script=Devanagari}/u); // Hindi
    expect(after?.rows[0]?.qty).toContain("किलो");
    expect(after?.receiptNumber).toBe("KB-000001"); // the bill itself never changed
  });
});

describe("pending fields (KB-334, D74, NI-40): the row remembers WHICH fields this phone changed", () => {
  it("a name edit marks only the name", async () => {
    const saved = await updateShopSettings(db, shopId, { name: "Gupta Store" });
    expect(saved?.pendingFields).toEqual(["name"]);
  });

  it("a later edit while still pending adds to the set - once each, never a duplicate", async () => {
    await updateShopSettings(db, shopId, { name: "Gupta Store" });
    await updateShopSettings(db, shopId, { phone: "9876543210" });
    const again = await updateShopSettings(db, shopId, { name: "Gupta Stores" });
    expect(again?.pendingFields).toEqual(["name", "phone"]);
    expect((await updateShopSettings(db, shopId, { billLanguage: "both" }))?.pendingFields).toEqual(["name", "phone", "billLanguage"]);
  });

  it("is stored WITH the pending row: it survives a reload or an app kill", async () => {
    await updateShopSettings(db, shopId, { phone: "9876543210" });
    db.close();
    const reopened = new KiranaBillDB(dbName);
    expect(await reopened.shops.get(shopId)).toMatchObject({ syncStatus: "pending", pendingFields: ["phone"], phone: "9876543210" });
    reopened.close();
    db = new KiranaBillDB(dbName); // so afterEach can close and delete it
  });

  it("a row that was pending BEFORE KB-334 (no set) stays that way: it is still pushed whole, never narrowed to the new edit", async () => {
    await db.shops.put(shop({ syncStatus: "pending", name: "Edited by an older build" }));
    const saved = await updateShopSettings(db, shopId, { phone: "9876543210" });
    expect(saved).toMatchObject({ syncStatus: "pending", phone: "9876543210" });
    expect(saved).not.toHaveProperty("pendingFields");
  });

  it("a row in conflict keeps what it was still trying to send when it is edited again", async () => {
    await db.shops.put(shop({ syncStatus: "conflict", name: "Stuck Name", pendingFields: ["name"] }));
    const saved = await updateShopSettings(db, shopId, { phone: "9876543210" });
    expect(saved).toMatchObject({ syncStatus: "pending", pendingFields: ["name", "phone"] });
  });

  it("an edit on a synced row starts a fresh set (what the server already has is not sent again)", async () => {
    await updateShopSettings(db, shopId, { name: "One" });
    const row = (await db.shops.get(shopId))!;
    delete row.pendingFields;
    await db.shops.put({ ...row, syncStatus: "synced" }); // as a confirmed push leaves it
    const saved = await updateShopSettings(db, shopId, { phone: "9876543210" });
    expect(saved?.pendingFields).toEqual(["phone"]);
  });
});
