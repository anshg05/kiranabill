import { describe, expect, it } from "vitest";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import type { ActualBill } from "../acceptance/compare.js";
import type { ExpectedBill } from "../acceptance/types.js";
import { aroundWords, earHeard, scoreRunD102 } from "./d102.js";

// KB-370 round 2, scored under D102 (owner, 4 Nov 2026): a bill line is right when its NAME is the name that was said (spelling variants
// fine) with the right quantity, unit and price. The catalog product it claims no longer matters - but a DIFFERENT product's name, or a
// price taken from a different product, is still wrong.

const shop = SEED_PARSER_CATALOG;
const it_ = (over: Partial<ParsedItem>): ParsedItem => ({ spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate", ...over });
const bill = (items: ParsedItem[], over: Partial<ActualBill> = {}): ActualBill => ({ lines: items.map((item) => ({ item, displayName: item.spokenName })), unresolved: 0, checks: 0, ...over });
const one = (name: string, qty: number | null, unit: string, price: ExpectedBill["lines"][number]["price"]): ExpectedBill => ({ lines: [{ name, qty, unit, price }], notAdded: 0, checks: 0 });

describe("scoreRunD102", () => {
  it("the name as said with the right numbers is right, whatever catalog product the line claims (रिन on Lifebuoy's id)", () => {
    const rin = one("रिन साबुन", 1, "piece", { kind: "total", paise: 10500 });
    expect(scoreRunD102("A61", rin, bill([it_({ spokenName: "रिन साबुन", catalogId: "162", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 10500, priceType: "total" })]), shop)).toMatchObject({ exact: true, wrongLines: 0 });
    expect(scoreRunD102("A61", rin, bill([it_({ spokenName: "रिन साबुन", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 10500, priceType: "total" })]), shop).exact).toBe(true);
  });

  it("a spelling variant of the same word is fine (मुंग मोगर for मूंग मोगर)", () => {
    const e = one("मूंग मोगर", 1, "kg", { kind: "rate", paise: 11000 });
    expect(scoreRunD102("A58", e, bill([it_({ spokenName: "मुंग मोगर", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, rate: 11000, total: 11000 })]), shop).exact).toBe(true);
  });

  it("the same word in the other SCRIPT is the same name (B writes 'toor daal' for तुअर दाल): both resolve to one catalog product", () => {
    const e = one("तुअर दाल", 1, "kg", { kind: "rate", paise: 15000 });
    expect(scoreRunD102("A62", e, bill([it_({ spokenName: "toor daal", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, rate: 15000, total: 15000 })]), shop)).toMatchObject({ exact: true, numbersRightNameWrong: 0 });
  });

  it("D103: units as said - 'litre' is liter; set is not piece; a packet where the number sat next to किलो (kg) is a wrong unit", () => {
    const oil = one("बंसल तेल", 1, "liter", { kind: "total", paise: 15000 });
    expect(scoreRunD102("A34", oil, bill([it_({ spokenName: "बंसल तेल", catalogId: null, qty: 1, unit: "litre", rate: null, rateUnit: null, total: 15000, priceType: "total" })]), shop).exact).toBe(true);
    const set = one("रिन साबुन", 1, "set", { kind: "total", paise: 10000 });
    expect(scoreRunD102("A27", set, bill([it_({ spokenName: "रिन साबुन", catalogId: null, qty: 1, unit: "set", rate: null, rateUnit: null, total: 10000, priceType: "total" })]), shop).exact).toBe(true);
    expect(scoreRunD102("A27", set, bill([it_({ spokenName: "रिन साबुन", catalogId: null, qty: 1, unit: "piece", rate: null, rateUnit: null, total: 10000, priceType: "total" })]), shop).wrongLines).toBe(1);
    const surf = one("सर्फ एक्सेल", 1, "kg", { kind: "total", paise: 14000 });
    expect(scoreRunD102("A57", surf, bill([it_({ spokenName: "सर्फ एक्सेल", catalogId: null, qty: 1, unit: "packet", rate: null, rateUnit: null, total: 14000, priceType: "total" })]), shop).wrongLines).toBe(1);
  });

  it("KB-379 (owner, 7 Nov 2026): the reviewed spellings - लाइज़ॉल = Lizol, टूथ ब्रश = Toothbrush, ग्राउंडनट ऑयल / ऑइल = Moongfali Tel - one product in another script or spacing", () => {
    const custom = (spokenName: string, total: number) => it_({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total, priceType: "total" });
    expect(scoreRunD102("A27", one("लाइज़ॉल", 1, "piece", { kind: "total", paise: 11000 }), bill([custom("Lizol", 11000)]), shop)).toMatchObject({ exact: true, wrongLines: 0 });
    expect(scoreRunD102("A50", one("टूथ ब्रश", 1, "piece", { kind: "total", paise: 3500 }), bill([custom("टूथब्रश", 3500)]), shop)).toMatchObject({ exact: true, wrongLines: 0 });
    const oil = (spokenName: string) => it_({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: null, unit: "", rate: null, rateUnit: null, total: 20000, priceType: "total" });
    for (const heard of ["groundnut oil", "ग्राउंडनट ऑइल"]) expect(scoreRunD102("A49", one("ग्राउंडनट ऑयल", null, "", { kind: "total", paise: 20000 }), bill([oil(heard)]), shop)).toMatchObject({ exact: true, wrongLines: 0 });
  });

  it("KB-380 (owner, 7 Nov 2026): a DROPPED line is silent unless the bill warns about it - a whole-bill Theek hai (every line warned) or a 'Not added' piece", () => {
    const two: ExpectedBill = { lines: [{ name: "चीनी", qty: 2, unit: "kg", price: { kind: "rate", paise: 4500 } }, { name: "चावल", qty: 5, unit: "kg", price: { kind: "default" } }], notAdded: 0, checks: 0 };
    expect(scoreRunD102("A01", two, bill([it_({})]), shop)).toMatchObject({ dropped: 1, silentDropped: 1 });
    expect(scoreRunD102("A01", two, bill([it_({})], { warnedLines: [0], checks: 1 }), shop)).toMatchObject({ dropped: 1, silentDropped: 0 });
    expect(scoreRunD102("A01", two, bill([it_({})], { unresolved: 1 }), shop)).toMatchObject({ dropped: 1, silentDropped: 0 });
  });

  it("owner (8 Nov 2026): a wrong line that shows PRICE NEEDED is warned, not silent - and Price needed lines are counted in their own column", () => {
    // A19: "लाल मिर्ची" as 1 packet (D103 says kg), no price - the shopkeeper must type one before Bill Banao
    const e = one("लाल मिर्च", 1, "kg", { kind: "default" });
    const needed = it_({ spokenName: "लाल मिर्ची", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "packet", rate: null, rateUnit: null, total: null, priceType: "unknown" });
    expect(scoreRunD102("A19", e, bill([needed]), shop)).toMatchObject({ wrongLines: 1, silentWrong: 0, warnedLines: 0, priceNeededLines: 1 });
    const priced = it_({ spokenName: "लाल मिर्ची", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "packet", rate: null, rateUnit: null, total: 20000, priceType: "total" });
    expect(scoreRunD102("A19", one("लाल मिर्च", 1, "kg", { kind: "total", paise: 20000 }), bill([priced]), shop)).toMatchObject({ wrongLines: 1, silentWrong: 1, priceNeededLines: 0 });
  });

  it("owner (8 Nov 2026): spaces inside a name do not matter to the scorer (दंतकांति = दंत कांति, टूथब्रश = टूथ ब्रश) - the app is unchanged", () => {
    const custom = (spokenName: string) => it_({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: 6000, rateUnit: "piece", total: 6000, priceType: "rate" });
    expect(scoreRunD102("A42", one("दंत कांति", 1, "piece", { kind: "rate", paise: 6000 }), bill([custom("दंतकांति")]), shop)).toMatchObject({ exact: true, numbersRightNameWrong: 0 });
    expect(scoreRunD102("A42", one("दंत कांति", 1, "piece", { kind: "rate", paise: 6000 }), bill([custom("कोलगेट पेस्ट")]), shop).exact).toBe(false);
  });

  it("a DIFFERENT product's name is wrong, even with the right numbers", () => {
    const e = one("चीनी", 2, "kg", { kind: "rate", paise: 4500 });
    expect(scoreRunD102("A01", e, bill([it_({ spokenName: "चावल", catalogId: "11" })]), shop)).toMatchObject({ wrongProducts: 1, wrongLines: 1, exact: false });
  });

  it("'shop price': the price must come from the product the owner said - another product's price is a wrong number", () => {
    const e = one("चीनी", 2, "kg", { kind: "default" });
    const right = it_({ rate: null, rateUnit: null, total: 9600, priceType: "default" });
    expect(scoreRunD102("A07", e, bill([right]), shop)).toMatchObject({ exact: true });
    const other = it_({ catalogId: "11", rate: null, rateUnit: null, total: 9600, priceType: "default" }); // the words say चीनी, the price is Chawal's
    expect(scoreRunD102("A07", e, bill([other]), shop)).toMatchObject({ wrongNumbers: 1, exact: false });
  });

  it("'shop price' for a product the catalog does not have: Price needed is right; a price from some other product is wrong", () => {
    const e = one("पोपट दाल", 1, "kg", { kind: "default" });
    expect(scoreRunD102("A61", e, bill([it_({ spokenName: "पोपट दाल", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, rate: null, rateUnit: null, total: null, priceType: "unknown" })]), shop).exact).toBe(true);
    expect(scoreRunD102("A61", e, bill([it_({ spokenName: "पोपट दाल", catalogId: "21", qty: 1, rate: null, rateUnit: null, total: 8000, priceType: "default" })]), shop).wrongNumbers).toBe(1);
  });

  it("a wrong spoken number is wrong; a name that does not look alike (and is no other product) is 'numbers right, name wrong'", () => {
    const e = one("पोपट दाल", 1, "kg", { kind: "rate", paise: 7200 });
    expect(scoreRunD102("A62", e, bill([it_({ spokenName: "पोपट दाल", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, rate: 2700, total: 2700 })]), shop).wrongNumbers).toBe(1);
    expect(scoreRunD102("A62", e, bill([it_({ spokenName: "झिलमिल", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, rate: 7200, total: 7200 })]), shop)).toMatchObject({ numbersRightNameWrong: 1, wrongLines: 0, exact: false });
  });

  it("a name said once and billed twice: silent duplicate (wrong) or warned duplicate (not wrong, not exact); a line nobody said is invented", () => {
    const e = one("चीनी", 3, "kg", { kind: "rate", paise: 5600 });
    const sugar = (qty: number) => it_({ qty, rate: 5600, total: qty * 5600 });
    expect(scoreRunD102("A59", e, bill([sugar(2), sugar(3)]), shop)).toMatchObject({ silentDuplicated: 1, wrongLines: 1 });
    expect(scoreRunD102("A59", e, bill([sugar(2), sugar(3)], { checks: 1, warnedLines: [0] }), shop)).toMatchObject({ warnedDuplicated: 1, wrongLines: 0, exact: false });
    expect(scoreRunD102("A59", e, bill([sugar(3), it_({ spokenName: "साबुन", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 1000, priceType: "total" })]), shop)).toMatchObject({ invented: 1, wrongLines: 1 });
  });

  it("a line that never arrived is dropped", () => {
    const two: ExpectedBill = { lines: [{ name: "चीनी", qty: 2, unit: "kg", price: { kind: "rate", paise: 4500 } }, { name: "चावल", qty: 5, unit: "kg", price: { kind: "default" } }], notAdded: 0, checks: 0 };
    expect(scoreRunD102("A20", two, bill([it_({})]), shop)).toMatchObject({ dropped: 1, wrongLines: 0 });
  });
});

describe("aroundWords - the transcript words around a heard name, so a wrong number can be judged", () => {
  it("shows up to n words either side of the first word of the name", () => {
    expect(aroundWords("एक दो तीन चार चीनी पांच छह सात आठ", "चीनी", 2)).toBe("… तीन चार [चीनी] पांच छह …");
  });
  it("falls back to the start when the name is not found", () => {
    expect(aroundWords("एक दो तीन", "साबुन", 2)).toBe("एक दो तीन");
  });
});

describe("D106 (tightened, owner 9 Nov 2026): a silent wrong number is the EAR's only inside that item's own segment", () => {
  const A47 = "फुटाने ₹102 किलो लाइजोल ₹110 गुड़ ₹98 चावल ₹98";
  const names = ["फुटाने", "लाइजोल", "गुड़", "चावल"];
  it("A47: Rs 102 sits right after फुटाने - the ear's", () => {
    expect(earHeard(A47, "फुटाने", 102, names)).toBe(true);
  });
  it("a number said for ANOTHER item (Rs 110 of लाइजोल) billed on फुटाने is our code's, not the ear's", () => {
    expect(earHeard(A47, "फुटाने", 110, names)).toBe(false);
  });
  it("a number said nowhere, or a name not in the transcript, is our code's", () => {
    expect(earHeard(A47, "फुटाने", 104, names)).toBe(false);
    expect(earHeard(A47, "चीनी", 98, names)).toBe(false);
  });
});
