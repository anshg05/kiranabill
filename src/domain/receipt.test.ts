import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { buildReceipt, numberChunks, RECEIPT_TEXT, type ReceiptBill, type ReceiptShop } from "./receipt";

// KB-308 (owner, 3 Oct 2026): the kirana parchi (05 §6). Built from real
// parser output through buildFinalBill - the same items a finalised bill
// stores. The receipt is plain text pieces; React (or KB-309's canvas) draws
// them, so nothing here is HTML.

const shop: ReceiptShop = { name: "Sharma Kirana", phone: "9876543210", logoUrl: null, billLanguage: "en" };
const bill: ReceiptBill = { receiptNumber: "KB-000142", customerName: "Cash", totalPaise: 0, finalizedAt: "2026-08-15T13:26:00.000Z", createdAt: "2026-08-15T13:25:00.000Z" };

function items(...transcripts: string[]) {
  const lines: FinalLine[] = transcripts.flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
      id: `l${u}-${i}`,
      utteranceId: u,
      item,
      original: item,
      displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName,
      source: "fastpath" as const,
    })),
  );
  const built = buildFinalBill(lines, []);
  if (!built.ok) throw new Error(built.error);
  return { items: built.items, totalPaise: built.totalPaise };
}

describe("buildReceipt - what the parchi shows", () => {
  it("header: shop name, phone as 5+5 digits, bill number, date and time in device time", () => {
    const { items: its, totalPaise } = items("2 kilo chini");
    const r = buildReceipt({ ...bill, totalPaise }, its, shop);
    expect(r.shopName).toBe("Sharma Kirana");
    expect(r.shopPhone).toBe("98765 43210");
    expect(r.billLabel).toBe("Bill:");
    expect(r.receiptNumber).toBe("KB-000142");
    const d = new Date(bill.finalizedAt!);
    const h = d.getHours() % 12 || 12;
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(r.dateTime).toBe(`${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`);
  });

  it("a phone that isn't 10 digits prints as stored; no phone -> null", () => {
    const { items: its } = items("2 kilo chini");
    expect(buildReceipt(bill, its, { ...shop, phone: "011-2345678" }).shopPhone).toBe("011-2345678");
    expect(buildReceipt(bill, its, { ...shop, phone: null }).shopPhone).toBeNull();
  });

  it("customer: 'Cash' is not printed (KB-306); a name is; the mobile is not an input at all", () => {
    const { items: its } = items("2 kilo chini");
    expect(buildReceipt(bill, its, shop).customer).toBeNull();
    expect(buildReceipt({ ...bill, customerName: "Ramesh" }, its, shop).customer).toBe("Ramesh");
    // ReceiptBill has no mobile field: a stored bill passed in whole carries it, the receipt never reads it.
    const withMobile = { ...bill, customerName: "Ramesh", customerMobile: "9123456789" };
    expect(JSON.stringify(buildReceipt(withMobile, its, shop))).not.toContain("9123456789");
  });

  it("rows: name, qty + unit, rate (SG-09, per kg), amount without ₹; total with ₹", () => {
    const { items: its, totalPaise } = items("2 kilo chini", "500 gram chini", "250 gram chini");
    const r = buildReceipt({ ...bill, totalPaise }, its, shop);
    expect(r.rows).toEqual([
      { name: "Chini", qty: "2 kg", rate: "₹45", amount: "90" },
      { name: "Chini", qty: "500 gm", rate: "₹45/kg", amount: "22.50" },
      { name: "Chini", qty: "250 gm", rate: "₹45/kg", amount: "11.25" },
    ]);
    expect(r.totalLabel).toBe("TOTAL");
    expect(r.total).toBe("₹123.75");
  });

  it("a spoken total only (D47): qty '—', rate blank, the spoken amount", () => {
    const { items: its } = items("chini 30 rupay");
    expect(its[0]).toMatchObject({ qty: null, ratePaise: null, totalPaise: 3000 });
    expect(buildReceipt(bill, its, shop).rows).toEqual([{ name: "Chini", qty: "—", rate: "", amount: "30" }]);
  });

  it("a hostile name stays a plain string - escaping is the renderer's job (React text), never string HTML", () => {
    const { items: its } = items("2 kilo chini");
    const evil = "<img src=x onerror=alert(1)>";
    const r = buildReceipt({ ...bill, customerName: evil }, [{ ...its[0]!, displayName: evil }], { ...shop, name: evil });
    expect([r.shopName, r.customer, r.rows[0]!.name]).toEqual([evil, evil, evil]);
  });
});

describe("bill_language - the CUSTOMER's receipt (not KI-59's screen language)", () => {
  it("one table of strings, en / hi / both", () => {
    expect(RECEIPT_TEXT).toEqual({
      en: { bill: "Bill:", total: "TOTAL", thanks: "Thank you!", item: "Item", qty: "Qty", rate: "Rate", amount: "Amount" },
      hi: { bill: "बिल:", total: "कुल", thanks: "धन्यवाद!", item: "सामान", qty: "मात्रा", rate: "दर", amount: "रकम" },
    });
  });

  it("hi: labels and units in Hindi; product names as the shop has them; digits 0-9", () => {
    const { items: its, totalPaise } = items("2 kilo chini", "500 gram chini");
    const r = buildReceipt({ ...bill, totalPaise }, its, { ...shop, billLanguage: "hi" });
    expect([r.billLabel, r.totalLabel, r.thanks]).toEqual(["बिल:", "कुल", ["धन्यवाद!"]]);
    expect(r.rows.map((x) => [x.name, x.qty, x.rate])).toEqual([["Chini", "2 किलो", "₹45"], ["Chini", "500 ग्राम", "₹45/किलो"]]);
    expect(r.headers).toEqual({ item: "सामान", qty: "मात्रा", rate: "दर", amount: "रकम" });
  });

  it("both: Hindi / English labels, Hindi units, the thanks on two lines", () => {
    const { items: its } = items("2 kilo chini");
    const r = buildReceipt(bill, its, { ...shop, billLanguage: "both" });
    expect([r.billLabel, r.totalLabel, r.thanks]).toEqual(["बिल / Bill:", "कुल / TOTAL", ["धन्यवाद!", "Thank you!"]]);
    expect(r.rows[0]!.qty).toBe("2 किलो");
    expect(r.headers.item).toBe("सामान / Item");
  });

  it("a unit missing from the table prints as stored", () => {
    const { items: its } = items("2 kilo chini");
    const r = buildReceipt(bill, [{ ...its[0]!, unit: "quintal", qty: 1, rateUnit: null, ratePaise: null }], { ...shop, billLanguage: "hi" });
    expect(r.rows[0]!.qty).toBe("1 quintal");
  });
});

describe("numberChunks - Q1 A: the number breaks only after a hyphen; joined, it is the exact string", () => {
  it("a block number and a D23 fallback number", () => {
    expect(numberChunks("KB-000142")).toEqual(["KB-", "000142"]);
    const fallback = "KB-6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b-3";
    const chunks = numberChunks(fallback);
    expect(chunks).toEqual(["KB-", "6f1c2a9e-", "3b4d-", "4e5f-", "8a7b-", "0c1d2e3f4a5b-", "3"]);
    expect(chunks.join("")).toBe(fallback);
  });

  it("the receipt carries the chunks of its own number", () => {
    const { items: its } = items("2 kilo chini");
    const n = "KB-6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b-12";
    expect(buildReceipt({ ...bill, receiptNumber: n }, its, shop).numberChunks.join("")).toBe(n);
  });
});
