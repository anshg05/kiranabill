import { describe, expect, it } from "vitest";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import type { ActualBill } from "../acceptance/compare.js";
import type { ExpectedBill } from "../acceptance/types.js";
import { declare, fromSaved, groqUsd, monthlyInr, toSaved, perRecording, SCORING_SPELLINGS, scoringCatalog, scoreRun, summarize, tokensUsd, webmSeconds, type RunResult } from "./score.js";
import { matchProductName } from "../../src/domain/grammar.js";

// KB-370: the bake-off's scoring. Every metric the owner asked for: exact bills, wrong numbers on a final line (0 for any winner),
// dropped / duplicated / invented items, lines with a Theek hai, seconds, rupees per bill and per month.

const shop = SEED_PARSER_CATALOG;
const line = (over: Partial<ParsedItem>) => {
  const item: ParsedItem = { spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate", ...over };
  return { item, displayName: shop.byId.get(item.catalogId ?? "")?.displayName ?? item.spokenName };
};
const bill = (lines: ActualBill["lines"], over: Partial<ActualBill> = {}): ActualBill => ({ lines, unresolved: 0, checks: 0, ...over });
const chiniAt45: ExpectedBill = { lines: [{ name: "चीनी", qty: 2, unit: "kg", price: { kind: "rate", paise: 4500 } }], notAdded: 0, checks: 0 };

describe("scoreRun", () => {
  it("an exact bill is exact, with nothing dropped, duplicated or invented", () => {
    expect(scoreRun("A01", chiniAt45, bill([line({})]), shop)).toMatchObject({ exact: true, wrongLines: 0, dropped: 0, silentDuplicated: 0, warnedDuplicated: 0, invented: 0 });
  });

  it("the same product twice is DUPLICATED (the dal-order failure); a product nobody said is INVENTED", () => {
    const s = scoreRun("A62", chiniAt45, bill([line({}), line({}), line({ spokenName: "साबुन", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 1000, priceType: "total" })]), shop);
    expect(s).toMatchObject({ exact: false, silentDuplicated: 1, warnedDuplicated: 0, invented: 1, dropped: 0 });
    expect(s.wrongLines).toBe(2); // both extra lines carry a number: wrong, and silent
  });

  it("a line that never arrived is DROPPED", () => {
    const two: ExpectedBill = { ...chiniAt45, lines: [...chiniAt45.lines, { name: "चावल", qty: 5, unit: "kg", price: { kind: "default" } }] };
    expect(scoreRun("A20", two, bill([line({})]), shop)).toMatchObject({ dropped: 1, wrongLines: 0 });
  });

  it("a wrong number and a wrong product are counted apart; lines with a Theek hai are counted", () => {
    const s = scoreRun("A33", chiniAt45, bill([line({ rate: 18000, total: 36000 })], { checks: 1, warnedLines: [0] }), shop);
    expect(s).toMatchObject({ wrongNumbers: 1, wrongProducts: 0, silentWrong: 0, warnedLines: 1, checks: 1 });
    const p = scoreRun("A27", chiniAt45, bill([line({ spokenName: "चावल", catalogId: "11" })]), shop);
    expect(p).toMatchObject({ wrongProducts: 1, wrongNumbers: 0 });
  });
});

// KB-370 scoring rules (owner, 1 Nov 2026) - the bake-off only; the gate's comparison (eval/acceptance/compare.ts) is unchanged.
const custom = (spokenName: string, over: Partial<ParsedItem> = {}) => line({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "unknown", ...over });
const shopPrice = (name: string): ExpectedBill => ({ lines: [{ name, qty: 1, unit: "kg", price: { kind: "default" } }], notAdded: 0, checks: 0 });

describe("rule 1 - shop price for a product the eval catalog does not have", () => {
  it("'Price needed' is RIGHT (there is no shop price to fill in)", () => {
    expect(scoreRun("A61", shopPrice("पोपट दाल"), bill([custom("पोपट दाल")]), shop)).toMatchObject({ exact: true, wrongLines: 0 });
  });
  it("the correct catalog product (a spelling mismatch, reviewed list) with its shop price is ALSO right", () => {
    const futana = line({ spokenName: "फुटाना", catalogId: "609", qty: 1, unit: "kg", rate: null, rateUnit: null, total: 9000, priceType: "default" });
    expect(scoreRun("A52", shopPrice("फुटाने"), bill([futana]), shop)).toMatchObject({ exact: true, wrongLines: 0, wrongProducts: 0 });
  });
  it("a wrong price is never right", () => {
    const futana = line({ spokenName: "फुटाना", catalogId: "609", qty: 1, unit: "kg", rate: 12000, rateUnit: "kg", total: 12000, priceType: "rate" });
    expect(scoreRun("A55", shopPrice("फुटाने"), bill([futana]), shop).wrongNumbers).toBe(1);
  });
  it("for a product the catalog DOES have, 'Price needed' is still only inexact (the shop price was there)", () => {
    expect(scoreRun("A55", shopPrice("चना दाल"), bill([custom("चना दाल")]), shop)).toMatchObject({ exact: false, wrongLines: 0 });
  });
  it("the reviewed spellings resolve only in the scoring catalog, to the product the owner meant", () => {
    const sc = scoringCatalog(shop);
    for (const [name, id] of Object.entries(SCORING_SPELLINGS)) expect(matchProductName(name, sc).catalogId, name).toBe(id);
    expect(matchProductName("फुटाने", shop).catalogId).toBeNull(); // the app's own catalog is untouched
  });
});

describe("rule 2 - custom lines", () => {
  const popat: ExpectedBill = { lines: [{ name: "पोपट दाल", qty: 1, unit: "kg", price: { kind: "rate", paise: 7200 } }], notAdded: 0, checks: 0 };
  const priced = { qty: 1, rate: 7200, rateUnit: "kg", total: 7200, priceType: "rate" as const };
  it("numbers right and the name looks alike = right", () => {
    expect(scoreRun("A62", popat, bill([custom("पोपट दाल", priced)]), shop)).toMatchObject({ exact: true, numbersRightNameWrong: 0 });
  });
  it("numbers right but the name does NOT look alike = 'numbers right, name wrong': not exact, not a wrong number", () => {
    expect(scoreRun("A62", popat, bill([custom("पॉप कॉर्न", priced)]), shop)).toMatchObject({ exact: false, numbersRightNameWrong: 1, wrongLines: 0 });
  });
  it("KB-370 fix: the SAME product under another spelling is not a 'different catalog product' (A47: लाइज़ॉल billed as Lizol)", () => {
    const lizolBill: ExpectedBill = { lines: [{ name: "लाइज़ॉल", qty: null, unit: "", price: { kind: "total", paise: 11000 } }], notAdded: 0, checks: 0 };
    const lizol = line({ spokenName: "लाइजॉल", catalogId: "200", qty: null, unit: "", rate: null, rateUnit: null, total: 11000, priceType: "total" });
    expect(scoreRun("A47", lizolBill, bill([lizol]), shop)).toMatchObject({ wrongProducts: 0, wrongLines: 0 });
    // A17: the heard WORD looks nothing like his (Whisper wrote "lizall"), but the product chosen is still Lizol - right
    const lizall = line({ spokenName: "lizall", catalogId: "200", qty: null, unit: "", rate: null, rateUnit: null, total: 11000, priceType: "total" });
    expect(scoreRun("A17", lizolBill, bill([lizall]), shop)).toMatchObject({ wrongProducts: 0, wrongLines: 0 });
  });

  it("owner, 1 Nov 2026: a BRAND billed as the generic catalog product with the right numbers is 'numbers right, name differs' - not exact, not wrong (A44)", () => {
    const kingBill: ExpectedBill = { lines: [{ name: "एवरेस्ट किचन किंग मसाला", qty: 1, unit: "packet", price: { kind: "default" } }], notAdded: 0, checks: 0 };
    const king = line({ spokenName: "एवरेस्ट किचन किंग मसाला 100 ग्राम", catalogId: "124", qty: 1, unit: "packet", rate: null, rateUnit: null, total: 5000, priceType: "default" });
    expect(scoreRun("A44", kingBill, bill([king]), shop)).toMatchObject({ wrongProducts: 0, wrongLines: 0, numbersRightNameWrong: 1, exact: false });
  });

  it("the same brand case with a DIFFERENT price is wrong", () => {
    const kingBill: ExpectedBill = { lines: [{ name: "एवरेस्ट किचन किंग मसाला", qty: 1, unit: "packet", price: { kind: "total", paise: 6000 } }], notAdded: 0, checks: 0 };
    const king = line({ spokenName: "एवरेस्ट किचन किंग मसाला", catalogId: "124", qty: 1, unit: "packet", rate: null, rateUnit: null, total: 5000, priceType: "total" });
    expect(scoreRun("A44", kingBill, bill([king]), shop).wrongLines).toBeGreaterThan(0);
  });

  it("a different CATALOG product chosen = a wrong product (silent when no Theek hai)", () => {
    const chana = line({ spokenName: "पोपट दाल", catalogId: "21", ...priced });
    expect(scoreRun("A62", popat, bill([chana]), shop)).toMatchObject({ wrongProducts: 1, silentWrong: 1, exact: false });
    expect(scoreRun("A62", popat, bill([chana], { checks: 1, warnedLines: [0] }), shop)).toMatchObject({ wrongProducts: 1, silentWrong: 0 });
  });
});

describe("owner, 1 Nov 2026: the canary's hole - the owner's WORDS on a line claiming ANOTHER catalog product", () => {
  // compare.ts (the gate's comparison, unchanged) calls these right because the heard words match his name; the canary had all four (C, A61 / A62)
  const priced = (name: string, total: number): ExpectedBill => ({ lines: [{ name, qty: 1, unit: "piece", price: { kind: "total", paise: total } }], notAdded: 0, checks: 0 });
  const claims = (spokenName: string, catalogId: string, total: number) => line({ spokenName, catalogId, qty: 1, unit: "piece", rate: null, rateUnit: null, total, priceType: "total" });
  it.each([
    ["रिन साबुन", "162", "Lifebuoy"],
    ["फेना साबुन", "453", "Godrej No.1 Soap"],
    ["फेना डिटर्जेंट", "193", "Nirma"],
  ])("%s billed as %s's id (%s) is a WRONG product", (name, id) => {
    expect(scoreRun("A61", priced(name, 10500), bill([claims(name, id, 10500)]), shop)).toMatchObject({ wrongProducts: 1, exact: false });
  });
  it("रवा billed as Chhena is a WRONG product (A62)", () => {
    const rava: ExpectedBill = { lines: [{ name: "रवा", qty: 1, unit: "kg", price: { kind: "total", paise: 4400 } }], notAdded: 0, checks: 0 };
    const chhena = line({ spokenName: "रवा", catalogId: "48", qty: 1, unit: "kg", rate: 4400, rateUnit: "kg", total: 4400, priceType: "rate" });
    expect(scoreRun("A62", rava, bill([chhena]), shop)).toMatchObject({ wrongProducts: 1, silentWrong: 1 });
  });
  it("the RIGHT catalog product is still right (रिन साबुन -> Rin; रवा -> Suji)", () => {
    expect(scoreRun("A61", priced("रिन साबुन", 10500), bill([claims("रिन साबुन", "192", 10500)]), shop)).toMatchObject({ wrongProducts: 0, exact: true });
    const rava: ExpectedBill = { lines: [{ name: "रवा", qty: 1, unit: "kg", price: { kind: "total", paise: 4400 } }], notAdded: 0, checks: 0 };
    expect(scoreRun("A62", rava, bill([line({ spokenName: "रवा", catalogId: "5", qty: 1, unit: "kg", rate: 4400, rateUnit: "kg", total: 4400, priceType: "rate" })]), shop).wrongProducts).toBe(0);
  });
  it("the product his name resolves to is right even when the app's own rule would not explain every word (A57: पार्ले जी बिस्किट -> Parle-G 30)", () => {
    const parle: ExpectedBill = { lines: [{ name: "पार्ले जी बिस्किट", qty: 5, unit: "packet", price: { kind: "rate", paise: 3000 } }], notAdded: 0, checks: 0 };
    const p30 = line({ spokenName: "पार्ले जी बिस्किट", catalogId: "53", qty: 5, unit: "packet", rate: 3000, rateUnit: "packet", total: 15000, priceType: "rate" });
    expect(scoreRun("A57", parle, bill([p30]), shop)).toMatchObject({ wrongProducts: 0, wrongLines: 0 });
  });
});

describe("rule 3 - a correction said in the order (A59: ONE 3 kg line is the bill)", () => {
  const sugar3: ExpectedBill = { lines: [{ name: "चीनी", qty: 3, unit: "kg", price: { kind: "rate", paise: 5600 } }], notAdded: 0, checks: 0 };
  const sugar = (qty: number) => line({ qty, rate: 5600, total: qty * 5600 });
  it("a second line WITH a Theek hai is a warned duplicate: listed, not a silent wrong, and the order is not exact", () => {
    const s = scoreRun("A59", sugar3, bill([sugar(2), sugar(3)], { checks: 1, warnedLines: [0] }), shop);
    expect(s).toMatchObject({ warnedDuplicated: 1, silentDuplicated: 0, wrongLines: 0, silentWrong: 0, exact: false });
    expect(s.wrong).toEqual([]);
  });
  it("a second line with NO warning is a silent duplicate - a wrong line", () => {
    expect(scoreRun("A59", sugar3, bill([sugar(2), sugar(3)]), shop)).toMatchObject({ silentDuplicated: 1, warnedDuplicated: 0, wrongLines: 1, silentWrong: 1 });
  });
});

describe("saved lines (KB-370: a scoring fix re-scores offline, no new call)", () => {
  it("a bill saved and read back scores exactly as the bill did - warnings and 'Not added' included", () => {
    // the second line is a wrong product whose verdict text carries the catalog's shown name ("Lifebuoy")
    const two: ExpectedBill = { ...chiniAt45, lines: [...chiniAt45.lines, { name: "रिन साबुन", qty: 1, unit: "piece", price: { kind: "total", paise: 10500 } }] };
    const actual = bill([line({}), line({ spokenName: "रिन साबुन", catalogId: "162", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 10500, priceType: "total" }), line({ spokenName: "साबुन", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 1000, priceType: "total" })], { checks: 1, warnedLines: [2], unresolved: 1 });
    expect(actual.lines[1]!.displayName).toBe("Lifebuoy");
    expect(scoreRun("A01", two, fromSaved(toSaved(actual), shop), shop)).toEqual(scoreRun("A01", two, actual, shop));
  });
});

describe("cost", () => {
  it("Groq bills at least 10 s per request ($0.111 an hour)", () => {
    expect(groqUsd(4)).toBeCloseTo((10 / 3600) * 0.111, 9);
    expect(groqUsd(90)).toBeCloseTo((90 / 3600) * 0.111, 9);
  });
  it("tokens at the model's price per 1M tokens", () => {
    expect(tokensUsd("gemini-3.5-flash-lite", { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 })).toBeCloseTo(0.3 + 2.5, 9);
    expect(tokensUsd("gemini-3.5-transcribe", { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 })).toBeCloseTo(2, 9);
    expect(() => tokensUsd("gemini-unknown", { promptTokens: 1, completionTokens: 1, totalTokens: 2 })).toThrow(/price/);
  });
  it("a month is 100 bills a day for 30 days", () => {
    expect(monthlyInr(0.001, 90)).toBeCloseTo(0.001 * 90 * 100 * 30, 9);
  });
});

describe("webmSeconds", () => {
  it("reads the Duration in the recording's header (Info, float32 ms at the default 1 ms timecode scale)", () => {
    const f = Buffer.alloc(4);
    f.writeFloatBE(19320);
    const buf = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x44, 0x89, 0x84]), f]);
    expect(webmSeconds(buf)).toBeCloseTo(19.32, 2);
  });
  it("without a Duration it estimates from the size at 128 kbps", () => {
    expect(webmSeconds(Buffer.alloc(160_000))).toBeCloseTo(10, 6);
  });
});

