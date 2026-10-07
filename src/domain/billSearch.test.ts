import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { customItem, editAmount } from "./billEdit";
import { billDateKey, compileQuery, matchBill, toBillSearchRow, type SearchableBill } from "./billSearch";

// KB-310 (owner, 7 Oct 2026): history search, all on the device. Every word
// must match something: customer name, receipt number (its sequence number),
// the exact total in paise, a dd-mm(-yyyy) date with - / . separators and
// single digits, or an item name. Devanagari digits read as 0-9. Never the
// customer's mobile (D52). Real items from buildFinalBill.

const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};

function bill(over: Partial<SearchableBill> & { transcripts?: string[]; custom?: string } = {}): SearchableBill {
  const lines: FinalLine[] = (over.transcripts ?? ["2 kilo chini", "500 gram chini"]).flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
      id: `l${u}-${i}`, utteranceId: u, item, original: item,
      displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
    })),
  );
  if (over.custom) lines.push({ id: "c", utteranceId: 9, item: ok(editAmount(customItem(over.custom), "240")), original: customItem(over.custom), displayName: over.custom, source: "manual" });
  const built = buildFinalBill(lines, []);
  if (!built.ok) throw new Error(built.error);
  return {
    receiptNumber: "KB-000142",
    customerName: "Ramesh",
    totalPaise: built.totalPaise,
    at: new Date(2026, 9, 4, 18, 30).toISOString(), // 4 Oct 2026, 6:30 PM device time
    items: built.items.map((i) => ({ displayName: i.displayName, spokenName: i.spokenName })),
    ...over,
  };
}

describe("matchBill - one search box, every word must match", () => {
  it("an empty query matches every bill", () => {
    expect(matchBill("", bill())).toBe(true);
    expect(matchBill("   ", bill())).toBe(true);
  });

  it("customer name: case-insensitive substring, Devanagari as typed", () => {
    expect(matchBill("rame", bill())).toBe(true);
    expect(matchBill("RAMESH", bill())).toBe(true);
    expect(matchBill("सुरेश", bill({ customerName: "सुरेश कुमार" }))).toBe(true);
    expect(matchBill("suresh", bill())).toBe(false);
  });

  it("receipt number: its sequence number ('142', '000142') or the text ('kb-000142')", () => {
    expect(matchBill("142", bill())).toBe(true);
    expect(matchBill("000142", bill())).toBe(true);
    expect(matchBill("kb-000142", bill())).toBe(true);
    expect(matchBill("14", bill())).toBe(false); // not a substring search on numbers
  });

  it("amount: the exact total in paise - '112.50' and '112.5' match ₹112.50; '112' does not", () => {
    const b = bill(); // 2 kg chini ₹90 + 500 gm ₹22.50 = ₹112.50
    expect(b.totalPaise).toBe(11250);
    expect(matchBill("112.50", b)).toBe(true);
    expect(matchBill("112.5", b)).toBe(true);
    expect(matchBill("112", b)).toBe(false);
    expect(matchBill("90", bill({ transcripts: ["2 kilo chini"] }))).toBe(true); // exactly ₹90
    expect(matchBill("90", b)).toBe(false); // ₹112.50 - and no ₹90.50 rounding either
    expect(matchBill("90", { ...b, totalPaise: 9050 })).toBe(false);
  });

  it("Devanagari digits read as 0-9 (as in billEdit)", () => {
    expect(matchBill("११२.५०", bill())).toBe(true);
    expect(matchBill("१४२", bill())).toBe(true);
    expect(matchBill("४/१०", bill())).toBe(true);
  });

  it("date: dd-mm or dd-mm-yyyy, with - / or . and single digits, in device time", () => {
    for (const q of ["04-10", "4-10", "4/10", "04.10", "4/10/2026", "04-10-2026", "4.10.26"]) expect(matchBill(q, bill()), q).toBe(true);
    for (const q of ["5-10", "4-11", "4/10/2025"]) expect(matchBill(q, bill()), q).toBe(false);
  });

  it("item: display name or spoken name, substring", () => {
    expect(matchBill("chini", bill())).toBe(true);
    expect(matchBill("बासमती", bill({ custom: "बासमती चावल प्रीमियम" }))).toBe(true);
    expect(matchBill("atta", bill())).toBe(false);
  });

  it("several words: each must match something (AND)", () => {
    expect(matchBill("ramesh chini", bill())).toBe(true);
    expect(matchBill("ramesh 4/10", bill())).toBe(true);
    expect(matchBill("ramesh atta", bill())).toBe(false);
  });

  it("'cash' finds Cash bills; the customer's mobile is never searched (it isn't an input)", () => {
    expect(matchBill("cash", bill({ customerName: "Cash" }))).toBe(true);
    const withMobile = { ...bill(), customerMobile: "9123456789" } as SearchableBill;
    expect(matchBill("9123456789", withMobile)).toBe(false);
    expect(matchBill("91234", withMobile)).toBe(false);
  });
});

describe("billDateKey - the date group, in device time", () => {
  it("dd-mm-yyyy of the local date", () => {
    expect(billDateKey(new Date(2026, 9, 4, 23, 59).toISOString())).toBe("04-10-2026");
    expect(billDateKey(new Date(2026, 0, 9, 0, 1).toISOString())).toBe("09-01-2026");
  });
});

describe("toBillSearchRow + compileQuery - the stored search row (D61), the same rules", () => {
  it("a compiled query on the stored row gives the same answers as matchBill", () => {
    const bills = [bill(), bill({ customerName: "Suresh", receiptNumber: "KB-000143" }), bill({ customerName: "Cash", transcripts: ["2 kilo chini"] })];
    const rows = bills.map((b, i) => toBillSearchRow({ ...b, localId: `b${i}`, shopId: "s" }));
    for (const q of ["", "ramesh", "143", "14", "kb-000143", "90", "112.5", "4/10", "4.10.26", "५/१०", "chini", "ramesh chini", "atta"]) {
      const match = compileQuery(q);
      expect(rows.map(match), q).toEqual(bills.map((b) => matchBill(q, b)));
    }
  });

  it("the row: ids, the total in paise, the sequence, the date key, display fields, lowercased text - never the mobile", () => {
    const b = { ...bill({ customerName: "Ramesh Kumar", custom: "बासमती चावल" }), customerMobile: "9123456789" } as SearchableBill;
    const row = toBillSearchRow({ ...b, localId: "L1", shopId: "S1" });
    expect(row).toMatchObject({ localId: "L1", shopId: "S1", finalizedAt: b.at, totalPaise: b.totalPaise, sequence: 142, dateKey: "04-10-2026", receiptNumber: "KB-000142", customerName: "Ramesh Kumar" });
    expect(row.text.split("\n")).toEqual(["ramesh kumar", "chini", "chini", "chini", "chini", "बासमती चावल", "बासमती चावल"]);
    expect(JSON.stringify(row)).not.toContain("9123456789");
  });

  it("a fallback number has no sequence; it matches only as the whole number", () => {
    const n = "KB-6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b-3";
    const row = toBillSearchRow({ ...bill({ receiptNumber: n }), localId: "L", shopId: "S" });
    expect(row.sequence).toBeNull();
    expect(compileQuery(n.toLowerCase())(row)).toBe(true);
    expect(compileQuery("3")(row)).toBe(false);
  });
});
