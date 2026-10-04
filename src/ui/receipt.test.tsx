// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem, editQty, editRate, editUnit } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB, type LocalShop } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { loadReceipt } from "@/data/receipt";
import { BillView } from "./BillingScreen";
import { Receipt } from "./Receipt";
import { useBillLines } from "./useBillLines";
import { useFinalise } from "./useFinalise";

// KB-308 (owner, 3 Oct 2026): the receipt drawn from REAL finalised bills
// (D39) - finaliseBill on fake-indexeddb, read back with loadReceipt. Every
// value is React text (hard rule 9); the customer's mobile is nowhere in the
// page; a fallback number breaks only after hyphens and copies as one string.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const MOBILE = "9123456789";
let db: KiranaBillDB;

const shopRow = (over: Partial<LocalShop> = {}): LocalShop => ({
  id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: "9876543210", address: null, logoUrl: null,
  catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-03T00:00:00.000Z", ...over,
});

async function withBlock() {
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "2026-10-03T00:00:00.000Z", syncStatus: "synced" });
}

beforeEach(async () => {
  db = new KiranaBillDB(`ui-receipt-${crypto.randomUUID()}`);
});
afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};

function spokenLines(...transcripts: string[]): FinalLine[] {
  return transcripts.flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
      id: `l${u}-${i}`, utteranceId: u, item, original: item,
      displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
    })),
  );
}

function customLine(name: string): FinalLine {
  const item = ok(editRate(ok(editQty(ok(editUnit(customItem(name), "kg")), "1")), "30"));
  return { id: `c-${name.length}`, utteranceId: 99, item, original: customItem(name), displayName: name, source: "manual" };
}

/** Finalise a real bill, read it back, draw it. */
async function drawSaved(lines: FinalLine[], customer = { name: "Cash", mobile: null as string | null }) {
  const localId = crypto.randomUUID();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: "2026-10-03T12:00:00.000Z", customer, lines, flags: [] });
  const receipt = await loadReceipt(db, localId);
  if (!receipt) throw new Error("no receipt");
  render(<Receipt receipt={receipt} />);
  return receipt;
}

const receiptEl = () => screen.getByRole("article", { name: "Receipt" });

describe("KB-308 - the receipt from a real finalised bill", () => {
  it("shop, number, rows, total - a semantic table with column headers (05 §9); 'Cash' not printed", async () => {
    await db.shops.put(shopRow());
    await withBlock();
    await drawSaved(spokenLines("2 kilo chini", "500 gram chini", "chini 30 rupay"));
    const r = within(receiptEl());
    expect(r.getByText("Sharma Kirana")).toBeTruthy();
    expect(r.getByText("98765 43210")).toBeTruthy();
    expect(r.getByTestId("receipt-number").textContent).toBe("KB-000001");
    expect(r.getByTestId("receipt-bill-no").textContent).toBe("Bill No. KB-000001"); // D57: one "Bill No." line
    expect(r.queryByTestId("receipt-customer")).toBeNull(); // Cash: no customer line
    expect(receiptEl().textContent).not.toContain("Cash");

    const table = r.getByRole("table");
    // D57: a VISIBLE header row - not screen-reader-only any more.
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Item", "Qty", "Rate", "Amt"]);
    expect(table.querySelector("thead")!.className).not.toContain("sr-only");
    const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([
      ["Chini", "2 kg", "₹45", "₹90"],
      ["Chini", "500 gm", "₹45/kg", "₹22.50"],
      ["Chini", "—", "—", "₹30"], // D47: spoken total only; D57: rate "—"
      ["₹142.50"], // the TOTAL row: its label is a row header
    ]);
    expect(within(table).getByRole("rowheader").textContent).toBe("TOTAL");
  });

  it("a REAL fallback-numbered bill (no block left): the full number, breaks only after hyphens, copies as one string", async () => {
    await db.shops.put(shopRow());
    const receipt = await drawSaved(spokenLines("2 kilo chini"));
    expect(receipt.receiptNumber).toBe(`KB-${deviceId}-1`);
    const number = within(receiptEl()).getByTestId("receipt-number");
    expect(number.textContent).toBe(`KB-${deviceId}-1`); // what a copy gets - <wbr> adds no characters
    expect(number.querySelectorAll("wbr")).toHaveLength(receipt.numberChunks.length - 1);
    for (const wbr of number.querySelectorAll("wbr")) expect(wbr.previousSibling?.textContent?.endsWith("-")).toBe(true);
    expect(number.className).toContain("select-all");
  });

  it("bill_language hi and both: the labels and units change; product names don't", async () => {
    await db.shops.put(shopRow({ billLanguage: "hi" }));
    await withBlock();
    await drawSaved(spokenLines("2 kilo chini"));
    const r = within(receiptEl());
    expect(r.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["सामान", "मात्रा", "दर", "रकम"]);
    expect(r.getByText("2 किलो")).toBeTruthy();
    expect(r.getByText("Chini")).toBeTruthy();
    expect(r.getByRole("rowheader").textContent).toBe("कुल");
    expect(r.getByText("धन्यवाद!")).toBeTruthy();
    expect(r.getByTestId("receipt-bill-no").textContent).toBe("बिल नं. KB-000001");
    cleanup();

    await db.shops.update(shopId, { billLanguage: "both" });
    await drawSaved(spokenLines("2 kilo chini"));
    const b = within(receiptEl());
    expect(b.getByRole("rowheader").textContent).toBe("कुल / TOTAL");
    expect(receiptEl().querySelector("footer")!.textContent).toBe("धन्यवाद!  Thank You!"); // D57: one line (exact - getByText collapses the gap)
    expect(b.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["सामान / Item", "मात्रा / Qty", "दर / Rate", "रकम / Amt"]);
  });

  it("hard rule 9: hostile shop / product / customer names are text - no element is created from them", async () => {
    const evil = `<img src=x onerror="alert(1)"></td><script>alert(2)</script>`;
    await db.shops.put(shopRow({ name: evil }));
    await withBlock();
    await drawSaved([customLine(evil)], { name: evil, mobile: null });
    const el = receiptEl();
    expect(el.querySelectorAll("img, script")).toHaveLength(0);
    expect(within(el).getAllByText(evil)).toHaveLength(2); // shop name, item - as literal text
    expect(within(el).getByTestId("receipt-customer").textContent).toBe(`Customer: ${evil}`); // D57: "Customer: <name>"
  });

  it("logo (Q4): shown when set; removed when it fails to load - no broken-image icon; none when unset", async () => {
    await db.shops.put(shopRow({ logoUrl: "https://example.invalid/logo.png" }));
    await withBlock();
    await drawSaved(spokenLines("2 kilo chini"));
    const img = receiptEl().querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.invalid/logo.png");
    fireEvent.error(img);
    expect(receiptEl().querySelector("img")).toBeNull();
    cleanup();

    await db.shops.update(shopId, { logoUrl: null });
    await drawSaved(spokenLines("2 kilo chini"));
    expect(receiptEl().querySelector("img")).toBeNull();
  });
});

