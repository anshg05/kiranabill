import { describe, expect, it } from "vitest";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { compareOrder } from "./compare.js";
import { replayLayer2, runOrder } from "./run.js";
import type { ExpectedBill } from "./types.js";

// KB-364: the tier A machinery on synthetic orders (the real ones arrive when the owner records them).

const answer = (over: Partial<ParsedItem>): ParsedItem => ({ spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "default", ...over });
const verdict = async (transcript: string, expected: ExpectedBill, recorded = {}) =>
  compareOrder("A01", expected, await runOrder(transcript, replayLayer2(recorded)), SEED_PARSER_CATALOG);

describe("tier A: a frozen transcript through the shipped resolver", () => {
  it("a Layer 1 order needs no recording and is exact", async () => {
    const v = await verdict("2 किलो चीनी 56 रुपए किलो", { lines: [{ name: "चीनी", qty: 2, unit: "kg", price: { kind: "rate", paise: 5600 } }], notAdded: 0, checks: 0 });
    expect(v.exact).toBe(true);
  });
  it("the price-less order of the owner: three lines by rule", async () => {
    const v = await verdict("बरबटी दाल एक किलो मूंग दाल दो किलो हरा बटाना एक किलो", {
      lines: [
        { name: "बरबटी दाल", qty: 1, unit: "kg", price: { kind: "default" } },
        { name: "मूंग दाल", qty: 2, unit: "kg", price: { kind: "default" } },
        { name: "हरा बटाना", qty: 1, unit: "kg", price: { kind: "default" } },
      ],
      notAdded: 0,
      checks: 0,
    });
    expect(v.exact).toBe(true);
  });
  it("a Layer 2 order replays Gemini's recorded answer", async () => {
    const text = "2 kilo kuch aur chini"; // not read by rule -> Layer 2
    const exp: ExpectedBill = { lines: [{ name: "चीनी", qty: 2, unit: "kg", price: { kind: "default" } }], notAdded: 0, checks: 0 };
    expect((await verdict(text, exp, { [text]: [answer({})] })).exact).toBe(true);
    // a WRONG recorded answer is caught
    expect((await verdict(text, exp, { [text]: [answer({ qty: 3, total: 13500 })] })).wrong).toHaveLength(1);
  });
  it("a text with no recorded answer is an error that says how to record it - never a silent pass", async () => {
    await expect(replayLayer2({})("anything", [])).rejects.toThrow(/accept:live -- --freeze/);
  });
  it("a recorded Layer 2 failure shows as one 'Not added' piece", async () => {
    const text = "2 kilo kuch aur chini";
    const v = await verdict(text, { lines: [], notAdded: 1, checks: 0 }, { [text]: null });
    expect(v.exact).toBe(true);
  });
});
