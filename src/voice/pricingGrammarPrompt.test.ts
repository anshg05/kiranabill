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
