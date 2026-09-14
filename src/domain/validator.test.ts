import { describe, expect, it } from "vitest";
import { matchProduct, inferRateBasis } from "./validator";
import { buildCatalogIndex, lookupCandidates } from "./catalogIndex";
import { getCatalogEntryById, type CatalogEntry } from "./catalog";

function syntheticEntry(id: string, name: string, guardCategory: CatalogEntry["guardCategory"]): CatalogEntry {
  return {
    id,
    displayName: name,
    sourceCategory: "TEST",
    guardCategory,
    unit: "piece",
    suggestedPricePaise: 1000,
    aliases: [name],
    isActive: true,
  };
}

describe("matchProduct - real catalog", () => {
  it("an exact alias matches with score 1", () => {
    const result = matchProduct("chawal");
    expect(result.kind).toBe("matched");
    expect(result.kind === "matched" && result.catalogId).toBe("11");
    expect(result.kind === "matched" && result.score).toBe(1);
  });

  it("empty text never matches", () => {
    expect(matchProduct("").kind).toBe("none");
  });
});

describe("matchProduct - length-scaled threshold (docs/14-LEGACY-REFERENCE.md section 6)", () => {
  it("a short word below the strict 4-char threshold is rejected, not guessed", () => {
    const index = buildCatalogIndex([syntheticEntry("S", "soap", "soap")]);
    // "soup" vs "soap" scores 0.4 - nowhere near the ~0.98 a <=4-char word needs
    const result = matchProduct("soup", { index });
    expect(result.kind).toBe("none");
  });
});

describe("matchProduct - category guard (a dal never matches a soap)", () => {
  it("rejects an otherwise-perfect match when the spoken phrase's inferred category conflicts with the candidate's guardCategory", () => {
    // "Dal Soap" is a contrived name that scores a perfect 1.0 against the
    // identical query - proving the rejection comes from the guard, not
    // the threshold.
    const index = buildCatalogIndex([syntheticEntry("X", "Dal Soap", "soap")]);
    const unguarded = lookupCandidates(index, "dal soap");
    expect(unguarded[0]!.score).toBe(1); // sanity check: would pass on score alone

    const result = matchProduct("dal soap", { index });
    expect(result.kind).toBe("none"); // "dal" infers category dal; candidate is guarded "soap" - rejected
  });

  it("does not reject a real match whose category already agrees - moong daal", () => {
    const result = matchProduct("moong daal");
    expect(result.kind).toBe("matched");
    expect(result.kind === "matched" && result.catalogId).toBe("18");
  });
});

describe("matchProduct - KI-20 duplicate handling (never silently pick array order)", () => {
  it("'sabun' is a real, exact tie between id 160 and id 614 - reported ambiguous, not resolved", () => {
    const result = matchProduct("sabun");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidateIds).toContain("160");
      expect(result.candidateIds).toContain("614");
    }
  });
});

describe("matchProduct - learned-use boost (inert hook for KB-008, formula from legacy/validator.js line 290)", () => {
  it("a recorded use count raises the reported score, capped at +0.08", () => {
    // A single, imperfectly-matching candidate - no competition, so it
    // always wins regardless of boost. Isolates the boost's effect on the
    // reported score itself, rather than on which candidate wins.
    const index = buildCatalogIndex([syntheticEntry("B", "sunflower oil bottld", "oil")]);
    const baseScore = lookupCandidates(index, "sunflower oil bottle")[0]!.score;

    const unboosted = matchProduct("sunflower oil bottle", { index });
    expect(unboosted.kind).toBe("matched");
    expect(unboosted.kind === "matched" && unboosted.score).toBe(baseScore);

    const boosted = matchProduct("sunflower oil bottle", { index, useCountById: { B: 100 } }); // far past the cap
    expect(boosted.kind).toBe("matched");
    expect(boosted.kind === "matched" && boosted.score).toBeCloseTo(Math.min(baseScore + 0.08, 1), 10);
    expect(boosted.kind === "matched" && boosted.score).toBeGreaterThan(baseScore);

    // 6 uses -> under the cap (0.06 < 0.08) - the formula, not just the cap.
    const partiallyBoosted = matchProduct("sunflower oil bottle", { index, useCountById: { B: 6 } });
    expect(partiallyBoosted.kind === "matched" && partiallyBoosted.score).toBeCloseTo(baseScore + 0.06, 10);
  });
});

describe("inferRateBasis (docs/14-LEGACY-REFERENCE.md section 8 - the subtle rate-basis rule, KB-005b's job)", () => {
  it("infers a per-kg rate when a gm-spoken rate is implausibly large - '500 gram, 60 rupay wala'", () => {
    const besan = getCatalogEntryById("4")!; // Besan, kg, 9000 paise/kg -> 9 paise/gm
    expect(besan.unit).toBe("kg");
    const inferred = inferRateBasis(besan, "gm", 6000); // spoken as if 6000 paise/gm - absurd
    expect(inferred).toBe(6); // they meant 6000 paise/kg = 6 paise/gm
  });

  it("leaves a plausible gm rate unchanged", () => {
    const besan = getCatalogEntryById("4")!;
    const inferred = inferRateBasis(besan, "gm", 9); // already a sane per-gm rate
    expect(inferred).toBe(9);
  });

  it("does nothing when units already agree", () => {
    const besan = getCatalogEntryById("4")!;
    const inferred = inferRateBasis(besan, "kg", 9000);
    expect(inferred).toBe(9000);
  });
});
