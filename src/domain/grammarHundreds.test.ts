import { describe, expect, it } from "vitest";
import { extractSpokenNumbers, parseUtterance } from "./grammar";
import { checkLayer2NumberOrder, evaluateReviewFlags } from "./reviewFlags";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import type { ParsedItem } from "./grammar";

// KB-363a (owner, 29 Oct 2026): Whisper writes सौ as "सो" / "सौं" (Roman "so" / "sau"). "एक सो दस" is ONE number, 110 - in Layer 1
// AND in the number-trace checker (one reader, classifySegment). Found on the owner's phone: "एक किलो मुंग मोगर एक सो दस रुपए किलो"
// was split into 1 and 10, so Gemini's correct 1 kg x Rs 110 got four warnings.

const parse = (t: string): ParsedItem => parseUtterance(t, SEED_PARSER_CATALOG)![0]!;

describe("a spelling of सौ straight after a number is a hundred", () => {
  it.each([
    ["एक सो दस", 110],
    ["दो सो अठासी", 288],
    ["दो सौं अठासी", 288],
    ["तीन सो", 300],
    ["ek so das", 110],
    ["do so athasi", 288],
    ["teen sau", 300],
    ["paanch so pachas", 550],
  ])("%s = %i, as ONE number", (said, value) => {
    expect(extractSpokenNumbers(`1 kilo chini ${said} rupay`)).toEqual([1, value]);
  });

  it("the owner's sentence is Rs 110 a kilo in Layer 1 (never 1 / 10, never a 10 kg quantity)", () => {
    const item = parse("एक किलो मुंग मोगर एक सो दस रुपए किलो");
    expect(item).toMatchObject({ qty: 1, unit: "kg", rate: 11000, total: 11000, priceType: "rate" });
  });
  it("a total: 'दो किलो चीनी दो सो अठासी रुपए' = Rs 288 for 2 kg", () => {
    expect(parse("दो किलो चीनी दो सो अठासी रुपए")).toMatchObject({ qty: 2, unit: "kg", total: 28800, priceType: "total" });
  });
  it("a bare 'सो' / 'so' (no number before it) is NOT a hundred - it stays an ordinary word", () => {
    expect(extractSpokenNumbers("सो किलो चीनी")).toEqual([]);
    expect(extractSpokenNumbers("so kilo chini")).toEqual([]);
    expect(extractSpokenNumbers("2 kilo chini so")).toEqual([2]);
  });
  it("a spelling right after another multiplier is not a second hundred ('सौ सो' is a 100 and a stray word)", () => {
    expect(extractSpokenNumbers("सौ सो किलो चीनी")).toEqual([100]);
    expect(extractSpokenNumbers("paanch sau so kilo chini")).toEqual([500]);
  });
  it("सौ itself is unchanged: 'सौ किलो' is still 100 kg, 'सवा सौ' 125", () => {
    expect(extractSpokenNumbers("सौ किलो चीनी")).toEqual([100]);
    expect(extractSpokenNumbers("सवा सौ ग्राम चीनी")).toEqual([125]);
  });
});

describe("the number checks read the same compound (no 'two numbers heard, one used')", () => {
  const SAID = "एक किलो मुंग मोगर एक सो दस रुपए किलो";
  const geminiLine: ParsedItem = { spokenName: "मुंग मोगर", catalogId: "622", isCustom: false, matchStatus: "matched", qty: 1, unit: "kg", rate: 11000, rateUnit: "kg", total: 11000, priceType: "rate" };

  it("no number flag for Gemini's correct 1 kg x Rs 110", () => {
    const flags = evaluateReviewFlags(SAID, [geminiLine], SEED_PARSER_CATALOG.entries);
    expect(flags.filter((f) => /number|qty_dropped/.test(f.code))).toEqual([]);
  });
  it("and no misalignment", () => {
    expect(checkLayer2NumberOrder(SAID, [geminiLine])).toBeNull();
  });
});
