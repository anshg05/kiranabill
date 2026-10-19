// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { BillView } from "./BillingScreen";
import { HistoryScreen } from "./HistoryScreen";
import { setScreenLanguage } from "./screenLanguage";
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-341 (D87): a number that stands alone on a screen is shown with its label ("Bill 59") so it is not read as an amount.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"]), pdf: new Blob(["pdf"]) });

beforeEach(async () => {
  db = new KiranaBillDB(`ui-simple-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-07T00:00:00.000Z" });
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 1000, nextNumber: 58, allocatedAt: "2026-10-07T00:00:00.000Z", syncStatus: "synced" });
  await db.syncState.put({ tableName: `bills:${shopId}`, lastSyncedAt: null, cursor: JSON.stringify({ phase: "done", before: null }), pendingCount: 0 });
});
afterEach(async () => {
  cleanup();
  setScreenLanguage("en");
  db.close();
  await db.delete();
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));

async function save(transcript = "2 kilo chini") {
  const d = new Date();
  const localId = crypto.randomUUID();
  const r = await finaliseBill(db, { localId, shopId, deviceId, startedAt: d.toISOString(), customer: { name: "Cash", mobile: null }, lines: lines(transcript), flags: [], now: d });
  return { localId, receiptNumber: r.receiptNumber };
}
async function open() {
  render(<HistoryScreen localDb={db} shopId={shopId} render={renderFiles} onClose={() => {}} />);
  await screen.findByRole("region");
}
const rows = () => within(screen.getByRole("list", { name: /Bills|बिल/ })).getAllByRole("button").map((b) => b.textContent ?? "");
const search = (q: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });

describe("KB-341 - bill 58 is saved as the plain number 58 and shown with its label", () => {
  it("finalising gives '58'; the History row title is 'Bill 58', not a bare '58'", async () => {
    const { receiptNumber } = await save();
    expect(receiptNumber).toBe("58");
    await open();
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]).toMatch(/^Bill 58/);
  });

  it("the bill detail heading is 'Bill 58' and the receipt itself says 'Bill No.' with the number", async () => {
    await save();
    await open();
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(screen.getAllByRole("button").find((b) => /^Bill 58/.test(b.textContent ?? ""))!);
    const heading = await screen.findByRole("heading", { name: "Bill 58" });
    expect(heading).toBeTruthy();
    expect(await screen.findByText("Bill No.")).toBeTruthy();
  });

  it("an old number keeps the same label: 'Bill KB-000012'", async () => {
    await db.bills.add({ localId: "old", shopId, status: "final", syncStatus: "synced", receiptNumber: "KB-000012", receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: new Date().toISOString(), finalizedAt: new Date().toISOString(), syncedAt: null });
    await open();
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]).toMatch(/^Bill KB-000012/);
  });

  it("Hindi: 'बिल 58'", async () => {
    await save();
    setScreenLanguage("hi");
    await open();
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]).toMatch(/^बिल 58/);
  });

  it("the search finds it by 'bill 58', 'बिल 58' and 'no. 58'; an old KB-000058 too", async () => {
    await save("2 kilo chini");
    await db.bills.add({ localId: "old", shopId, status: "final", syncStatus: "synced", receiptNumber: "KB-000012", receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: new Date().toISOString(), finalizedAt: new Date().toISOString(), syncedAt: null });
    await db.billSearch.put({ localId: "old", shopId, finalizedAt: new Date().toISOString(), totalPaise: 9000, sequence: 12, dateKey: "01-01-2026", receiptNumber: "KB-000012", customerName: "Cash", text: "cash\nchini" });
    await open();
    await waitFor(() => expect(rows().length).toBe(2));
    for (const q of ["bill 58", "बिल 58", "no. 58"]) {
      search(q);
      await waitFor(() => expect(rows().length).toBe(1));
      expect(rows()[0]).toMatch(/^Bill 58/);
    }
    search("bill 12");
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]).toMatch(/^Bill KB-000012/);
  });
});

describe("KB-341 - the saved strip on the billing screen", () => {
  it("'Bill 58 saved' (English) and 'बिल 58 सेव हो गया' (हिन्दी)", () => {
    const { rerender } = render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} saved={{ receiptNumber: "58" }} />);
    expect(screen.getByRole("status", { name: /saved|सेव/i }).textContent).toBe("Bill 58 saved");
    setScreenLanguage("hi");
    rerender(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} saved={{ receiptNumber: "58" }} />);
    expect(screen.getByRole("status", { name: /सेव|saved/i }).textContent).toBe("बिल 58 सेव हो गया");
  });
});