const run = (over: Partial<RunResult>): RunResult => ({
  candidate: "A", id: "A01", set: "short", run: 1, transcript: "x", seconds: 2, usd: 0.001, exact: true, wrongLines: 0, silentWrong: 0, wrongNumbers: 0, wrongProducts: 0,
  dropped: 0, silentDuplicated: 0, warnedDuplicated: 0, invented: 0, numbersRightNameWrong: 0, checks: 0, warnedLines: 0, wrong: [], audioSeconds: 12, ...over,
});

describe("summarize and perRecording", () => {
  it("adds up one candidate's set: exact share, wrong lines, seconds median / p90 / max, rupees per bill and per month", () => {
    const s = summarize([run({ seconds: 1 }), run({ id: "A02", seconds: 3, exact: false, wrongLines: 2, silentWrong: 1 }), run({ id: "A03", seconds: 2, error: "timeout", exact: false })], 90);
    expect(s).toMatchObject({ runs: 3, exact: 1, wrongLines: 2, silentWrong: 1, errors: 1, secondsMedian: 2, secondsMax: 3 });
    expect(s.inrPerBill).toBeCloseTo(0.001 * 90, 9);
    expect(s.inrPerMonth).toBeCloseTo(0.001 * 90 * 3000, 9);
  });
  it("per recording over its runs: best, worst and average", () => {
    const r = perRecording([run({ set: "long", id: "A51", run: 1, wrongLines: 0, exact: true }), run({ set: "long", id: "A51", run: 2, wrongLines: 3, exact: false }), run({ set: "long", id: "A51", run: 3, wrongLines: 1, exact: false })]);
    expect(r).toEqual([{ candidate: "A", id: "A51", runs: 3, exactRuns: 1, bestWrong: 0, worstWrong: 3, avgWrong: 4 / 3, avgSeconds: 2, audioSeconds: 12 }]);
  });
});

