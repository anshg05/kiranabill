import { describe, expect, it } from "vitest";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import type { ActualBill } from "../acceptance/compare.js";
import type { ExpectedBill } from "../acceptance/types.js";
import { declare, groqUsd, monthlyInr, perRecording, scoreRun, summarize, tokensUsd, webmSeconds, type RunResult } from "./score.js";

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
    expect(scoreRun("A01", chiniAt45, bill([line({})]), shop)).toMatchObject({ exact: true, wrongLines: 0, dropped: 0, duplicated: 0, invented: 0 });
  });

  it("the same product twice is DUPLICATED (the dal-order failure); a product nobody said is INVENTED", () => {
    const s = scoreRun("A62", chiniAt45, bill([line({}), line({}), line({ spokenName: "साबुन", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 1000, priceType: "total" })]), shop);
    expect(s).toMatchObject({ exact: false, duplicated: 1, invented: 1, dropped: 0 });
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
  dropped: 0, duplicated: 0, invented: 0, checks: 0, warnedLines: 0, wrong: [], ...over,
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
    expect(r).toEqual([{ candidate: "A", id: "A51", runs: 3, exactRuns: 1, bestWrong: 0, worstWrong: 3, avgWrong: 4 / 3, avgSeconds: 2 }]);
  });
});

describe("declare - the calls a run will make, before it makes any", () => {
  it("counts each API per candidate: short orders once, long orders three times; A-30s only on long orders; D makes none", () => {
    const d = declare([{ id: "A01", set: "short", seconds: 8 }, { id: "A02", set: "short", seconds: 12 }, { id: "A51", set: "long", seconds: 60 }], 3);
    expect(d.calls).toEqual({ groq: 2 + 3 + 2 + 3 + 3, transcribe: 5 + 5, layer2Max: 13 + 10, audioLite: 5, audioFlash: 5 });
    expect(d.total).toBe(13 + 10 + 23 + 5 + 5);
    expect(d.usd).toBeGreaterThan(0);
  });
});
