import { describe, expect, it } from "vitest";
import { diagnoseUtterance, extractSpokenNumbers, parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-365 / KB-366 (owner, 30 Oct 2026, after the first acceptance run on his 50 real orders): the spellings Whisper really wrote for his
// voice, and the per-kilo price cases that put a wrong number on a bill.

const read = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG)?.map((i) => [i.spokenName, i.qty, i.unit, i.rate, i.rateUnit, i.total, i.priceType]);

describe("Whisper's spellings of किलो and डेढ़ (exact spellings, no fuzzy matching)", () => {
  it.each([["कीलो"], ["किलों"], ["केलो"], ["किल"]])("'%s' after a number is kilo", (word) => {
    expect(read(`2 ${word} चीनी`)).toEqual([["चीनी", 2, "kg", 4500, "kg", 9000, "default"]]);
  });
  it("A24: '2 किलो 150 रुपे किल' is Rs 150 a KILO (Rs 300), never Rs 150 total for 2 kg", () => {
    expect(read("तूवर दाल 2 किलो 150 रुपे किल")).toEqual([["तूवर दाल", 2, "kg", 15000, "kg", 30000, "rate"]]);
  });
  it("A37: 'देड किलो' is 1.5 kg, and the number checks read it as 1.5", () => {
    expect(read("देड किलो मैदा 44 रुपए किलो")).toEqual([["मैदा", 1.5, "kg", 4400, "kg", 6600, "rate"]]);
    expect(extractSpokenNumbers("देड किलो मैदा")).toEqual([1.5]);
  });
});

describe("a per-kilo (per-litre) price against a GRAM (ml) quantity is converted EXACTLY, never multiplied as it stands", () => {
  it("A38: 500 g at Rs 56 a kilo = Rs 28 (it billed Rs 28,000)", () => {
    expect(read("500 ग्राम शक्कर 56 रुपए किलो")).toEqual([["शक्कर", 500, "gm", 5600, "kg", 2800, "rate"]]);
    expect(read("500 ग्राम मुंग दाल 96 रुपए किलो")).toEqual([["मुंग दाल", 500, "gm", 9600, "kg", 4800, "rate"]]);
  });
  it("250 ml at Rs 120 a litre = Rs 30", () => {
    expect(read("250 ml तेल 120 रुपए लीटर")).toEqual([["तेल", 250, "ml", 12000, "liter", 3000, "rate"]]);
  });
  it("the other direction (a kilo against a per-gram price) is still not guessed", () => {
    expect(read("2 किलो चीनी 5 रुपए ग्राम")).toBeUndefined();
  });
  it("the diagnosis agrees with the reader", () => {
    expect(diagnoseUtterance("500 ग्राम शक्कर 56 रुपए किलो", SEED_PARSER_CATALOG).hit).toBe(true);
    expect(diagnoseUtterance("2 किलो चीनी 5 रुपए ग्राम", SEED_PARSER_CATALOG).hit).toBe(false);
  });
});

describe("the owner's ruling: a per-kilo price with NO quantity means 1 kg (A28, A33, A47)", () => {
  it("'मूंग मोगर 110 रुपए किलो' = 1 kg at Rs 110", () => {
    expect(read("मूंग मोगर 110 रुपए किलो")).toEqual([["मूंग मोगर", 1, "kg", 11000, "kg", 11000, "rate"]]);
  });
  it("a litre price likewise", () => {
    expect(read("तेल 150 रुपए लीटर")).toEqual([["तेल", 1, "liter", 15000, "liter", 15000, "rate"]]);
  });
  it("a TOTAL with no quantity stays no quantity (D47): 'चावल 90 रुपए'", () => {
    expect(read("चावल 90 रुपए")).toEqual([["चावल", null, "", null, null, 9000, "total"]]);
  });
  it("the diagnosis agrees", () => {
    expect(diagnoseUtterance("मूंग मोगर 110 रुपए किलो", SEED_PARSER_CATALOG).hit).toBe(true);
  });
});
