// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB, type LocalBill } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { BillView } from "./BillingScreen";
import { HistoryScreen } from "./HistoryScreen";
import { loadRecentRows } from "@/data/history";

// "Show more" (owner, option A): the next page is requested from the loader -
// a spy around the REAL loadRecentRows. Waiting for the 201st row to render
// hangs under fake-indexeddb + jsdom (KI-67); the page itself is proven by the
// data test (205 bills, limit 400 -> 205) and in a real browser (200 -> 250).
vi.mock("@/data/history", async (original) => {
  const actual = await original<typeof import("@/data/history")>();
  return { ...actual, loadRecentRows: vi.fn(actual.loadRecentRows) };
});
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-310 (owner, 7 Oct 2026): S5 History and S6 bill detail, with REAL
// finalised bills (D39). Opens on the newest rows, then searches the last 90
// days; "Search older bills" loads everything (also when the recent search
// finds nothing); 200 results, then "Show more". Detail: the receipt and the
// four share buttons. Back closes detail, then History. Never the mobile.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;
let db: KiranaBillDB;
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"]), pdf: new Blob(["pdf"]) });

beforeEach(async () => {
  db = new KiranaBillDB(`ui-history-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-07T00:00:00.000Z" });
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 1000, nextNumber: 1, allocatedAt: "2026-10-07T00:00:00.000Z", syncStatus: "synced" });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));

/** A real finalised bill `daysAgo` days back (device time, midday). */
async function save(daysAgo: number, transcript = "2 kilo chini", customer = { name: "Cash", mobile: null as string | null }) {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(12, 0, 0, 0);
  const localId = crypto.randomUUID();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: d.toISOString(), customer, lines: lines(transcript), flags: [], now: d });
  return localId;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};

async function open(onClose = () => {}) {
  render(<HistoryScreen localDb={db} shopId={shopId} render={renderFiles} onClose={onClose} />);
  await screen.findByRole("region", { name: "History" });
}
const bills = () => screen.queryByRole("list", { name: "Bills" });
const rowTexts = () => within(bills()!).getAllByRole("button").map((b) => b.textContent ?? "");
const search = (q: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search bills" }), { target: { value: q } });

describe("KB-310 - S5 History", () => {
  it("the ≡ menu has History", () => {
    const onOpenHistory = vi.fn();
    render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onOpenHistory={onOpenHistory} />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("no bills: says so - and that History is this phone's bills (owner, Q1)", async () => {
    await open();
    await screen.findByText("No bills on this phone yet.");
    expect(screen.getByText("History shows the bills saved on this phone.")).toBeTruthy();
  });

  it("newest first, grouped Today / Yesterday / dd-mm-yyyy; a row: number, total, the name unless Cash, 'Not synced' while pending", async () => {
    await save(5);
    await save(1);
    const synced = await save(0, "1 kilo besan", { name: "Ramesh", mobile: null });
    await db.bills.update(synced, { syncStatus: "synced" });
    await open();
    await waitFor(() => expect(bills()).toBeTruthy());
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Today", "Yesterday", dateKey(5)]);
    const rows = rowTexts();
    expect(rows[0]).toContain("KB-000003");
    expect(rows[0]).toContain("Ramesh");
    expect(rows[0]).not.toContain("Not synced");
    expect(rows[1]).toContain("KB-000002");
    expect(rows[1]).toContain("₹90");
    expect(rows[1]).not.toContain("Cash");
    expect(rows[1]).toContain("Not synced");
  });

  it("search narrows the list, over the last 90 days (with the item names), and says so", async () => {
    await save(2, "1 kilo besan", { name: "Ramesh", mobile: null });
    await save(1, "2 kilo chini");
    await open();
    await screen.findByText("Searching the last 90 days", {}, { timeout: 3000 }).catch(() => null);
    search("besan");
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(rowTexts()[0]).toContain("Ramesh");
    expect(screen.getByText("Searching the last 90 days")).toBeTruthy();
  });

  it("an older dd-mm date: the recent search finds nothing, offers 'Search older bills', which finds it", async () => {
    await save(120, "2 kilo chini", { name: "Purana", mobile: null });
    await save(1);
    await open();
    search(dateKey(120).slice(0, 5));
    await screen.findByText("No bills found.");
    fireEvent.click(screen.getByRole("button", { name: "Search older bills" }));
    await waitFor(() => expect(bills() && rowTexts().some((r) => r.includes("Purana"))).toBe(true));
    expect(screen.getByText("Searching all bills on this phone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search older bills" })).toBeNull();
  });

  it("'Search older bills' is offered under recent results too", async () => {
    await save(1, "2 kilo chini");
    await open();
    search("chini");
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Search older bills" })).toBeTruthy();
  });

  it("200 rows and 'Show more'; a click asks the loader for the next page (limit 400)", async () => {
    const at = (i: number) => new Date(Date.now() - i * 60_000).toISOString();
    const rows: LocalBill[] = Array.from({ length: 205 }, (_, i) => ({
      localId: crypto.randomUUID(), shopId, status: "final", syncStatus: "synced", receiptNumber: `KB-${String(i + 1).padStart(6, "0")}`, receiptNumberSource: "block",
      customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: at(i), finalizedAt: at(i), syncedAt: at(i),
    }));
    await db.bills.bulkPut(rows);
    vi.mocked(loadRecentRows).mockClear();
    await open();
    await waitFor(() => expect(rowTexts()).toHaveLength(200));
    expect(vi.mocked(loadRecentRows).mock.calls.map((c) => c[2])).toEqual([200]);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(vi.mocked(loadRecentRows).mock.calls.map((c) => c[2])).toEqual([200, 400]));
    expect(vi.mocked(loadRecentRows).mock.calls[1]!.slice(0, 2)).toEqual([db, shopId]);
  }, 20_000);

  it("bills all older than 90 days: the list still shows them once the (empty) 90-day window has loaded; 'Show more' is offered", async () => {
    const at = (i: number) => new Date(Date.now() - (100 + i / 1000) * DAY).toISOString();
    const rows: LocalBill[] = Array.from({ length: 250 }, (_, i) => ({
      localId: crypto.randomUUID(), shopId, status: "final", syncStatus: "synced", receiptNumber: `KB-${String(i + 1).padStart(6, "0")}`, receiptNumberSource: "block",
      customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: at(i), finalizedAt: at(i), syncedAt: at(i),
    }));
    await db.bills.bulkPut(rows);
    await open();
    await waitFor(() => expect(rowTexts()).toHaveLength(200));
    await new Promise((r) => setTimeout(r, 300)); // the (empty) 90-day window has loaded by now
    expect(rowTexts()).toHaveLength(200);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  }, 20_000);
});

describe("KB-310 - S6 bill detail", () => {
  it("a row opens the read-only receipt with the four share buttons; Back returns to the list, then closes History", async () => {
    const onClose = vi.fn();
    await save(0, "2 kilo chini");
    await open(onClose);
    await waitFor(() => expect(bills()).toBeTruthy());
    fireEvent.click(within(bills()!).getAllByRole("button")[0]!);
    const receipt = await screen.findByRole("article", { name: "Receipt" });
    expect(within(receipt).getByTestId("receipt-number").textContent).toBe("KB-000001");
    for (const name of ["Image", "PDF", "WhatsApp", "SMS"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bill Banao" })).toBeNull(); // read-only
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Receipt" })).toBeNull());
    expect(bills()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Android back closes the detail first, then History", async () => {
    const onClose = vi.fn();
    await save(0);
    await open(onClose);
    await waitFor(() => expect(bills()).toBeTruthy());
    fireEvent.click(within(bills()!).getAllByRole("button")[0]!);
    await screen.findByRole("article", { name: "Receipt" });
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(screen.queryByRole("article", { name: "Receipt" })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("the customer's mobile appears nowhere - list, search or detail", async () => {
    await save(0, "2 kilo chini", { name: "Ramesh", mobile: "9123456789" });
    await open();
    await waitFor(() => expect(bills()).toBeTruthy());
    search("9123456789");
    await screen.findByText("No bills found."); // never searchable
    search("");
    await waitFor(() => expect(bills()).toBeTruthy());
    fireEvent.click(within(bills()!).getAllByRole("button")[0]!);
    await screen.findByRole("article", { name: "Receipt" });
    for (const f of ["9123456789", "91234 56789"]) expect(document.documentElement.outerHTML).not.toContain(f);
  });
});
