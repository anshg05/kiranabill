import { describe, expect, it } from "vitest";
import { CANONICAL_DEVANAGARI } from "../domain/numberWords";
import goldCases from "../../eval/layer2-cases.json";
import { PRICING_GRAMMAR_PROMPT, PRICING_GRAMMAR_PROMPT_V1 } from "./pricingGrammarPrompt";

// KB-360 (owner, 29 Oct 2026): measured on 30 cases x 3 runs (eval/layer2-models.ts) - every model INVENTS a number for a price it cannot
// read ("चैन रुपए किलो" -> Rs 4, 60, 100). A rule "never guess an unreadable price" with three held-out examples cut that to 0 on the chosen
// model, and the Hindi 1-100 list gave the best result of the variants. The first part of the prompt is byte-for-byte what it was.

describe("the shipped prompt", () => {
  it("still starts with the original prompt, unchanged", () => {
    expect(PRICING_GRAMMAR_PROMPT.startsWith(PRICING_GRAMMAR_PROMPT_V1)).toBe(true);
    for (const rule of ["RULE 1", "RULE 2", "RULE 3", "RULE 4", "RULE 5a", "RULE 5b"]) expect(PRICING_GRAMMAR_PROMPT).toContain(rule);
  });
  it("carries the unreadable-price rule and its three held-out examples", () => {
    expect(PRICING_GRAMMAR_PROMPT).toContain("RULE 6");
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/do NOT guess a number and\s+do NOT use the catalog price/);
    expect(PRICING_GRAMMAR_PROMPT).toContain('"do kilo aata chaubay rupay kilo"');
    expect(PRICING_GRAMMAR_PROMPT).toContain('"teen kilo chawal pachh rupay"');
    expect(PRICING_GRAMMAR_PROMPT).toContain("priceType:\"unknown\"");
  });
  it("the examples are NOT the gold-set cases (they would measure nothing)", () => {
    const added = PRICING_GRAMMAR_PROMPT.slice(PRICING_GRAMMAR_PROMPT_V1.length);
    for (const c of goldCases) expect(added, c.id).not.toContain(c.transcript);
  });
  it("lists every Hindi number word 1-100 with its value", () => {
    for (const [i, w] of CANONICAL_DEVANAGARI.entries()) expect(PRICING_GRAMMAR_PROMPT).toContain(`${w}=${i + 1}`);
  });
  it("is a sensible size (every call pays for it): under 10,000 characters", () => {
    expect(PRICING_GRAMMAR_PROMPT.length).toBeLessThan(10_000);
  });
});

describe("KB-366 (30 Oct 2026): the prompt agrees with D47 and never invents a quantity or a brand", () => {
  it("RULE 2/3 no longer says 'qty:1 of THAT CANDIDATE'S OWN unit' (D13 point 1, superseded by D47)", () => {
    expect(PRICING_GRAMMAR_PROMPT).not.toContain("use qty:1 of THAT CANDIDATE'S OWN unit");
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/total price is spoken but no quantity[\s\S]*qty:null, unit:""/);
  });
  it("two bare numbers that cannot be told apart are never guessed (G29 'चीनी 30 40' showed Gemini pricing it Rs 40 once in two runs)", () => {
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/TWO bare numbers[\s\S]*do NOT guess/);
    expect(PRICING_GRAMMAR_PROMPT).toContain('"aata 20 70"');
  });
  it("RULE 7: never invent a quantity; a price per kilo with no quantity is 1 kg (the owner's ruling)", () => {
    expect(PRICING_GRAMMAR_PROMPT).toContain("RULE 7");
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/never invent a quantity/i);
    expect(PRICING_GRAMMAR_PROMPT).toContain('"phutane 110 rupay kilo"');
    // the exception must not turn a garbled price into a guess (G13 priced "चैन रुपए किलो" at Rs 100 in 2 of 2 runs without this sentence)
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/needs a price you can actually\s+read[\s\S]*RULE 6 wins/);
  });
  it("RULE 7 also: for a product NOT among the candidates a bare number beside a 'wala' price is not assumed to be a quantity (A42: Rs 1,800)", () => {
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/NOT among the candidates[\s\S]*not assumed to be a quantity|not assumed to be a quantity[\s\S]*NOT among the candidates/);
    expect(PRICING_GRAMMAR_PROMPT).toContain('"daant kanti 30 60 wala"');
  });
  it("RULE 8: a different brand is not the catalog product, and never takes its price", () => {
    expect(PRICING_GRAMMAR_PROMPT).toContain("RULE 8");
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/different BRAND/);
    expect(PRICING_GRAMMAR_PROMPT).toMatch(/catalogId:null/);
  });
  it("the new examples are not the gold-set cases", () => {
    const added = PRICING_GRAMMAR_PROMPT.slice(PRICING_GRAMMAR_PROMPT_V1.length);
    for (const c of goldCases) expect(added, c.id).not.toContain(c.transcript);
  });
});
