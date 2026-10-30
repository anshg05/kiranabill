import { describe, expect, it } from "vitest";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import type { ReviewFlag } from "../../src/domain/reviewFlags.js";
import { checksOf, compareOrder, gate, type ActualBill, type OrderVerdict } from "./compare.js";
import type { ExpectedBill, ExpectedLine } from "./types.js";

// KB-364: the owner's expected bill against what the app produced. WRONG = a confident number that is not what was said.

const chini = (over: Partial<ParsedItem> = {}): ParsedItem => ({ spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "default", ...over });
const chawal = (over: Partial<ParsedItem> = {}): ParsedItem => ({ spokenName: "चावल", catalogId: "11", isCustom: false, matchStatus: "matched", qty: 5, unit: "kg", rate: 5000, rateUnit: "kg", total: 25000, priceType: "default", ...over });
const bill = (items: ParsedItem[], over: Partial<ActualBill> = {}): ActualBill => ({ lines: items.map((item) => ({ item, displayName: item.spokenName })), unresolved: 0, checks: 0, ...over });
const exp = (lines: ExpectedLine[], over: Partial<ExpectedBill> = {}): ExpectedBill => ({ lines, notAdded: 0, checks: 0, ...over });
const line = (name: string, qty: number | null, unit: string, price: ExpectedLine["price"]): ExpectedLine => ({ name, qty, unit, price });
const run = (e: ExpectedBill, a: ActualBill) => compareOrder("A01", e, a, SEED_PARSER_CATALOG);

describe("a line that is exactly what was expected", () => {
  it("default price: the shop's own price", () => {
    expect(run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chini()])).exact).toBe(true);
  });
  it("a spoken rate per kilo", () => {
    const a = chini({ rate: 5600, total: 11200, priceType: "rate" });
    expect(run(exp([line("चीनी", 2, "kg", { kind: "rate", paise: 5600 })]), bill([a])).exact).toBe(true);
  });
  it("a spoken total (with or without a quantity)", () => {
    const a = chawal({ rate: null, total: 22500, priceType: "total" });
    expect(run(exp([line("चावल", 5, "kg", { kind: "total", paise: 22500 })]), bill([a])).exact).toBe(true);
    const b = chawal({ qty: null, unit: "", rate: null, total: 9000, priceType: "total" });
    expect(run(exp([line("चावल", null, "", { kind: "total", paise: 9000 })]), bill([b])).exact).toBe(true);
  });
  it("'Price needed': the line has its quantity and no price", () => {
    const a = chini({ rate: null, rateUnit: null, total: null, priceType: "unknown" });
    expect(run(exp([line("चीनी", 2, "kg", { kind: "needed" })]), bill([a])).exact).toBe(true);
  });
  it("two lines in order", () => {
    expect(run(exp([line("चीनी", 2, "kg", { kind: "default" }), line("चावल", 5, "kg", { kind: "default" })]), bill([chini(), chawal()])).exact).toBe(true);
  });
});

describe("WRONG: a confident number that is not what was said", () => {
  const e = exp([line("चीनी", 2, "kg", { kind: "default" })]);
  it.each([
    ["a different quantity", chini({ qty: 3, total: 13500 }), /quantity/],
    ["a different unit", chini({ unit: "gm" }), /unit/],
    ["a different product", chawal({ qty: 2, total: 10000 }), /product/],
    ["a price that was never said", chini({ rate: 6000, total: 12000, priceType: "rate" }), /price/],
  ])("%s", (_label, a, why) => {
    const v = run(e, bill([a]));
    expect(v.exact).toBe(false);
    expect(v.wrong).toHaveLength(1);
    expect(v.wrong[0]).toMatch(why);
  });
  it("the draft-v7 class: 90 was a TOTAL, the app made it a rate", () => {
    const v = run(exp([line("चावल", 2, "kg", { kind: "total", paise: 9000 })]), bill([chawal({ qty: 2, rate: 9000, total: 18000, priceType: "rate" })]));
    expect(v.wrong).toHaveLength(1);
  });
  it("a price where 'Price needed' was expected: an invented number", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "needed" })]), bill([chini()]));
    expect(v.wrong).toHaveLength(1);
    expect(v.wrong[0]).toMatch(/invented/);
  });
  it("an extra line nobody asked for", () => {
    const v = run(e, bill([chini(), chawal()]));
    expect(v.wrong).toHaveLength(1);
    expect(v.extra).toHaveLength(1);
  });
  it("a spoken rate read at a different rate", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "rate", paise: 5600 })]), bill([chini({ rate: 6500, total: 13000, priceType: "rate" })]));
    expect(v.wrong).toHaveLength(1);
  });
});

