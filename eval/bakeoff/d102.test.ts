import { describe, expect, it } from "vitest";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import type { ActualBill } from "../acceptance/compare.js";
import type { ExpectedBill } from "../acceptance/types.js";
import { aroundWords, scoreRunD102 } from "./d102.js";

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
