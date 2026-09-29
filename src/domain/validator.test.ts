import { describe, expect, it } from "vitest";
import { matchProduct, inferRateBasis } from "./validator";
import { settleLayer2Items } from "./layer2";
import type { ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { buildCatalogIndex, lookupCandidates, prepareParserCatalog } from "./catalogIndex";
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
    const result = matchProduct("chawal", { index: SEED_PARSER_CATALOG.index });
    expect(result.kind).toBe("matched");
    expect(result.kind === "matched" && result.catalogId).toBe("11");
    expect(result.kind === "matched" && result.score).toBe(1);
  });

  it("empty text never matches", () => {
    expect(matchProduct("", { index: SEED_PARSER_CATALOG.index }).kind).toBe("none");
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
    const result = matchProduct("moong daal", { index: SEED_PARSER_CATALOG.index });
    expect(result.kind).toBe("matched");
    expect(result.kind === "matched" && result.catalogId).toBe("18");
  });
});

describe("matchProduct - KI-20 duplicate handling (never silently pick array order)", () => {
  // KB-317 (owner) ended the 'sabun' tie: a bare sabun is the generic Sabun
  // (614). 'bath soap' is still an exact alias of both 160 and 614 (KI-53).
  it("'bath soap' is a real, exact tie between id 160 and id 614 - reported ambiguous, not resolved", () => {
    const result = matchProduct("bath soap", { index: SEED_PARSER_CATALOG.index });
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

// KB-302 (owner, Q5; D36; closes KI-34): a Layer 2 (Gemini) line is a
// proposal. Its money is re-derived here from the SHOP catalog and the
// spoken numbers - Gemini's own total and default price are never trusted.
describe("settleLayer2Items", () => {
  const gemini = (over: Partial<ParsedItem>): ParsedItem => ({
    spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched",
    qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "default", ...over,
  });
  const settle = (items: ParsedItem[]) => settleLayer2Items(items, SEED_PARSER_CATALOG);

  it("KI-34: Gemini's '500 gram chini' (rate 4500 labelled per gm, total ₹22,500) settles to ₹45/kg, ₹22.50", () => {
    const { lines } = settle([gemini({ qty: 500, unit: "gm", rate: 4500, rateUnit: "gm", total: 2250000 })]);
    expect(lines[0]!.item).toMatchObject({ qty: 500, unit: "gm", rate: 4500, rateUnit: "kg", total: 2250, priceType: "default" });
  });

  it("default: the rate is the SHOP's price, whatever Gemini echoed", () => {
    const shop = prepareParserCatalog([{ ...SEED_PARSER_CATALOG.byId.get("27")!, id: "p-chini", suggestedPricePaise: 5200 }]);
    const { lines } = settleLayer2Items([gemini({ catalogId: "p-chini", rate: 4500, total: 9000 })], shop);
    expect(lines[0]!.item).toMatchObject({ rate: 5200, rateUnit: "kg", total: 10400 });
  });

  it("(b) a matched line displays the shop entry's name, keeps what was spoken", () => {
    const { lines } = settle([gemini({})]);
    expect(lines[0]!.displayName).toBe("Chini");
    expect(lines[0]!.item.spokenName).toBe("चीनी");
  });

  it("(a) a catalogId not in the SHOP catalog -> custom/unknown, never priced", () => {
    const { lines } = settle([gemini({ catalogId: "not-in-this-shop" })]);
    expect(lines[0]!.item).toMatchObject({ catalogId: null, isCustom: true, matchStatus: "none", rate: null, rateUnit: null, total: null, priceType: "unknown" });
    expect(lines[0]!.displayName).toBe("चीनी");
  });

  it("rate (wala): rate per the spoken unit, total recomputed - Gemini's total dropped", () => {
    const { lines } = settle([gemini({ spokenName: "parle g", catalogId: "52", qty: 3, unit: "piece", rate: 1000, rateUnit: "piece", total: 99999, priceType: "rate" })]);
    expect(lines[0]!.item).toMatchObject({ rate: 1000, rateUnit: "piece", total: 3000 });
  });

  it("total (ka / rupay): the spoken total stands, rate null", () => {
    const { lines } = settle([gemini({ rate: 4500, total: 9000, priceType: "total" })]);
    expect(lines[0]!.item).toMatchObject({ rate: null, rateUnit: null, total: 9000, priceType: "total" });
  });

  it("incompatible units on a default line -> no price invented (rate/total null)", () => {
    const { lines } = settle([gemini({ qty: 2, unit: "liter" })]);
    expect(lines[0]!.item).toMatchObject({ rate: null, rateUnit: null, total: null });
  });

  it.each([[0], [-2], [1.2345], [Number.NaN], [Number.POSITIVE_INFINITY], [1e9]])(
    "(c) qty %s is not a valid numeric(12,3) quantity -> null, and flagged invalid_qty",
    (qty) => {
      const { lines, flags } = settle([gemini({ qty, priceType: "total" })]);
      expect(lines[0]!.item.qty).toBeNull();
      expect(flags).toEqual([expect.objectContaining({ code: "invalid_qty", severity: "MEDIUM", itemIndex: 0 })]);
    },
  );

  it("a valid 3-decimal qty is kept (250.5 gm, 0.125 kg)", () => {
    const { lines, flags } = settle([gemini({ qty: 0.125 }), gemini({ qty: 250.5, unit: "gm" })]);
    expect(lines.map((l) => l.item.qty)).toEqual([0.125, 250.5]);
    expect(flags).toEqual([]);
  });

  it("money that isn't whole paise (hard rule 1) is dropped, not rounded", () => {
    const { lines } = settle([gemini({ total: 90.5, priceType: "total" })]);
    expect(lines[0]!.item.total).toBeNull();
  });
});