describe("KB-364 first live run: the comparer judges a bill as a set, and is fair about names it cannot resolve", () => {
  it("lines match by product, not by position (Layer 1 lines come before Layer 2 lines on the bill)", () => {
    const e = exp([line("चीनी", 2, "kg", { kind: "default" }), line("चावल", 5, "kg", { kind: "default" })]);
    expect(run(e, bill([chawal(), chini()])).exact).toBe(true);
  });
  it("the heard name is close to the name the owner wrote -> the same product, whatever id the app gave", () => {
    const e = exp([line("फल्ली दाना", 1, "kg", { kind: "default" })]);
    const a = chini({ spokenName: "फल्ली दाने", catalogId: "228", rate: 12000, total: 12000, qty: 1 });
    expect(run(e, bill([a])).exact).toBe(true);
  });
  it("a generic name the owner wrote ('तेल') that the app read with the same word is not a wrong product", () => {
    const e = exp([line("तेल", 1, "liter", { kind: "default" })]);
    const a = chini({ spokenName: "तेल", catalogId: "39", unit: "liter", qty: 1, rate: 14000, rateUnit: "liter", total: 14000 });
    expect(run(e, bill([a])).wrong).toEqual([]);
  });
  it("a name the catalog cannot resolve, read as a DIFFERENT product: inexact (the owner's spelling may simply be unknown), never wrong", () => {
    const e = exp([line("xyzzy khaas", 2, "kg", { kind: "default" })]);
    const v = run(e, bill([chini()]));
    expect(v.wrong).toEqual([]);
    expect(v.exact).toBe(false);
    expect(v.inexact.join()).toMatch(/name/);
  });
  it("a name that DOES resolve, read as a different product with different words: WRONG", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chawal({ qty: 2, total: 10000 })]));
    expect(v.wrong).toHaveLength(1);
  });
  it("a wrong line says whether a Theek hai warned about it", () => {
    const e = exp([line("चीनी", 2, "kg", { kind: "default" })]);
    const a = chini({ qty: 3, total: 13500 });
    const silent = run(e, bill([a]));
    expect(silent.silentWrong).toBe(1);
    const warned = run(e, bill([a], { warnedLines: [0] }));
    expect(warned.wrong).toHaveLength(1);
    expect(warned.wrong[0]).toMatch(/Theek hai warned/);
    expect(warned.silentWrong).toBe(0);
  });
  it("the gate reports silent wrong lines separately", () => {
    const g = gate([{ id: "A01", exact: false, wrong: ["x"], missing: [], extra: [], inexact: [], notAddedOk: true, unexpectedChecks: false, silentWrong: 1 }]);
    expect(g.wrongLines).toBe(1);
    expect(g.silentWrongLines).toBe(1);
  });
});

