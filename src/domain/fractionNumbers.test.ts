import { describe, expect, it } from "vitest";
import { extractSpokenNumbers, parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-381 (owner, 8 Nov 2026 - money): पौने / सवा / साढ़े / डेढ़ / ढाई read the SAME whether the number after them is a digit or a word.
// With a ROUND hundred or thousand they scale its leading count ("पौने 200" = पौने दो सौ = 175); with a small number they change that
// number ("पौने 2" = 1.75). Before KB-381 the digit forms read "पौने 2" as 0.75 and 2 (Layer 1 billed qty 2) and "साढ़े 300" as 300.5
// (Layer 1 billed Rs 300.50). Both paths share this reader, so both are tested: the number reader and Layer 1's bill.

const CASES: readonly [string, string, number][] = [
  ["पौने 100", "पौने सौ", 75],
  ["सवा 100", "सवा सौ", 125],
  ["पौने 200", "पौने दो सौ", 175],
  ["सवा 200", "सवा दो सौ", 225],
  ["साढ़े 300", "साढ़े तीन सौ", 350],
  ["डेढ़ 100", "डेढ़ सौ", 150],
  ["ढाई 100", "ढाई सौ", 250],
  ["पौने 1000", "पौने हज़ार", 750],
  ["सवा 1000", "सवा हज़ार", 1250],
  ["डेढ़ 1000", "डेढ़ हज़ार", 1500],
  ["ढाई 1000", "ढाई हज़ार", 2500],
  ["साढ़े 2000", "साढ़े दो हज़ार", 2500],
  ["पौने 2", "पौने दो", 1.75],
  ["सवा 2", "सवा दो", 2.25],
  ["साढ़े 2", "साढ़े दो", 2.5],
];

describe("पौने / सवा / साढ़े / डेढ़ / ढाई - a digit reads the same as the word", () => {
  it.each(CASES)("the number reader: %s = %s = %d", (digits, words, value) => {
    expect(extractSpokenNumbers(`${digits} रुपए`)).toEqual([value]);
    expect(extractSpokenNumbers(`${words} रुपए`)).toEqual([value]);
  });

  it.each(CASES)("Layer 1's bill (a spoken total): चीनी %s रुपए = चीनी %s रुपए = Rs %d", (digits, words, value) => {
    const total = (t: string) => parseUtterance(`चीनी ${t} रुपए`, SEED_PARSER_CATALOG)?.[0]?.total ?? null;
    expect(total(digits)).toBe(Math.round(value * 100));
    expect(total(words)).toBe(Math.round(value * 100));
  });

  it("Layer 1's quantity: 'पौने 2 किलो चीनी' is 1.75 kg (it was 2), 'सवा 2 किलो' 2.25 kg - as the words", () => {
    const qty = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG)?.[0]?.qty ?? null;
    expect(qty("पौने 2 किलो चीनी")).toBe(1.75);
    expect(qty("सवा 2 किलो चीनी")).toBe(2.25);
    expect(qty("पौने दो किलो चीनी")).toBe(1.75);
  });

  it("unchanged: the bare words, डेढ़ / ढाई alone, and a round number they do not belong to", () => {
    expect(extractSpokenNumbers("पौने किलो")).toEqual([0.75]);
    expect(extractSpokenNumbers("सवा किलो")).toEqual([1.25]);
    expect(extractSpokenNumbers("डेढ़ किलो")).toEqual([1.5]);
    expect(extractSpokenNumbers("ढाई किलो")).toEqual([2.5]);
    expect(extractSpokenNumbers("डेढ़ 200")).toEqual([1.5, 200]); // not Hindi for anything: two numbers, never a guess
  });
});

describe("KB-383 follow-up (owner, 9 Nov 2026): '1/2' / '1/4' / '3/4' directly before a unit word - both paths, no division", () => {
  it("the number reader: '1/2 किलो' = 0.5, '1/4 किलो' = 0.25, '3/4 लीटर' = 0.75", () => {
    expect(extractSpokenNumbers("1/2 किलो")).toEqual([0.5]);
    expect(extractSpokenNumbers("1/4 किलो")).toEqual([0.25]);
    expect(extractSpokenNumbers("3/4 लीटर")).toEqual([0.75]);
  });

  it("Layer 1's bill: '1/2 किलो चीनी' is 0.5 kg (it was a Price-needed line with no quantity); A42's 'सह्याद्री चाय 1/2 किलो 185 रुपए' is 0.5 kg at Rs 185", () => {
    expect(parseUtterance("1/2 किलो चीनी", SEED_PARSER_CATALOG)?.[0]).toMatchObject({ qty: 0.5, unit: "kg" });
    expect(parseUtterance("सह्याद्री चाय 1/2 किलो 185 रुपए", SEED_PARSER_CATALOG)?.[0]).toMatchObject({ qty: 0.5, unit: "kg", total: 18500 });
  });

  it("unchanged: '1/2' with no unit after it, and any other fraction ('2/3 किलो'), is never read as a number", () => {
    expect(extractSpokenNumbers("1/2")).toEqual([]);
    expect(extractSpokenNumbers("2/3 किलो")).toEqual([]);
  });
});
