import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem, type BillEntry } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { blockNeedsTopUp, takeNextNumber } from "./receiptNumbers";
import { finaliseBill, SAVE_FAILED, type FinaliseInput } from "./finalise";

// KB-307 commit 2 (owner, 3 Oct 2026): finalising is ONE atomic Dexie
// transaction - receipt number (block, or D23 fallback) taken inside it, the
// bill (final, pending) and its items. Double tap -> one bill. A failure
// inside -> nothing written, no number consumed. Real parser lines (D39).

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;

beforeEach(async () => {
  db = new KiranaBillDB(`finalise-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Test", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "hi", receiptPrefix: "KB", updatedAt: "2026-10-03T00:00:00.000Z" });
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function giveBlock(nextNumber = 1, blockEnd = 50) {
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd, nextNumber, allocatedAt: "2026-10-03T00:00:00.000Z", syncStatus: "synced" });
}

function lines(...transcripts: string[]): FinalLine[] {
  let n = 0;
  return transcripts.flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item): FinalLine => {
      n += 1;
      return { id: `l${n}`, utteranceId: u + 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" };
    }),
  );
}

function input(over: Partial<FinaliseInput> = {}): FinaliseInput {
  return {
    localId: crypto.randomUUID(),
    shopId,
    deviceId,
    startedAt: "2026-10-03T10:00:00.000Z",
    customer: { name: "Ramesh", mobile: "9876543210" },
    lines: lines("2 kilo chini", "1 kilo besan"),
    flags: [],
    now: new Date("2026-10-03T10:05:00.000Z"),
    ...over,
  };
}

const counter = async () => (await db.syncState.get("receiptNumberFallback"))?.pendingCount ?? 0;
const nextNumber = async () => (await db.receiptNumberBlocks.toArray())[0]?.nextNumber;

describe("finaliseBill - one atomic local write", () => {
  it("writes the bill (final, pending) and its items, numbered from the block", async () => {
    await giveBlock(7);
    const draft = input();
    const result = await finaliseBill(db, draft);
    expect(result).toEqual({ receiptNumber: "KB-000007", source: "block", alreadySaved: false });
    const bill = await db.bills.get(draft.localId);
    expect(bill).toMatchObject({
      localId: draft.localId, shopId, status: "final", syncStatus: "pending", receiptNumber: "KB-000007", receiptNumberSource: "block",
      customerName: "Ramesh", customerMobile: "9876543210", subtotalPaise: 18000, totalPaise: 18000, schemaVersion: 1, deviceId,
      createdAt: "2026-10-03T10:00:00.000Z", finalizedAt: "2026-10-03T10:05:00.000Z", syncedAt: null,
    });
    const items = await db.billItems.where("billLocalId").equals(draft.localId).sortBy("lineNo");
    expect(items.map((i) => [i.lineNo, i.displayName, i.qty, i.unit, i.totalPaise, i.shopId, i.source, i.wasEdited])).toEqual([
      [1, "Chini", 2, "kg", 9000, shopId, "fastpath", false],
      [2, "Besan", 1, "kg", 9000, shopId, "fastpath", false],
    ]);
    expect(await nextNumber()).toBe(8);
  });

  it("no block on this device -> D23 fallback number with the full device id, source 'fallback'", async () => {
    const draft = input();
    const result = await finaliseBill(db, draft);
    expect(result).toEqual({ receiptNumber: `KB-${deviceId}-1`, source: "fallback", alreadySaved: false });
    expect((await db.bills.get(draft.localId))?.receiptNumberSource).toBe("fallback");
    expect(await counter()).toBe(1);
  });

  it("double tap (two concurrent finalises of one bill) -> exactly one bill, one number consumed, the same receipt", async () => {
    await giveBlock(1);
    const draft = input();
    const [a, b] = await Promise.all([finaliseBill(db, draft), finaliseBill(db, draft)]);
    expect(a.receiptNumber).toBe("KB-000001");
    expect(b.receiptNumber).toBe("KB-000001");
    expect([a.alreadySaved, b.alreadySaved].sort()).toEqual([false, true]);
    expect(await db.bills.count()).toBe(1);
    expect(await db.billItems.count()).toBe(2);
    expect(await nextNumber()).toBe(2);
  });

  it("a later finalise of an already-saved bill is a no-op returning its receipt", async () => {
    await giveBlock(1);
    const draft = input();
    await finaliseBill(db, draft);
    expect(await finaliseBill(db, draft)).toEqual({ receiptNumber: "KB-000001", source: "block", alreadySaved: true });
    expect(await nextNumber()).toBe(2);
  });

  it("a failure INSIDE the transaction (an item write fails) -> no bill, no items, no number consumed; a retry gets that same number", async () => {
    await giveBlock(5);
    const draft = input();
    const failItems = () => {
      throw new Error("simulated disk failure");
    };
    db.billItems.hook("creating", failItems);
    await expect(finaliseBill(db, draft)).rejects.toThrow();
    expect(await db.bills.count()).toBe(0);
    expect(await db.billItems.count()).toBe(0);
    expect(await nextNumber()).toBe(5);
    db.billItems.hook("creating").unsubscribe(failItems);
    expect((await finaliseBill(db, draft)).receiptNumber).toBe("KB-000005");
  });

  it("a failure inside the fallback path does not advance the device counter either", async () => {
    const draft = input();
    const failBill = () => {
      throw new Error("simulated disk failure");
    };
    db.bills.hook("creating", failBill);
    await expect(finaliseBill(db, draft)).rejects.toThrow();
    expect(await counter()).toBe(0);
    db.bills.hook("creating").unsubscribe(failBill);
    expect((await finaliseBill(db, draft)).receiptNumber).toBe(`KB-${deviceId}-1`);
  });

  it("refuses a bill that can't be a receipt - no items, or a line without an amount - and writes nothing", async () => {
    await giveBlock(1);
    await expect(finaliseBill(db, input({ lines: [] }))).rejects.toThrow("The bill has no items");
    const custom: BillEntry = { id: "l1", utteranceId: 1, item: customItem("kuch naya"), original: customItem("kuch naya") };
    await expect(finaliseBill(db, input({ lines: [{ ...custom, displayName: "kuch naya", source: "manual" }] }))).rejects.toThrow("kuch naya needs a price");
    expect(await db.bills.count()).toBe(0);
    expect(await nextNumber()).toBe(1);
    expect(SAVE_FAILED).toBe("Couldn't save the bill — try again");
  });
});

describe("receipt numbers - taken inside the transaction, topped up after", () => {
  it("takeNextNumber only touches local tables (safe inside a Dexie transaction)", async () => {
    await giveBlock(49);
    const n = await db.transaction("rw", [db.receiptNumberBlocks, db.syncState, db.shops], () => takeNextNumber(db, shopId, deviceId));
    expect(n).toEqual({ receiptNumber: "KB-000049", source: "block" });
  });

  it("blockNeedsTopUp: fewer than 10 numbers left in this device's block (or none) -> true", async () => {
    expect(await blockNeedsTopUp(db, shopId, deviceId)).toBe(true); // no block at all
    await giveBlock(30, 50);
    expect(await blockNeedsTopUp(db, shopId, deviceId)).toBe(false); // 21 left
    await db.receiptNumberBlocks.toCollection().modify({ nextNumber: 42 });
    expect(await blockNeedsTopUp(db, shopId, deviceId)).toBe(true); // 9 left
  });
});
