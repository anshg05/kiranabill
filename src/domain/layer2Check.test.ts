import { describe, expect, it } from "vitest";
import type { ParsedItem, UtterancePart } from "./grammar";
import { pieceHasUnreadPrice } from "./grammar";
import { checkLayer2AgainstSpoken } from "./layer2Check";
import type { SettledLine } from "./layer2";

// KB-359 (owner, 29-30 Oct 2026): Gemini's answer is checked against what Layer 1 could read of the SAME spoken piece.
// A: the spoken price and Gemini's price disagree -> the line keeps Gemini's numbers and gets a HIGH flag.
// B: a price was said but nobody could read it -> whatever price Gemini gave is DISCARDED (line = "price needed"), no flag.

const base = { spokenName: "चावल", catalogId: null, isCustom: true, matchStatus: "none" as const, rateUnit: null };
/** Layer 1's reading of "5 किलो चावल 30 रुपए" (a bare total, product garbled) */
const SPOKEN_TOTAL: ParsedItem = { ...base, qty: 5, unit: "kg", rate: null, total: 3000, priceType: "total" };
const part = (text: string, item: ParsedItem | null): UtterancePart => ({ text, item });
const line = (over: Partial<ParsedItem>): SettledLine => ({
  displayName: "चावल",
  item: { ...base, qty: 5, unit: "kg", rate: null, total: null, priceType: "unknown", ...over },
});

describe("Check A - the AI's number disagrees with the spoken one", () => {
  const pieces = [part("5 किलो चावल 30 रुपए", SPOKEN_TOTAL)];

  it("the same quantity, unit and total -> nothing", () => {
    const r = checkLayer2AgainstSpoken(pieces, [line({ total: 3000, priceType: "total" })]);
    expect(r.flags).toEqual([]);
  });
  it("the draft-v7 class: 30 was a TOTAL, the AI read it as a RATE (Rs 150) -> HIGH flag on that line, the AI's number is kept and shown", () => {
    const g = line({ rate: 3000, rateUnit: "kg", total: 15000, priceType: "rate" });
    const r = checkLayer2AgainstSpoken(pieces, [g]);
    expect(r.lines[0]).toEqual(g);
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]).toMatchObject({ code: "layer2_disagrees", severity: "HIGH", itemIndex: 0 });
    expect(r.flags[0]!.message).toContain("30");
    expect(r.flags[0]!.message).toContain("150");
  });
  it("a different quantity is a disagreement too", () => {
    const r = checkLayer2AgainstSpoken(pieces, [line({ qty: 6, total: 3000, priceType: "total" })]);
    expect(r.flags.map((f) => f.code)).toEqual(["layer2_disagrees"]);
  });
  it("a different unit is a disagreement too (a unit is never changed silently)", () => {
    const r = checkLayer2AgainstSpoken(pieces, [line({ unit: "piece", total: 3000, priceType: "total" })]);
    expect(r.flags.map((f) => f.code)).toEqual(["layer2_disagrees"]);
  });
  it("the AI did not know the price (unknown) -> nothing: no number was invented", () => {
    expect(checkLayer2AgainstSpoken(pieces, [line({})]).flags).toEqual([]);
  });
  it("a rate spoken per unit: the same total -> nothing; a different one -> flag", () => {
    const spoken: ParsedItem = { ...base, qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate" };
    const p = [part("2 किलो चावल 45 रुपए किलो", spoken)];
    expect(checkLayer2AgainstSpoken(p, [line({ qty: 2, rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate" })]).flags).toEqual([]);
    expect(checkLayer2AgainstSpoken(p, [line({ qty: 2, rate: 450, rateUnit: "kg", total: 900, priceType: "rate" })]).flags).toHaveLength(1);
  });
  it("Layer 1 read no price (default / unknown) -> nothing to compare with", () => {
    const spoken: ParsedItem = { ...base, qty: 5, unit: "kg", rate: 4800, rateUnit: "kg", total: 24000, priceType: "default" };
    expect(checkLayer2AgainstSpoken([part("5 किलो चावल", spoken)], [line({ total: 99900, priceType: "total" })]).flags).toEqual([]);
  });
  it("Layer 1 read nothing of the piece (item null) -> nothing to compare with", () => {
    expect(checkLayer2AgainstSpoken([part("kuch kuch", null)], [line({ total: 99900, priceType: "total" })]).flags).toEqual([]);
  });
  it("a different number of lines than pieces -> pieces cannot be paired: nothing checked, lines unchanged", () => {
    const two = [line({ rate: 3000, rateUnit: "kg", total: 15000, priceType: "rate" }), line({ total: 100, priceType: "total" })];
    const r = checkLayer2AgainstSpoken(pieces, two);
    expect(r.flags).toEqual([]);
    expect(r.lines).toEqual(two);
  });
  it("each line is checked against ITS piece; the flag points at the right line", () => {
    const p = [part("5 किलो चावल 30 रुपए", SPOKEN_TOTAL), part("5 किलो चावल 30 रुपए", SPOKEN_TOTAL)];
    const r = checkLayer2AgainstSpoken(p, [line({ total: 3000, priceType: "total" }), line({ rate: 3000, rateUnit: "kg", total: 15000, priceType: "rate" })]);
    expect(r.flags.map((f) => f.itemIndex)).toEqual([1]);
  });
});

describe("Check B - a price was said but could not be read", () => {
  const TEXT = "एक किलो मुँगडाल चैन रुपए किलो";
  const pieces = [part(TEXT, null)];

  it("pieceHasUnreadPrice: a currency word inside the name = a price nobody understood", () => {
    expect(pieceHasUnreadPrice(TEXT)).toBe(true);
    expect(pieceHasUnreadPrice("दो किलो बरबटी दाल अठ्यासथा रुपए किलो")).toBe(true);
    expect(pieceHasUnreadPrice("2 किलो चीनी 45 रुपए किलो")).toBe(false);
    expect(pieceHasUnreadPrice("एक किलो मूंग दाल")).toBe(false);
  });
  it.each([
    ["a rate", { rate: 6000, rateUnit: "kg", total: 6000, priceType: "rate" as const }],
    ["a total", { total: 6000, priceType: "total" as const }],
    ["the catalog's default price standing in for it", { rate: 12000, rateUnit: "kg", total: 12000, priceType: "default" as const }],
  ])("the AI's %s is DISCARDED - the line keeps its quantity and has NO price; no flag", (_label, price) => {
    const r = checkLayer2AgainstSpoken(pieces, [line({ qty: 1, ...price })]);
    expect(r.flags).toEqual([]);
    expect(r.lines[0]!.item).toMatchObject({ qty: 1, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "unknown" });
    expect(r.lines[0]!.displayName).toBe("चावल");
  });
  it("an AI line that already has no price is left exactly as it is", () => {
    const g = line({ qty: 1 });
    expect(checkLayer2AgainstSpoken(pieces, [g]).lines[0]).toEqual(g);
  });
  it("with a different number of lines than pieces nothing is paired, so nothing is discarded", () => {
    const two = [line({ total: 6000, priceType: "total" }), line({ total: 6000, priceType: "total" })];
    expect(checkLayer2AgainstSpoken(pieces, two).lines).toEqual(two);
  });
});
