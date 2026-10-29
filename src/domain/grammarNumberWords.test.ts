import { describe, expect, it } from "vitest";
import { parseUtterance, extractSpokenNumbers, type ParsedItem } from "./grammar";
import { CANONICAL_DEVANAGARI } from "./numberWords";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-361: a number word is read as a price, a quantity or part of a hundred by Layer 1, in every number from 1 to 100.

const one = (t: string): ParsedItem => {
  const items = parseUtterance(t, SEED_PARSER_CATALOG);
  expect(items, `"${t}" bailed`).not.toBeNull();
  expect(items).toHaveLength(1);
  return items![0]!;
};

describe("every number 1-100 as a per-kilo price", () => {
  it.each(CANONICAL_DEVANAGARI.map((w, i) => [i + 1, w] as const))("2 किलो चीनी %i (%s) रुपए किलो", (n, word) => {
    expect(one(`2 किलो चीनी ${word} रुपए किलो`)).toMatchObject({ qty: 2, unit: "kg", rate: n * 100, total: n * 200, priceType: "rate" });
  });
});

describe("every number 1-100 as a bare total", () => {
  it.each(CANONICAL_DEVANAGARI.map((w, i) => [i + 1, w] as const))("2 किलो चावल %i (%s) रुपए", (n, word) => {
    expect(one(`2 किलो चावल ${word} रुपए`)).toMatchObject({ qty: 2, unit: "kg", rate: null, total: n * 100, priceType: "total" });
  });
});

describe("every number 1-100 as a quantity", () => {
  it.each(CANONICAL_DEVANAGARI.map((w, i) => [i + 1, w] as const))("%i (%s) किलो चीनी 10 रुपए किलो", (n, word) => {
    expect(one(`${word} किलो चीनी 10 रुपए किलो`)).toMatchObject({ qty: n, unit: "kg", rate: 1000, total: n * 1000 });
  });
});

describe("the owner's words, in his orders", () => {
  it("'अठ्यासी रुपए किलो' (88) and 'छियानवे रुपए किलो' (96) are read by rule", () => {
    expect(one("एक किलो बरबटी दाल अठ्यासी रुपए किलो")).toMatchObject({ qty: 1, rate: 8800, total: 8800 });
    expect(one("1 किलो मूंग दाल छ्यानो रुपए किलो")).toMatchObject({ qty: 1, rate: 9600, total: 9600 });
    expect(one("1 किलो मूंग दाल छियानबे रुपए किलो")).toMatchObject({ qty: 1, rate: 9600, total: 9600 });
  });
  it("a misheard price word is still NOT a number: the piece is not read by rule (never the catalog's price)", () => {
    expect(parseUtterance("एक किलो मुँगडाल चैन रुपए किलो", SEED_PARSER_CATALOG)).toBeNull();
  });
});

describe("hundreds: सौ, डेढ़ सौ, ढाई सौ and a hundred plus a number word", () => {
  it.each([
    ["सौ", 100], ["एक सौ", 100], ["दो सौ", 200], ["डेढ़ सौ", 150], ["ढाई सौ", 250], ["सवा सौ", 125], ["पौने दो सौ", 175], ["साढ़े तीन सौ", 350],
    ["साढ़े चार सौ", 450], ["पौने तीन सौ", 275], ["एक सौ दस", 110], ["एक सौ छप्पन", 156], ["दो सौ अठासी", 288], ["दो सौ अठ्यासी", 288],
    ["तीन सौ पचपन", 355], ["चार सौ निन्यानवे", 499], ["पाँच सौ", 500], ["नौ सौ निन्यानवे", 999], ["एक हज़ार", 1000], ["डेढ़ हज़ार", 1500],
  ])("%s = %i", (words, n) => {
    expect(extractSpokenNumbers(words)).toEqual([n]);
  });
  it("as a price: 'चार किलो चावल दो सौ अठासी रुपए' is a total of Rs 288", () => {
    expect(one("चार किलो चावल दो सौ अठासी रुपए")).toMatchObject({ qty: 4, unit: "kg", total: 28800, priceType: "total" });
    expect(one("चार किलो चावल डेढ़ सौ रुपए किलो")).toMatchObject({ qty: 4, rate: 15000, total: 60000, priceType: "rate" });
  });
});

describe("three quarters", () => {
  it("'पौन किलो चीनी' is 0.75 kg, and 'पौने दो' is still 1.75", () => {
    expect(one("पौन किलो चीनी")).toMatchObject({ qty: 0.75, unit: "kg" });
    expect(one("पौने दो किलो चीनी")).toMatchObject({ qty: 1.75, unit: "kg" });
  });
});

describe("Roman forms", () => {
  it.each([
    ["ikkees", 21], ["baees", 22], ["pachchees", 25], ["chhabbees", 26], ["untees", 29], ["battees", 32], ["chhattees", 36], ["adtaalees", 48],
    ["pachpan", 55], ["chhappan", 56], ["athasi", 88], ["chhiyanbe", 96], ["ninyanve", 99], ["nabbe", 90],
  ])("2 kilo chini %s rupay kilo", (word, n) => {
    expect(one(`2 kilo chini ${word} rupay kilo`)).toMatchObject({ qty: 2, rate: n * 100, total: n * 200 });
  });
});
