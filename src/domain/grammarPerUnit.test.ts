import { describe, expect, it } from "vitest";
import { diagnoseUtterance, parseUtterance, type ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-358-0 (owner, 28 Oct 2026, a silent wrong number in production): "10 किलो गेहूं 34 रुपए किलो" was read as a TOTAL of
// Rs 34 - the trailing "किलो" was dropped. "N rupay <unit>" after an item is a RATE per that unit: the same unit as the
// quantity -> rate, total = qty x rate; a different unit (grams quantity, per-kilo price) bails. "N ka" / "N rupay" with
// NO unit after stay TOTALS (D47). Every phrasing a Nagpur shopkeeper uses.

const parse = (t: string): ParsedItem[] | null => parseUtterance(t, SEED_PARSER_CATALOG);
const one = (t: string): ParsedItem => {
  const items = parse(t);
  expect(items, `"${t}" bailed`).not.toBeNull();
  expect(items).toHaveLength(1);
  return items![0]!;
};

// [phrase for a rate of 56, the unit it is per]
const KG = ["56 रुपए किलो", "56 रुपये किलो", "56 रुपई किलो", "56 रुपए का किलो", "56 रुपए प्रति किलो", "56 का किलो", "56 rupay kilo", "56 per kilo", "₹56 किलो", "56 rupai kilo", "56 rupay per kilo", "56 rs kilo", "56 रु किलो"];

describe("a per-kilo rate: every phrasing, qty x rate", () => {
  for (const phrase of KG) {
    it(`"2 किलो चीनी ${phrase}" -> 2 kg at Rs 56/kg = Rs 112`, () => {
      const item = one(`2 किलो चीनी ${phrase}`);
      expect(item).toMatchObject({ qty: 2, unit: "kg", rate: 5600, rateUnit: "kg", total: 11200, priceType: "rate" });
    });
  }
  it("the owner's case: 10 किलो गेहूं 34 रुपए किलो -> Rs 340, never Rs 34", () => {
    expect(one("10 किलो गेहु 34 रुपए किलो")).toMatchObject({ qty: 10, unit: "kg", rate: 3400, total: 34000, priceType: "rate" });
  });
  it("the rate may come before the name and the quantity after it (Roman too)", () => {
    expect(one("10 kilo gehu 34 rupay kilo")).toMatchObject({ qty: 10, rate: 3400, total: 34000, priceType: "rate" });
    expect(one("1 kg मुंग दाल 96 रुपई किलो")).toMatchObject({ qty: 1, unit: "kg", rate: 9600, total: 9600, priceType: "rate" });
  });
  it("a fractional quantity: 2.5 kg at Rs 40/kg = Rs 100", () => {
    expect(one("2.5 kilo chini 40 rupay kilo")).toMatchObject({ qty: 2.5, rate: 4000, total: 10000 });
  });
});

describe("the same for gram, liter, packet and piece", () => {
  const cases: [string, number, string, number, number][] = [
    // utterance, qty, unit, rate paise, total paise
    ["500 gram jeera 2 rupay gram", 500, "gm", 200, 100000],
    ["500 ग्राम जीरा 2 रुपए ग्राम", 500, "gm", 200, 100000],
    ["500 gram jeera 2 rupay per gram", 500, "gm", 200, 100000],
    ["2 liter doodh 60 rupay liter", 2, "liter", 6000, 12000],
    ["2 लीटर दूध 60 रुपए लीटर", 2, "liter", 6000, 12000],
    ["2 लीटर दूध 60 रुपए प्रति लीटर", 2, "liter", 6000, 12000],
    ["3 packet biscuit 10 rupay packet", 3, "packet", 1000, 3000],
    ["3 पैकेट बिस्कुट 10 रुपए पैकेट", 3, "packet", 1000, 3000],
    ["3 पैकेट बिस्कुट 10 का पैकेट", 3, "packet", 1000, 3000],
    ["6 piece nimbu 5 rupay piece", 6, "piece", 500, 3000],
    ["6 नग नींबू 5 रुपए नग", 6, "piece", 500, 3000],
    ["6 piece nimbu 5 per piece", 6, "piece", 500, 3000],
  ];
  for (const [text, qty, unit, rate, total] of cases) {
    it(`"${text}" -> ${qty} ${unit} at ${rate} = ${total}`, () => {
      expect(one(text)).toMatchObject({ qty, unit, rate, rateUnit: unit, total, priceType: "rate" });
    });
  }
});

describe("what stays a TOTAL (D47: a bare 'ka' / 'rupay' with no unit after it)", () => {
  it('"chawal 100 ka" and "100 का चावल" are totals with no quantity', () => {
    expect(one("chawal 100 ka")).toMatchObject({ qty: null, total: 10000, rate: null, priceType: "total" });
    expect(one("100 का चावल")).toMatchObject({ qty: null, total: 10000, rate: null, priceType: "total" });
  });
  it('"N kilo X Y rupay" (no unit after) is a total', () => {
    expect(one("2 kilo chawal 90 rupay")).toMatchObject({ qty: 2, unit: "kg", total: 9000, rate: null, priceType: "total" });
    expect(one("2 किलो चीनी 56 रुपए")).toMatchObject({ qty: 2, unit: "kg", total: 5600, rate: null, priceType: "total" });
    expect(one("5 किलो चावल 200 का")).toMatchObject({ qty: 5, total: 20000, rate: null, priceType: "total" });
  });
});

describe("what bails (to Layer 2 / by hand) rather than guess", () => {
  const bails = [
    "500 gram jeera 56 rupay kilo", // grams quantity, per-kilo price: a different unit
    "500 ग्राम जीरा 60 रुपए किलो",
    "2 लीटर दूध 60 रुपए किलो", // liters against kilos
    "2 चीनी 56 रुपए किलो", // a bare count against a per-kilo price
    "56 रुपए किलो चीनी", // a rate with no quantity at all
    "2 kilo chini 56 wala 56 rupay kilo", // two rates
    "2 kilo chini 56 rupay kilo 100 ka", // a rate and a total
    "2 kilo 3 kilo chini 56 rupay kilo", // two quantities
  ];
  for (const t of bails) {
    it(`"${t}" -> null, and the diagnosis agrees`, () => {
      expect(parse(t)).toBeNull();
      expect(diagnoseUtterance(t, SEED_PARSER_CATALOG).hit).toBe(false);
    });
  }
});

describe("diagnoseUtterance stays the exact twin of parseUtterance", () => {
  const all = [...KG.map((p) => `2 किलो चीनी ${p}`), "10 किलो गेहु 34 रुपए किलो", "chawal 100 ka", "2 kilo chawal 90 rupay", "500 gram jeera 56 rupay kilo"];
  for (const t of all) {
    it(`"${t}"`, () => {
      expect(diagnoseUtterance(t, SEED_PARSER_CATALOG).hit).toBe(parse(t) !== null);
    });
  }
});
