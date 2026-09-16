import { describe, expect, it } from "vitest";
import { buildVocabularyPrompt, type UsageSignal } from "./vocabulary";
import { catalog as realCatalog, type CatalogEntry } from "./catalog";

function entry(id: string, displayName: string): CatalogEntry {
  return {
    id,
    displayName,
    sourceCategory: "TEST",
    guardCategory: "other",
    unit: "piece",
    suggestedPricePaise: 1000,
    aliases: [displayName],
    isActive: true,
  };
}

describe("buildVocabularyPrompt - ranking", () => {
  it("1. higher recentFrequency ranks above lower, regardless of useCount", () => {
    const catalog = [entry("A", "Low Frequency High Use"), entry("B", "High Frequency Low Use")];
    const usage: Record<string, UsageSignal> = {
      A: { recentFrequency: 1, useCount: 100 },
      B: { recentFrequency: 10, useCount: 1 },
    };
    const result = buildVocabularyPrompt(catalog, usage);
    expect(result.names).toEqual(["High Frequency Low Use", "Low Frequency High Use"]);
  });

  it("2. equal (or absent) recentFrequency - higher useCount ranks higher", () => {
    const catalog = [entry("A", "Low Use"), entry("B", "High Use")];
    const usage: Record<string, UsageSignal> = {
      A: { useCount: 2 },
      B: { useCount: 9 },
    };
    const result = buildVocabularyPrompt(catalog, usage);
    expect(result.names).toEqual(["High Use", "Low Use"]);
  });

  it("3. brand-like name wins a tie when frequency and useCount are both equal", () => {
    // "Plain" has no space and no Latin letters - not brand-like.
    // "Brand Name" is multi-word - brand-like.
    const catalog = [entry("A", "साधारण"), entry("B", "Brand Name")];
    const usage: Record<string, UsageSignal> = {
      A: { recentFrequency: 5, useCount: 5 },
      B: { recentFrequency: 5, useCount: 5 },
    };
    const result = buildVocabularyPrompt(catalog, usage);
    expect(result.names).toEqual(["Brand Name", "साधारण"]);
  });

  it("8. output is deterministic - identical input produces identical output across repeated calls", () => {
    const catalog = [entry("A", "Zeta"), entry("B", "Alpha"), entry("C", "Mid")];
    const usage: Record<string, UsageSignal> = {
      A: { recentFrequency: 3 },
      B: { recentFrequency: 3 },
      C: { recentFrequency: 1 },
    };
    const first = buildVocabularyPrompt(catalog, usage);
    const second = buildVocabularyPrompt(catalog, usage);
    expect(second).toEqual(first);
    // A and B are tied on every ranking key (same frequency, same useCount
    // of 0, neither is brand-like) - the final alphabetical tiebreak is
    // what makes this deterministic rather than accidentally stable.
    expect(first.names).toEqual(["Alpha", "Zeta", "Mid"]);
  });
});

describe("buildVocabularyPrompt - the two caps", () => {
  it("4. caps at 40 names even when more products have real signal", () => {
    const catalog = Array.from({ length: 60 }, (_, i) => entry(`P${i}`, `Product${String(i).padStart(2, "0")}`));
    const usage: Record<string, UsageSignal> = {};
    for (let i = 0; i < 60; i++) usage[`P${i}`] = { recentFrequency: 60 - i }; // all distinct, all ranked
    const result = buildVocabularyPrompt(catalog, usage);
    expect(result.names).toHaveLength(40);
    expect(result.names[0]).toBe("Product00"); // highest frequency
    expect(result.names[39]).toBe("Product39"); // 40th-ranked, cut off before Product40
  });

  it("5. caps at 600 characters, binding before the 40-name limit when names are long", () => {
    // 20 names of 35 chars each, joined with ", " (2 chars) = 20*35 + 19*2 = 738 chars - over the 600 cap well before 40 names.
    const longName = (i: number) => `Very Long Brand Name Number ${String(i).padStart(2, "0")}`; // 33-34 chars
    const catalog = Array.from({ length: 20 }, (_, i) => entry(`L${i}`, longName(i)));
    const usage: Record<string, UsageSignal> = {};
    for (let i = 0; i < 20; i++) usage[`L${i}`] = { recentFrequency: 20 - i };

    const result = buildVocabularyPrompt(catalog, usage);
    expect(result.names.length).toBeLessThan(20); // the cap bound before all 20 fit
    expect(result.prompt.length).toBeLessThanOrEqual(600);
    expect(result.prompt).toBe(result.names.join(", "));
  });
});

describe("buildVocabularyPrompt - zero-signal exclusion and empty input", () => {
  it("6. a product with no recentFrequency and no useCount is excluded entirely, not just ranked last", () => {
    const catalog = [entry("A", "Has Signal"), entry("B", "No Signal At All")];
    const usage: Record<string, UsageSignal> = { A: { recentFrequency: 1 } };
    const result = buildVocabularyPrompt(catalog, usage);
    expect(result.names).toEqual(["Has Signal"]);
    expect(result.names).not.toContain("No Signal At All");
  });

  it("7. a brand-new shop with NO bill history and nothing learned yet returns an EMPTY vocabulary - not a fallback to generic catalog names, genuinely empty. This is the intended behavior (docs/08-LEARNING-ENGINE.md section 7: bias toward THIS shop's real items), not a bug to fix in a later phase.", () => {
    const result = buildVocabularyPrompt(realCatalog, {});
    expect(result.names).toEqual([]);
    expect(result.prompt).toBe("");
  });

  it("empty catalog with no usage data also produces an empty result, no crash", () => {
    const result = buildVocabularyPrompt([], {});
    expect(result).toEqual({ names: [], prompt: "" });
  });
});

describe("buildVocabularyPrompt - integration against the real catalog", () => {
  it("ranks real, verified catalog products correctly by supplied signal", () => {
    // id 11 = Chawal, id 4 = Besan, id 27 = Chini (all verified in KB-005/KB-005b).
    const usage: Record<string, UsageSignal> = {
      "11": { recentFrequency: 20 },
      "4": { recentFrequency: 5 },
      "27": { useCount: 3 },
    };
    const result = buildVocabularyPrompt(realCatalog, usage);
    expect(result.names[0]).toBe("Chawal");
    expect(result.names).toContain("Besan");
    expect(result.names).toContain("Chini");
    expect(result.names.indexOf("Chawal")).toBeLessThan(result.names.indexOf("Besan"));
  });
});
