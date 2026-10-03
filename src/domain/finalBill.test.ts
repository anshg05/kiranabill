import { describe, expect, it } from "vitest";
import { parseUtterance, type ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { evaluateReviewFlags } from "./reviewFlags";
import { billFlags, customItem, editQty, editRate, editUnit, manualItem, type BillEntry, type UtteranceRecord } from "./billEdit";
import { amountNeeded, AMOUNT_SUPERSEDES, buildFinalBill, visibleFlags, type FinalLine } from "./finalBill";

// KB-307 commit 2 (owner, 3 Oct 2026): what a finalised bill is made of.
// D39: real parser output. A receipt never carries a line without an amount
// (decision 2: "Price needed", cleared only by a value; ₹0 counts as priced).

const catalog = SEED_PARSER_CATALOG.entries;

function spoken(transcript: string, utteranceId: number, firstLine: number): { entries: BillEntry[]; utterance: UtteranceRecord } {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
  const entries = items.map((item, i) => ({ id: `l${firstLine + i}`, utteranceId, item, original: item }));
  return { entries, utterance: { id: utteranceId, lineIds: entries.map((e) => e.id), flags: [...evaluateReviewFlags(transcript, items, catalog)], transcript } };
}

const line = (e: BillEntry, source: FinalLine["source"] = "fastpath", displayName?: string): FinalLine => ({
  ...e,
  displayName: displayName ?? (e.item.catalogId ? SEED_PARSER_CATALOG.byId.get(e.item.catalogId)!.displayName : e.item.spokenName),
  source,
});

const withItem = (e: BillEntry, item: ParsedItem): BillEntry => ({ ...e, item });

describe("amountNeeded - decision 2: no receipt line without an amount", () => {
  it("a priced line needs nothing; ₹0 is priced", () => {
    const [chini] = spoken("2 kilo chini", 1, 1).entries;
    expect(amountNeeded(chini!.item)).toBeNull();
    expect(amountNeeded({ ...chini!.item, total: 0 })).toBeNull();
  });

  it("Rule 5b 'ajwain' (priceType unknown, total 0 = NO price, not a ₹0 price) -> 'price' - never a ₹0 receipt line", () => {
    const [ajwain] = parseUtterance("ajwain", SEED_PARSER_CATALOG)!;
    expect(ajwain).toMatchObject({ priceType: "unknown", total: 0, rate: null });
    expect(amountNeeded(ajwain!)).toBe("price");
  });

  it("no total and no rate -> 'price' (a custom item); a rate but no qty -> 'quantity'", () => {
    expect(amountNeeded(customItem("kuch naya"))).toBe("price");
    const qtyLess = { ...manualItem(SEED_PARSER_CATALOG.byId.get("27")!), qty: null, total: null };
    expect(amountNeeded(qtyLess)).toBe("quantity");
  });
});

describe("visibleFlags - 'Price needed' replaces the flags it supersedes, so one line is never two checks", () => {
  it("missing_total (HIGH, acknowledgeable) and incomplete_item are hidden on a line that needs an amount", () => {
    expect([...AMOUNT_SUPERSEDES].sort()).toEqual(["incomplete_item", "missing_total"]);
    const entry: BillEntry = { id: "l1", utteranceId: 1, item: customItem("kuch naya"), original: customItem("kuch naya") };
    const flags = billFlags([entry], [{ id: 1, lineIds: ["l1"], flags: [...evaluateReviewFlags("", [entry.item], catalog)] }], catalog);
    expect(flags.map((f) => f.code).sort()).toEqual(["incomplete_item", "unknown_product"]);
    expect(visibleFlags(flags, [entry]).map((f) => f.code)).toEqual(["unknown_product"]);
  });

  it("once the line has an amount, nothing is hidden", () => {
    const { entries, utterance } = spoken("2 kilo chini 5 wala", 1, 1);
    const flags = billFlags(entries, [utterance], catalog);
    expect(visibleFlags(flags, entries)).toEqual(flags);
  });
});

describe("buildFinalBill", () => {
  it("real lines -> items in bill order; total = the sum, exact (D36 500 gm chini ₹22.50)", () => {
    const a = spoken("500 gram chini", 1, 1);
    const b = spoken("1 kilo besan", 2, 2);
    const entries = [...a.entries, ...b.entries];
    const built = buildFinalBill(entries.map((e) => line(e)), billFlags(entries, [a.utterance, b.utterance], catalog).map((f) => ({ ...f, acknowledged: false })));
    if (!built.ok) throw new Error(built.error);
    expect(built.totalPaise).toBe(2250 + 9000);
    expect(built.items.map((i) => [i.lineNo, i.displayName, i.qty, i.unit, i.ratePaise, i.rateUnit, i.totalPaise, i.priceType, i.source])).toEqual([
      [1, "Chini", 500, "gm", 4500, "kg", 2250, "default", "fastpath"],
      [2, "Besan", 1, "kg", 9000, "kg", 9000, "default", "fastpath"],
    ]);
  });

  it("shopProductId is the shop catalog id; a custom item has none; spokenName as spoken", () => {
    const a = spoken("2 kilo chini", 1, 1);
    const custom = customItem("kuch naya");
    const kg = editUnit(custom, "kg");
    const two = kg.ok ? editQty(kg.item, "2") : kg;
    const priced = two.ok ? editRate(two.item, "60") : two;
    if (!priced.ok) throw new Error(priced.error);
    const customEntry: BillEntry = { id: "l9", utteranceId: 2, item: priced.item, original: custom };
    const built = buildFinalBill([line(a.entries[0]!), line(customEntry, "manual", "kuch naya")], []);
    if (!built.ok) throw new Error(built.error);
    expect(built.items.map((i) => [i.shopProductId, i.spokenName, i.source])).toEqual([
      ["27", a.entries[0]!.item.spokenName, "fastpath"],
      [null, "kuch naya", "manual"],
    ]);
  });

  it("wasEdited: an edited qty is true; an untouched line false", () => {
    const a = spoken("2 kilo chini", 1, 1);
    const three = editQty(a.entries[0]!.item, "3");
    if (!three.ok) throw new Error(three.error);
    const built = buildFinalBill([line(withItem(a.entries[0]!, three.item)), line(spoken("1 kilo besan", 2, 2).entries[0]!)], []);
    if (!built.ok) throw new Error(built.error);
    expect(built.items.map((i) => i.wasEdited)).toEqual([true, false]);
  });

  it("review flags are stored WITH severity and acknowledgement (owner); a bill-level flag goes on its anchor line", () => {
    const { entries, utterance } = spoken("2 kilo chini 5 wala", 1, 1); // HIGH unusual_rate + unusual_total
    const placed = billFlags(entries, [utterance], catalog);
    const shown = placed.map((f) => ({ ...f, acknowledged: f.code === "unusual_rate" }));
    const billLevel = { ...shown[0]!, code: "number_misaligned" as const, lineId: null, anchorLineId: entries[0]!.id, acknowledged: true };
    const built = buildFinalBill(entries.map((e) => line(e)), [...shown, billLevel]);
    if (!built.ok) throw new Error(built.error);
    expect(built.items[0]!.reviewFlags).toEqual([
      { code: "unusual_rate", severity: "HIGH", acknowledged: true },
      { code: "unusual_total", severity: "HIGH", acknowledged: false },
      { code: "number_misaligned", severity: "HIGH", acknowledged: true },
    ]);
  });

  it("rateUnit is null exactly when the rate is (bill_items_rate_unit_iff_rate); an empty unit is stored as null", () => {
    const totalOnly = parseUtterance("sabun 180 rupay", SEED_PARSER_CATALOG)!; // D47: qty null, unit "", total 18000
    const e: BillEntry = { id: "l1", utteranceId: 1, item: totalOnly[0]!, original: totalOnly[0]! };
    const built = buildFinalBill([line(e)], []);
    if (!built.ok) throw new Error(built.error);
    expect(built.items[0]).toMatchObject({ qty: null, unit: null, ratePaise: null, rateUnit: null, totalPaise: 18000, priceType: "total" });
  });

  it("refuses an empty bill and a line without an amount - never a receipt with '—' on it", () => {
    expect(buildFinalBill([], [])).toEqual({ ok: false, error: "The bill has no items" });
    const custom: BillEntry = { id: "l1", utteranceId: 1, item: customItem("kuch naya"), original: customItem("kuch naya") };
    expect(buildFinalBill([line(custom, "manual", "kuch naya")], [])).toEqual({ ok: false, error: "kuch naya needs a price" });
  });
});