describe("declare - the calls a run will make, before it makes any", () => {
  it("counts each API per candidate: short orders once, long orders three times; A-30s only on long orders; D makes none", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 8 }, { id: "A02", set: "short", seconds: 12 }, { id: "A51", set: "long", seconds: 60 }], 3);
    expect(d.calls).toEqual({ groq: 2 + 3 + 2 + 3 + 3, transcribe: 5 + 5, layer2Max: 13 + 10, audioLite: 5, audioFlash: 5, sarvam: 0 });
    expect(d.total).toBe(13 + 10 + 23 + 5 + 5);
    expect(d.usd).toBeGreaterThan(0);
  });

  it("round 2: B-smart is a transcribe call + Layer 2; E-lite / E-flash one audio call; S (Sarvam) its own call + Layer 2, priced Rs 0.49 a minute", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 60 }], 3, ["B-smart", "E-lite", "E-flash", "S"], { transcribeS: 7, otherS: 3 }, { layer2In: 4_000, cIn: 14_000 }, 100);
    expect(d.calls).toEqual({ groq: 0, transcribe: 1, layer2Max: 2, audioLite: 1, audioFlash: 1, sarvam: 1 });
    const s = declare([{ id: "A01", set: "short", seconds: 60 }], 3, ["S"], { transcribeS: 7, otherS: 3 }, { layer2In: 4_000, cIn: 14_000 }, 100);
    const layer2 = ((4_000 * 0.3 + 400 * 2 * 2.5) / 1e6) * 1.18;
    expect(s.usd).toBeCloseTo((0.49 / 100) * 1.18 + layer2, 9);
  });

  it("the default candidates stay round 1's - a round-2 candidate runs only when chosen", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 8 }], 3);
    expect(d.calls.sarvam).toBe(0);
  });

  it("KB-370 re-run: counts only the chosen candidates (B, C, D: D still makes no call of its own)", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 8 }, { id: "A61", set: "long", seconds: 76 }], 3, ["B", "C", "D"]);
    expect(d.calls).toEqual({ groq: 0, transcribe: 1 + 3, layer2Max: 1 + 3, audioLite: 1 + 3, audioFlash: 0, sarvam: 0 });
  });

  it("owner, 1 Nov 2026: prices from LIST prices x estimated tokens, + a thinking allowance (as many tokens as the answer), + 18% GST", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 8 }], 3, ["C"], { transcribeS: 12, otherS: 3 }, { layer2In: 4_000, cIn: 14_000 });
    expect(d.usd).toBeCloseTo((((14_000 + 8 * 32) * 0.3 + 900 * 2 * 2.5) / 1e6) * 1.18, 9);
    const b = declare([{ id: "A01", set: "short", seconds: 8 }], 3, ["B"], { transcribeS: 12, otherS: 3 }, { layer2In: 4_000, cIn: 14_000 });
    expect(b.usd).toBeCloseTo((((8 * 32 * 2 + 8 * 8 * 12) + (4_000 * 0.3 + 400 * 2 * 2.5)) / 1e6) * 1.18, 9);
  });

  it("estimates the time from the measured call times plus the pace (B's transcribe calls at least 12 s apart)", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 8 }], 3, ["B"], { transcribeS: 12, otherS: 3 });
    expect(d.minutes).toBeCloseTo((12 + 3.6 + (3 + 1.5)) / 60, 6);
  });
});
