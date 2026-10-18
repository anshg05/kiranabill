import { describe, expect, it } from "vitest";
import { parseUtterance, type ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { editAmount, editQty, editRate, editUnit } from "./billEdit";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { EMPTY_LEARNING_STATE, learnFromBill, type LearnLine } from "./learning";
import { buildReceipt, type ReceiptBill, type ReceiptShop } from "./receipt";
import { receiptText, smsText } from "./receiptText";

// KB-337 (D85): a typed amount, a cleared rate, a rate typed on a line with no unit, a quantity with no unit - what
// each becomes when the bill is FINISHED: the stored line, the receipt, the share texts, and what learning does with it.
// Real parser output (D39), through the same buildFinalBill finalise uses.

const catalog = SEED_PARSER_CATALOG.entries;
const ok = (r: { ok: true; item: ParsedItem } | { ok: false; error: string }): ParsedItem => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};
const one = (text: string): ParsedItem => parseUtterance(text, SEED_PARSER_CATALOG)![0]!;

function built(spoken: string, edit: (i: ParsedItem) => ParsedItem) {
  const item = one(spoken);
  const line: FinalLine = {
    id: "l0",
    utteranceId: 0,
    item: edit(item),
    original: item,
    displayName: item.catalogId ? SEED_PARSER_CATALOG.byId.get(item.catalogId)!.displayName : item.spokenName,
    source: "fastpath",
  };
  const r = buildFinalBill([line], []);
  if (!r.ok) throw new Error(r.error);
  return r;
}

const shop: ReceiptShop = { name: "Sharma Kirana", phone: null, logoUrl: null, billLanguage: "en" };
const header: ReceiptBill = { receiptNumber: "KB-000142", customerName: "Cash", totalPaise: 0, finalizedAt: "2026-10-18T10:00:00.000Z", createdAt: "2026-10-18T09:59:00.000Z" };

describe("the stored line", () => {
  it("a typed amount is stored exactly as a spoken 'ka' total already is: no rate, no rate unit, priceType total, qty and unit kept, wasEdited", () => {
    const r = built("2 kilo chini", (i) => ok(editAmount(i, "100")));
    expect(r.items[0]).toMatchObject({ qty: 2, unit: "kg", ratePaise: null, rateUnit: null, totalPaise: 10000, priceType: "total", wasEdited: true });
    expect(r.totalPaise).toBe(10000);
  });

  it("a qty with no unit is stored with unit null (the DB column is nullable)", () => {
    const r = built("sabun 180 rupay", (i) => ok(editQty(i, "1")));
    expect(r.items[0]).toMatchObject({ qty: 1, unit: null, ratePaise: null, totalPaise: 18000, priceType: "total" });
  });

  it("a rate typed on a line with no unit is a plain-number rate: rate_unit '' keeps bill_items_rate_unit_iff_rate true, unit null", () => {
    const r = built("sabun 180 rupay", (i) => ok(editQty(ok(editRate(i, "10")), "3")));
    expect(r.items[0]).toMatchObject({ qty: 3, unit: null, ratePaise: 1000, rateUnit: "", totalPaise: 3000, priceType: "rate", wasEdited: true });
  });

  it("a line with a rate but no qty is refused at finalise ('Quantity needed' never reaches a receipt)", () => {
    const item = ok(editRate(one("sabun 180 rupay"), "10"));
    const line: FinalLine = { id: "l0", utteranceId: 0, item, original: one("sabun 180 rupay"), displayName: "Sabun", source: "fastpath" };
    expect(buildFinalBill([line], []).ok).toBe(false);
  });
});

describe("KB-338 (D86): a line with no unit, finished", () => {
  it("stored as unit null with a plain-number rate (rate_unit ''): every number as it was when '—' was picked", () => {
    const r = built("2 kilo chini", (i) => ok(editUnit(i, "")));
    expect(r.items[0]).toMatchObject({ qty: 2, unit: null, ratePaise: 4500, rateUnit: "", totalPaise: 9000, wasEdited: true });
  });

  it("the receipt and the share texts print the qty with no unit", () => {
    const r0 = built("2 kilo chini", (i) => ok(editUnit(i, "")));
    const r = buildReceipt({ ...header, totalPaise: r0.totalPaise }, r0.items, shop);
    expect(r.rows[0]).toMatchObject({ qty: "2", rate: "₹45", amount: "₹90" });
    expect(receiptText(r)).toContain("Chini — 2 × ₹45 = ₹90");
  });

  it("teaches no price observation (no unit to compare); being edited it confirms no alias", () => {
    const lines: LearnLine[] = built("2 kilo चिनी", (i) => ok(editUnit(i, ""))).items.map((i) => ({ ...i }));
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines, discarded: [] }, catalog, Date.parse("2026-10-18T12:00:00.000Z"));
    expect(r.decisions.map((d) => d.kind)).toEqual([]);
  });
});

describe("the receipt and the share texts: qty, '—' and the amount", () => {
  it("receipt row: 2 kg | — | ₹100; with a qty and no unit: 1 | — | ₹180", () => {
    const typed = built("2 kilo chini", (i) => ok(editAmount(i, "100")));
    expect(buildReceipt({ ...header, totalPaise: typed.totalPaise }, typed.items, shop).rows[0]).toMatchObject({ qty: "2 kg", rate: "—", amount: "₹100" });
    const unitless = built("sabun 180 rupay", (i) => ok(editQty(i, "1")));
    expect(buildReceipt({ ...header, totalPaise: unitless.totalPaise }, unitless.items, shop).rows[0]).toMatchObject({ qty: "1", rate: "—", amount: "₹180" });
  });

  it("WhatsApp and SMS text carry the qty and the amount, never a rate nobody has", () => {
    const typed = built("2 kilo chini", (i) => ok(editAmount(i, "100")));
    const r = buildReceipt({ ...header, totalPaise: typed.totalPaise }, typed.items, shop);
    expect(receiptText(r)).toContain("Chini — 2 kg = ₹100");
    expect(smsText(r)).toContain("Chini - 2 kg = Rs.100");
  });
});

describe("learning (08): a typed amount is an edit and no rate is ever back-calculated", () => {
  const lines = (spoken: string, edit: (i: ParsedItem) => ParsedItem): LearnLine[] => built(spoken, edit).items.map((i) => ({ ...i }));
  const NOW = Date.parse("2026-10-18T12:00:00.000Z");

  it("a typed amount on a rate line teaches no price (it has no rate) and confirms no alias (it was edited)", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: lines("2 kilo चिनी", (i) => ok(editAmount(i, "100"))), discarded: [] }, catalog, NOW);
    expect(r.decisions.map((d) => d.kind)).toEqual([]);
  });

  it("a plain-number rate (no unit) teaches no price: nothing to compare it with", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: lines("sabun 180 rupay", (i) => ok(editQty(ok(editRate(i, "200")), "1"))), discarded: [] }, catalog, NOW);
    expect(r.decisions.map((d) => d.kind)).not.toContain("price_observed");
  });

  it("control: a rate typed WITH a unit still teaches its price - the rule is only about lines with nothing to compare", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: lines("2 kilo chini", (i) => ok(editRate(i, "48"))), discarded: [] }, catalog, NOW);
    expect(r.decisions.map((d) => d.kind)).toContain("price_observed");
  });
});
