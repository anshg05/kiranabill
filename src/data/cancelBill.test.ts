import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB, type LocalBillCancellation } from "./db";
import { finaliseBill } from "./finalise";
import { loadRecentRows } from "./history";
import { loadReceipt } from "./receipt";
import { applyCancellations, cancelBillLocal, loadCancellationInfo } from "./cancelBill";

// KB-325 (D79): cancelling is LOCAL first, like Bill Banao - one Dexie transaction that changes the bill's status and
// nothing else (hard rule 2), writes the cancellation record, and flags the bill's search row. Sync pushes it later
// (data/cancelBill.e2e.test.ts); another device pulls it (applyCancellations).

const shopId = "11111111-1111-4111-8111-111111111111";
const otherShop = "99999999-9999-4999-8999-999999999999";
const deviceId = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-14T06:00:00.000Z");
let db: KiranaBillDB;

beforeEach(async () => {
  db = new KiranaBillDB(`cancel-bill-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Test", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-03T00:00:00.000Z" });
});
afterEach(async () => {
  db.close();
  await db.delete();
});

function lines(...transcripts: string[]): FinalLine[] {
  let n = 0;
  return transcripts.flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item): FinalLine => {
      n += 1;
      return { id: `l${n}`, utteranceId: u + 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" };
    }),
  );
}
async function finalBill(...transcripts: string[]) {
  const localId = crypto.randomUUID();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: "2026-10-14T05:00:00.000Z", customer: { name: "Cash", mobile: null }, lines: lines(...transcripts), flags: [], now: new Date(NOW - 3_600_000) });
  return localId;
}
const cancel = (billLocalId: string, over: Partial<Parameters<typeof cancelBillLocal>[1]> = {}) =>
  cancelBillLocal(db, { shopId, billLocalId, reason: "wrong_price", deviceId, replacementLocalId: null, nowMs: NOW, ...over });
const snapshot = async (id: string) => ({ bill: await db.bills.get(id), items: await db.billItems.where("billLocalId").equals(id).sortBy("lineNo") });

describe("cancelBillLocal", () => {
  it("changes ONLY the status: the items, totals, receipt number, customer and times are byte-identical (hard rule 2)", async () => {
    const id = await finalBill("2 kilo chini", "1 kilo besan");
    const before = await snapshot(id);
    expect(await cancel(id)).toEqual({ ok: true });
    const after = await snapshot(id);
    expect(after.bill!.status).toBe("cancelled");
    const { status: _a, syncStatus: _b, ...beforeRest } = before.bill!;
    const { status: _c, syncStatus: _d, ...afterRest } = after.bill!;
    expect(afterRest).toEqual(beforeRest);
    expect(after.items).toEqual(before.items);
  });

  it("writes one pending cancellation record: the reason, the time, this device, the replacement link", async () => {
    const id = await finalBill("2 kilo chini");
    const replacement = crypto.randomUUID();
    await cancel(id, { reason: "wrong_item", replacementLocalId: replacement });
    const rows = await db.billCancellations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<Partial<LocalBillCancellation>>({
      billLocalId: id, shopId, reason: "wrong_item", replacementLocalId: replacement, cancelledAt: new Date(NOW).toISOString(), deviceId, syncStatus: "pending",
    });
    expect(rows[0]!.localId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a synced bill goes back to pending so its status change is pushed; a pending one stays pending", async () => {
    const synced = await finalBill("2 kilo chini");
    await db.bills.update(synced, { syncStatus: "synced", serverId: crypto.randomUUID() });
    const pending = await finalBill("1 kilo besan");
    await cancel(synced);
    await cancel(pending);
    expect((await db.bills.get(synced))!.syncStatus).toBe("pending");
    expect((await db.bills.get(pending))!.syncStatus).toBe("pending");
  });

  it("a bill in permanent CONFLICT stays in conflict - cancelling never quietly retries it", async () => {
    const id = await finalBill("2 kilo chini");
    await db.bills.update(id, { syncStatus: "conflict" });
    expect(await cancel(id)).toEqual({ ok: true });
    expect((await db.bills.get(id))!.syncStatus).toBe("conflict");
    expect((await db.bills.get(id))!.status).toBe("cancelled");
  });

  it("the bill's search row is kept and flagged cancelled (History still lists and finds it)", async () => {
    const id = await finalBill("2 kilo chini");
    await cancel(id);
    expect(await db.billSearch.get(id)).toMatchObject({ localId: id, cancelled: true });
  });

  it("learning is untouched: no event is written or removed (the cancelled bill already taught; D79)", async () => {
    const id = await finalBill("2 kilo चिनी");
    const before = await db.learningEvents.count();
    await cancel(id);
    expect(await db.learningEvents.count()).toBe(before);
  });

  it("works with no network at all - it only writes the device's own database", async () => {
    const id = await finalBill("2 kilo chini");
    expect(await cancel(id)).toEqual({ ok: true });
  });

  it("refuses a second cancel, an unknown bill, another shop's bill, a bad reason - and writes nothing", async () => {
    const id = await finalBill("2 kilo chini");
    expect(await cancel(id)).toEqual({ ok: true });
    expect(await cancel(id)).toEqual({ ok: false, error: "This bill is already cancelled" });
    expect(await cancel(crypto.randomUUID())).toEqual({ ok: false, error: "That bill isn't on this phone" });
    const other = await finalBill("1 kilo besan");
    await db.bills.update(other, { shopId: otherShop });
    expect(await cancel(other)).toEqual({ ok: false, error: "That bill isn't on this phone" });
    const third = await finalBill("1 kilo besan");
    expect(await cancel(third, { reason: "because" as never })).toEqual({ ok: false, error: "Choose a reason" });
    expect(await db.billCancellations.count()).toBe(1);
    expect((await db.bills.get(third))!.status).toBe("final");
  });

  it("refuses a draft", async () => {
    const id = await finalBill("2 kilo chini");
    await db.bills.update(id, { status: "draft" });
    expect(await cancel(id)).toEqual({ ok: false, error: "Only a saved bill can be cancelled" });
  });
});

describe("loadCancellationInfo - both directions of the link", () => {
  it("the cancelled bill: its reason, and 'replaced by' the bill made from its draft; the replacement: 'replaces' the cancelled one", async () => {
    const original = await finalBill("2 kilo chini");
    const replacement = crypto.randomUUID();
    await cancel(original, { replacementLocalId: replacement });
    expect((await loadCancellationInfo(db, original)).replacedBy).toBeNull(); // not made yet: "No replacement bill made"

    await finaliseBill(db, { localId: replacement, shopId, deviceId, startedAt: "2026-10-14T06:10:00.000Z", customer: { name: "Cash", mobile: null }, lines: lines("2 kilo cheeni 48 wala"), flags: [], now: new Date(NOW + 60_000) });
    const rep = (await db.bills.get(replacement))!;
    const infoOriginal = await loadCancellationInfo(db, original);
    expect(infoOriginal.cancellation).toMatchObject({ reason: "wrong_price", replacementLocalId: replacement });
    expect(infoOriginal.replacedBy).toEqual({ localId: replacement, receiptNumber: rep.receiptNumber });
    expect(infoOriginal.replaces).toBeNull();

    const infoReplacement = await loadCancellationInfo(db, replacement);
    expect(infoReplacement.cancellation).toBeNull();
    expect(infoReplacement.replaces).toEqual({ localId: original, receiptNumber: (await db.bills.get(original))!.receiptNumber });
  });

  it("the replacement gets a NEW receipt number; the cancelled number is never reused", async () => {
    const original = await finalBill("2 kilo chini");
    const replacement = crypto.randomUUID();
    await cancel(original, { replacementLocalId: replacement });
    await finaliseBill(db, { localId: replacement, shopId, deviceId, startedAt: "2026-10-14T06:10:00.000Z", customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: new Date(NOW + 60_000) });
    expect((await db.bills.get(replacement))!.receiptNumber).not.toBe((await db.bills.get(original))!.receiptNumber);
  });

  it("an ordinary bill has no cancellation and no link", async () => {
    const id = await finalBill("2 kilo chini");
    expect(await loadCancellationInfo(db, id)).toEqual({ cancellation: null, replacedBy: null, replaces: null });
  });
});

describe("applyCancellations - a cancellation made on another device arrives", () => {
  const fromServer = (billLocalId: string, over: Partial<LocalBillCancellation> = {}): LocalBillCancellation => ({
    localId: crypto.randomUUID(), serverId: crypto.randomUUID(), shopId, billLocalId, reason: "customer_cancelled", replacementLocalId: null,
    cancelledAt: new Date(NOW).toISOString(), deviceId: "phone-b", syncStatus: "synced", updatedAt: new Date(NOW).toISOString(), ...over,
  });

  it("a bill this phone holds as final becomes cancelled (status only), its search row is flagged; its sync status is not touched", async () => {
    const id = await finalBill("2 kilo chini");
    await db.bills.update(id, { syncStatus: "synced", serverId: crypto.randomUUID() });
    const before = await snapshot(id);
    await db.billCancellations.put(fromServer(id));
    expect(await applyCancellations(db, shopId)).toBe(1);
    const after = await snapshot(id);
    expect(after.bill).toEqual({ ...before.bill, status: "cancelled" });
    expect(after.items).toEqual(before.items);
    expect(await db.billSearch.get(id)).toMatchObject({ cancelled: true });
  });

  it("idempotent; a bill that is not here yet is applied later, when it arrives", async () => {
    const id = crypto.randomUUID();
    await db.billCancellations.put(fromServer(id));
    expect(await applyCancellations(db, shopId)).toBe(0);
    const present = await finalBill("2 kilo chini");
    await db.billCancellations.put(fromServer(present));
    expect(await applyCancellations(db, shopId)).toBe(1);
    expect(await applyCancellations(db, shopId)).toBe(0);
    expect((await db.bills.get(present))!.status).toBe("cancelled");
  });

  it("is per shop: another shop's cancellation row never changes this shop's bill", async () => {
    const id = await finalBill("2 kilo chini");
    await db.billCancellations.put(fromServer(id, { shopId: otherShop }));
    expect(await applyCancellations(db, shopId)).toBe(0);
    expect((await db.bills.get(id))!.status).toBe("final");
  });
});

describe("History and the receipt show a cancelled bill", () => {
  it("loadRecentRows lists it, marked cancelled", async () => {
    const a = await finalBill("2 kilo chini");
    const b = await finalBill("1 kilo besan");
    await cancel(a);
    const rows = await loadRecentRows(db, shopId, 10);
    expect(rows.map((r) => [r.localId, r.cancelled]).sort()).toEqual([[a, true], [b, false]].sort());
  });

  it("loadReceipt carries the CANCELLED line only for a cancelled bill", async () => {
    const a = await finalBill("2 kilo chini");
    const b = await finalBill("1 kilo besan");
    await cancel(a);
    expect((await loadReceipt(db, a))!.cancelled).toBe("CANCELLED");
    expect((await loadReceipt(db, b))!.cancelled).toBeNull();
  });
});