function Harness({ transcript }: { transcript: string }) {
  const bill = useBillLines(SEED_PARSER_CATALOG.entries);
  const fin = useFinalise({ localDb: db, shopId, deviceId });
  useEffect(() => {
    const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
    bill.add(items.map((item) => ({ item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const })), [], transcript);
    bill.setCustomerName("Ramesh");
    bill.setCustomerMobile(MOBILE);
    // once, on mount
  }, []);
  return (
    <BillView
      lines={bill.rows}
      onSignOut={() => {}}
      onEdit={bill.edit}
      onRemove={bill.remove}
      removed={bill.removed}
      onUndo={bill.undo}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      notAdded={bill.notAdded}
      onRetry={() => {}}
      onDismiss={bill.dismiss}
      onMicTap={() => {}}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={bill.addByHand}
      customer={bill.customer}
      onCustomerName={bill.setCustomerName}
      onCustomerMobile={bill.setCustomerMobile}
      onFinalise={() => void fin.finalise(bill.draft)}
      saving={fin.phase === "saving"}
      saved={fin.saved}
      saveError={fin.error}
      onNewBill={() => {
        bill.reset();
        fin.clear();
      }}
    />
  );
}

describe("KB-308 - the receipt on the saved screen", () => {
  it("Bill Banao -> the receipt of the bill as stored; the name is printed, the mobile appears NOWHERE in the page", async () => {
    await db.shops.put(shopRow());
    await withBlock();
    render(<Harness transcript="2 kilo chini" />);
    await act(async () => {
      screen.getByRole("button", { name: "Bill Banao" }).click();
    });
    const receipt = await waitFor(() => receiptEl());
    expect(within(receipt).getByTestId("receipt-number").textContent).toBe("KB-000001");
    expect(within(receipt).getByTestId("receipt-customer").textContent).toBe("Customer: Ramesh"); // D57
    expect(screen.getByRole("status", { name: "Bill saved" })).toBeTruthy();

    // Text, attributes, aria-labels, data-*: the whole serialised page, raw and formatted.
    const page = document.documentElement.outerHTML;
    for (const form of [MOBILE, "91234 56789", "91234-56789", "+91"]) expect(page).not.toContain(form);
    expect(await db.bills.toCollection().first()).toMatchObject({ customerMobile: MOBILE }); // stored - just never shown
  });

  it("the 'Bill … saved' status breaks a REAL fallback number only after hyphens (a hyphen + digit is no break point for a browser)", async () => {
    await db.shops.put(shopRow()); // no block -> the D23 fallback number
    render(<Harness transcript="2 kilo chini" />);
    await act(async () => {
      screen.getByRole("button", { name: "Bill Banao" }).click();
    });
    const status = await waitFor(() => screen.getByRole("status", { name: "Bill saved" }));
    const number = `KB-${deviceId}-1`;
    expect(status.textContent).toBe(`Bill ${number} saved`);
    const wbrs = status.querySelectorAll("wbr");
    expect(wbrs).toHaveLength(number.split("-").length - 1);
    for (const wbr of wbrs) expect(wbr.previousSibling?.textContent?.endsWith("-")).toBe(true);
  });
});
