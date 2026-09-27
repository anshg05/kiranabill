import { describe, expect, it } from "vitest";
import { buildCatalogIndex, buildCatalogSlice, lookupCandidates, phoneticNormalize } from "./catalogIndex";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { catalog } from "./catalog";

describe("phoneticNormalize", () => {
  it("ph -> f", () => {
    expect(phoneticNormalize("Phortune")).toBe("fortune");
  });

  it("w -> v", () => {
    expect(phoneticNormalize("Wim")).toBe("vim");
  });

  it("both rules together", () => {
    expect(phoneticNormalize("Phawan")).toBe("favan");
  });
});

describe("lookupCandidates - exact and phonetic matches", () => {
  const index = buildCatalogIndex(catalog);

  it("an exact alias scores 1.0", () => {
    const candidates = lookupCandidates(index, "chawal");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.score).toBe(1);
    expect(candidates[0]!.catalogId).toBe("11");
  });

  it("phonetic variant 'wim' still reaches Vim (id 195) - docs/14-LEGACY-REFERENCE.md section 6", () => {
    const candidates = lookupCandidates(index, "wim");
    const vim = candidates.find((c) => c.catalogId === "195");
    expect(vim).toBeDefined();
    expect(vim!.score).toBe(1); // "wim" normalizes to "vim", an exact match
  });

  it("an unrelated query returns low- or no-scoring candidates for a real product", () => {
    const candidates = lookupCandidates(index, "xyzzy nonsense product");
    const chawal = candidates.find((c) => c.catalogId === "11");
    expect(chawal === undefined || chawal.score < 0.5).toBe(true);
  });

  it("candidates are ranked best-first", () => {
    const candidates = lookupCandidates(index, "chini");
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.score).toBeLessThanOrEqual(candidates[i - 1]!.score);
    }
  });
});

// KB-302: the Layer 2 catalog slice (docs/04-VOICE-PIPELINE.md section 4 -
// top ~30 relevant products, from the SHOP's catalog).
describe("buildCatalogSlice", () => {
  it("every product spoken in a multi-item transcript is in the slice; at most 30", () => {
    const slice = buildCatalogSlice(SEED_PARSER_CATALOG, "do kilo chini, teen parle g das wala aur ek kilo besan");
    const ids = slice.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["27", "52", "4"])); // Chini, Parle-G 10, Besan
    expect(slice.length).toBeLessThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("a long transcript is still capped at the limit", () => {
    const words = SEED_PARSER_CATALOG.entries.slice(0, 80).map((e) => e.displayName).join(" aur ");
    expect(buildCatalogSlice(SEED_PARSER_CATALOG, words)).toHaveLength(30);
    expect(buildCatalogSlice(SEED_PARSER_CATALOG, words, 5)).toHaveLength(5);
  });

  it("nothing recognisable -> an empty slice (Gemini still returns unknown lines)", () => {
    expect(buildCatalogSlice(SEED_PARSER_CATALOG, "   ")).toEqual([]);
  });
});
