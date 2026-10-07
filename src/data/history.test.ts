import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { compileQuery } from "@/domain/billSearch";
import { KiranaBillDB } from "./db";
import { finaliseBill } from "./finalise";
import { loadRecentRows, loadSearchIndex } from "./history";

// KB-310 (owner's load design, 7 Oct 2026), REAL finalised bills (D39):
// - open: the newest rows from the date index, no items;
// - recent: bills since a date with their items, as search entries;
// - older: every bill (a full item-table scan) as search entries.
// Only THIS shop's final bills, newest first; never the customer's mobile.

const shopA = "11111111-1111-4111-8111-111111111111";
const shopB = "33333333-3333-4333-8333-333333333333";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;

beforeEach(async () => {
  db = new KiranaBillDB(`history-${crypto.randomUUID()}`);
  for (const id of [shopA, shopB]) {
    await db.shops.put({ id, syncStatus: "synced", name: "S", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-07T00:00:00.000Z" });
    await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId: id, deviceId, blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "2026-10-07T00:00:00.000Z", syncStatus: "synced" });
  }
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));

async function save(shopId: string, transcript: string, at: string, customer = { name: "Cash", mobile: null as string | null }) {
  const localId = crypto.randomUUID();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: at, customer, lines: lines(transcript), flags: [], now: new Date(at) });
  return localId;
}

describe("loadRecentRows - what History opens with", () => {
  it("this shop's final bills, newest first, capped; rows carry no items and never the mobile", async () => {
    const a1 = await save(shopA, "2 kilo chini", "2026-07-01T10:00:00.000Z");
    await save(shopB, "1 kilo besan", "2026-10-05T10:00:00.000Z");
    const a2 = await save(shopA, "1 kilo besan", "2026-10-06T10:00:00.000Z", { name: "Ramesh", mobile: "9123456789" });
    const a3 = await save(shopA, "2 kilo chini", "2026-10-07T10:00:00.000Z");
    await db.bills.update(a1, { syncStatus: "synced" });

    const rows = await loadRecentRows(db, shopA, 2);
    expect(rows.map((r) => r.localId)).toEqual([a3, a2]);
    expect(rows[1]).toEqual({ localId: a2, receiptNumber: "KB-000002", customerName: "Ramesh", totalPaise: rows[1]!.totalPaise, at: "2026-10-06T10:00:00.000Z", syncStatus: "pending" });
    expect((await loadRecentRows(db, shopA, 200)).map((r) => r.localId)).toEqual([a3, a2, a1]);
    expect(JSON.stringify(rows)).not.toContain("9123456789");
  });
});

describe("loadRecentRows - 'Show more' reads the next page from the same index (owner, option A)", () => {
  it("205 bills: a limit of 200 gives 200; a limit of 400 gives all 205, newest first", async () => {
    const at = (i: number) => new Date(Date.parse("2026-10-07T12:00:00.000Z") - i * 60_000).toISOString();
    await db.bills.bulkPut(Array.from({ length: 205 }, (_, i) => ({
      localId: crypto.randomUUID(), shopId: shopA, status: "final" as const, syncStatus: "synced" as const, receiptNumber: `KB-${String(i + 1).padStart(6, "0")}`, receiptNumberSource: "block" as const,
      customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: at(i), finalizedAt: at(i), syncedAt: at(i),
    })));
    expect(await loadRecentRows(db, shopA, 200)).toHaveLength(200);
    const all = await loadRecentRows(db, shopA, 400);
    expect(all).toHaveLength(205);
    expect([all[0]!.receiptNumber, all[204]!.receiptNumber]).toEqual(["KB-000001", "KB-000205"]);
  });
});

describe("loadSearchIndex - the billSearch rows (D61): a recent window or everything", () => {
  it("since a date: only bills from then on, their item names in the search text; null: every bill of the shop", async () => {
    const old = await save(shopA, "2 kilo chini", "2026-06-01T10:00:00.000Z");
    const recent = await save(shopA, "2 kilo chini aur 1 kilo besan", "2026-10-06T10:00:00.000Z");
    await save(shopB, "1 kilo besan", "2026-10-06T11:00:00.000Z");

    const window = await loadSearchIndex(db, shopA, "2026-07-09T00:00:00.000Z");
    expect(window.map((r) => r.localId)).toEqual([recent]);
    expect(window[0]!.text.split("\n").slice(1)).toEqual(["chini", "chini", "besan", "besan"]);
    expect(window.filter(compileQuery("besan")).length).toBe(1);

    const all = await loadSearchIndex(db, shopA, null);
    expect(all.map((r) => r.localId)).toEqual([recent, old]);
    expect(all.filter(compileQuery("01-06")).map((r) => r.localId)).toEqual([old]);
  });

  it("no bills -> empty", async () => {
    expect(await loadSearchIndex(db, shopA, null)).toEqual([]);
    expect(await loadRecentRows(db, shopA, 200)).toEqual([]);
  });
});