describe("KB-364: what the first live run showed the comparer was unfair about", () => {
  const custom = (over: Partial<ParsedItem>) => chini({ catalogId: null, isCustom: true, matchStatus: "none", ...over });
  it("a custom line (the app claims NO catalog product) is never a wrong PRODUCT - the heard word was just not in the catalog", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([custom({ spokenName: "बिलकुल अलग शब्द", priceType: "unknown", rate: null, total: null })]));
    expect(v.wrong).toEqual([]);
    expect(v.exact).toBe(false);
  });
  it("at quantity 1 a rate and a total are the same bill", () => {
    const e = exp([line("चीनी", 1, "kg", { kind: "rate", paise: 12000 })]);
    expect(run(e, bill([chini({ qty: 1, rate: null, rateUnit: null, total: 12000, priceType: "total" })])).exact).toBe(true);
    // but a different amount is still wrong
    expect(run(e, bill([chini({ qty: 1, rate: null, rateUnit: null, total: 15000, priceType: "total" })])).wrong).toHaveLength(1);
  });
  it("2 kg at a spoken Rs 150 TOTAL is not 2 kg at Rs 150 a kilo (the draft-v7 class stays wrong)", () => {
    const e = exp([line("चीनी", 2, "kg", { kind: "rate", paise: 15000 })]);
    expect(run(e, bill([chini({ rate: null, rateUnit: null, total: 15000, priceType: "total" })])).wrong).toHaveLength(1);
  });
  it("piece and packet (and the other count units) are one unit for a catalog price; kg and gm are not", () => {
    const e = exp([line("चीनी", 1, "packet", { kind: "total", paise: 14000 })]);
    expect(run(e, bill([chini({ qty: 1, unit: "piece", rate: null, total: 14000, priceType: "total" })])).wrong).toEqual([]);
    expect(run(exp([line("चीनी", 1, "kg", { kind: "total", paise: 14000 })]), bill([chini({ qty: 1, unit: "gm", rate: null, total: 14000, priceType: "total" })])).wrong).toHaveLength(1);
  });
  it("leftovers are paired only when they are a plain substitution (same number each side); otherwise they are missing / extra", () => {
    const e = exp([line("चीनी", 2, "kg", { kind: "default" }), line("चावल", 5, "kg", { kind: "default" }), line("बेसन", 1, "kg", { kind: "default" })]);
    const v = run(e, bill([chini({ spokenName: "तेल पैकेट", catalogId: "39", qty: 1, unit: "liter", rate: 14000, total: 14000 })]));
    expect(v.missing).toHaveLength(3);
    expect(v.wrong.length).toBe(1); // only the extra line, not a wrong product / quantity / unit on three imaginary pairs
  });
});

describe("an extra line with no number at all is a visible empty line, not a wrong number (A45)", () => {
  it("an unpriced, quantity-less extra line is inexact (the shopkeeper removes it - it shows Price needed)", () => {
    const empty = chini({ spokenName: "थूप", catalogId: "204", qty: null, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown" });
    const v = run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chini(), empty]));
    expect(v.wrong).toEqual([]);
    expect(v.extra).toHaveLength(1);
    expect(v.exact).toBe(false);
  });
  it("an extra line WITH a price or a quantity is still wrong", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chini(), chawal()]));
    expect(v.wrong).toHaveLength(1);
  });
});

describe("NOT exact but NOT wrong: the app did not guess", () => {
  it("a missing line", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "default" }), line("चावल", 5, "kg", { kind: "default" })]), bill([chini()]));
    expect(v.wrong).toEqual([]);
    expect(v.missing).toHaveLength(1);
    expect(v.exact).toBe(false);
  });
  it("the price left out where a price was said", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "rate", paise: 5600 })]), bill([chini({ rate: null, rateUnit: null, total: null, priceType: "unknown" })]));
    expect(v.wrong).toEqual([]);
    expect(v.exact).toBe(false);
  });
  it("the right numbers on a custom line that did not match the catalog", () => {
    const v = run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chini({ catalogId: null, isCustom: true, matchStatus: "none", priceType: "unknown", rate: null, total: null })]));
    expect(v.wrong).toEqual([]);
    expect(v.exact).toBe(false);
  });
});

