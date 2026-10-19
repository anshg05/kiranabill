import { describe, expect, it } from "vitest";
import { compileQuery, matchBill, toBillSearchRow, type SearchableBill } from "./billSearch";
import { MESSAGES, render } from "./messages";

// KB-341 (D87): History search with plain, old and fallback numbers; "bill 59" finds bill 59.

const base = (receiptNumber: string): SearchableBill => ({
  receiptNumber,
  customerName: "Cash",
  totalPaise: 12345,
  at: new Date(2026, 9, 4, 18, 30).toISOString(),
  items: [{ displayName: "Chini", spokenName: "chini" }],
});
const seq = (n: string) => toBillSearchRow({ ...base(n), localId: "L", shopId: "S" }).sequence;

describe("the sequence of a receipt number", () => {
  it("a plain number is its own sequence; an old KB-000059 is 59; both find '59'", () => {
    expect(seq("59")).toBe(59);
    expect(seq("1")).toBe(1);
    expect(seq("KB-000059")).toBe(59);
    expect(matchBill("59", base("59"))).toBe(true);
    expect(matchBill("59", base("KB-000059"))).toBe(true);
  });

  it("a fallback number has NO sequence - '7F2A91-1' is not bill 1, and an old UUID number is none either", () => {
    expect(seq("7F2A91-1")).toBeNull();
    expect(seq("KB-550e8400-e29b-41d4-a716-446655440000-1")).toBeNull();
    expect(matchBill("1", base("7F2A91-1"))).toBe(false);
    expect(matchBill("7f2a91-1", base("7F2A91-1"))).toBe(true); // typed whole, it is still found
  });

  it("'5' does not find bill 59 (the whole number, not a prefix) - as before", () => {
    expect(matchBill("5", base("59"))).toBe(false);
  });
});

describe("KB-341 - the words 'bill', 'no', 'number' (and Hindi) are ignored in the search", () => {
  const found = (q: string, n = "59") => matchBill(q, base(n));
  it("'bill 59', 'बिल 59', 'bill no. 59', 'no 59', 'number 59', 'नं. 59' find bill 59 - plain and old", () => {
    for (const q of ["bill 59", "बिल 59", "bill no. 59", "bill no 59", "no 59", "no. 59", "number 59", "नं. 59", "नं 59", "Bill No. 59", "BILL 59"]) {
      expect(found(q), q).toBe(true);
      expect(found(q, "KB-000059"), `${q} (old)`).toBe(true);
    }
  });
  it("and does not find another bill", () => {
    expect(found("bill 60")).toBe(false);
    expect(found("बिल 60", "KB-000059")).toBe(false);
  });
  it("the ignored words still combine with the other words: 'bill 59 chini' finds it, 'bill 59 namak' does not", () => {
    expect(found("bill 59 chini")).toBe(true);
    expect(found("bill 59 namak")).toBe(false);
  });
  it("only the bare words are ignored: 'billing' or a customer called 'Bill-something' is still text", () => {
    expect(compileQuery("billing")(toBillSearchRow({ ...base("59"), localId: "L", shopId: "S" }))).toBe(false);
  });
});

describe("KB-341 - the screen label for a number", () => {
  it("'Bill 59' / 'बिल 59' / 'Bill 59' - old numbers keep the same label", () => {
    expect(render("history.billNo", { n: "59" }, "en")).toBe("Bill 59");
    expect(render("history.billNo", { n: "59" }, "hi")).toBe("बिल 59");
    expect(render("history.billNo", { n: "59" }, "hl")).toBe("Bill 59");
    expect(render("history.billNo", { n: "KB-000059" }, "en")).toBe("Bill KB-000059");
    expect(Object.keys(MESSAGES)).toContain("history.billNo");
  });
});
