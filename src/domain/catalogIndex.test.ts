import { describe, expect, it } from "vitest";
import { buildCatalogIndex, lookupCandidates, phoneticNormalize } from "./catalogIndex";

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
  const index = buildCatalogIndex();

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