describe("a product the catalog does not have", () => {
  it("is matched by its name as the owner wrote it", () => {
    const a = chini({ spokenName: "xyzzy khaas", catalogId: null, isCustom: true, matchStatus: "none", qty: 2, rate: 13000, total: 26000, priceType: "rate" });
    const e = exp([line("xyzzy khaas", 2, "kg", { kind: "rate", paise: 13000 })]);
    expect(run(e, bill([a])).exact).toBe(true);
    expect(run(exp([line("kuch aur", 2, "kg", { kind: "rate", paise: 13000 })]), bill([a])).exact).toBe(false);
  });
});

describe("Not added, and checks", () => {
  it("the number of 'Not added' pieces must match", () => {
    expect(run(exp([], { notAdded: 1 }), bill([], { unresolved: 1 })).exact).toBe(true);
    expect(run(exp([], { notAdded: 1 }), bill([], { unresolved: 0 })).exact).toBe(false);
    expect(run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chini()], { unresolved: 1 })).exact).toBe(false);
  });
  it("more checks than the owner accepts is an unexpected check; fewer is fine", () => {
    const e = exp([line("चीनी", 2, "kg", { kind: "default" })], { checks: 1 });
    expect(run(e, bill([chini()], { checks: 2 })).unexpectedChecks).toBe(true);
    expect(run(e, bill([chini()], { checks: 1 })).unexpectedChecks).toBe(false);
    expect(run(e, bill([chini()], { checks: 0 })).exact).toBe(true);
    expect(run(exp([line("चीनी", 2, "kg", { kind: "default" })]), bill([chini()], { checks: 1 })).exact).toBe(false);
  });
});

describe("checksOf - the Theek hai checks the screen would show", () => {
  const f = (code: string, itemIndex: number | null, severity: "HIGH" | "MEDIUM" = "HIGH") => ({ id: code, code, severity, message: "x", itemIndex }) as ReviewFlag;
  it("counts one per line (or per order block under the last line), HIGH only", () => {
    expect(checksOf([f("unusual_rate", 0), f("unusual_total", 0), f("number_dropped", null)], 2)).toBe(2); // line 0 + the order block under line 1
    expect(checksOf([f("number_dropped", null), f("unusual_rate", 1)], 2)).toBe(1); // joins the last line
    expect(checksOf([f("already_on_bill", 0, "MEDIUM")], 1)).toBe(0);
    expect(checksOf([], 3)).toBe(0);
  });
});

describe("the release gate", () => {
  const v = (id: string, over: Partial<OrderVerdict> = {}): OrderVerdict => ({ id, exact: true, wrong: [], missing: [], extra: [], inexact: [], notAddedOk: true, unexpectedChecks: false, silentWrong: 0, ...over });
  it("passes: 0 wrong, 90% exact, no unexpected checks", () => {
    const vs = [...Array.from({ length: 9 }, (_, i) => v(`A0${i + 1}`)), v("A10", { exact: false, missing: ["x"] })];
    const g = gate(vs);
    expect(g).toMatchObject({ passed: true, wrongLines: 0, exact: 9, total: 10 });
  });
  it("one wrong line fails it, however good the rest", () => {
    const g = gate([...Array.from({ length: 49 }, (_, i) => v(`A${i}`)), v("A99", { exact: false, wrong: ["a confident wrong"] })]);
    expect(g.passed).toBe(false);
    expect(g.reasons.join()).toMatch(/wrong/);
  });
  it("below 90% exact fails", () => {
    const g = gate([...Array.from({ length: 8 }, (_, i) => v(`A0${i}`)), v("A98", { exact: false }), v("A99", { exact: false })]);
    expect(g.passed).toBe(false);
    expect(g.reasons.join()).toMatch(/90/);
  });
  it("an unexpected check fails it", () => {
    const g = gate([...Array.from({ length: 19 }, (_, i) => v(`A${i}`)), v("A99", { unexpectedChecks: true })]);
    expect(g.passed).toBe(false);
    expect(g.reasons.join()).toMatch(/check/);
  });
  it("no orders at all never passes", () => {
    expect(gate([]).passed).toBe(false);
  });
});
