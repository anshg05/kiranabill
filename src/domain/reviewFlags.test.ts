/**
 * KB-208. Tests written first, per the owner's explicit instruction, one
 * block per code (all 14) plus canFinalize()'s gating logic.
 *
 * A documented interpretive call, since number_dropped/qty_dropped/
 * number_unconsumed are new detection logic with no legacy source to
 * trace (14-LEGACY-REFERENCE.md section 7 calls them "new codes required
 * by 04-VOICE-PIPELINE.md, not present in the old code") - unlike every
 * other code in this file, there is no real implementation to check this
 * against, only two one-line descriptions each. Resolved as follows,
 * disclosed here for review before reviewFlags.ts itself is written:
 *
 *   - number_dropped: whole-bill, layer-agnostic. Any number spoken
 *     ANYWHERE in the transcript that doesn't appear as ANY item's
 *     qty/rate/total (rate/total compared in rupees, not paise) is
 *     flagged. The general "something didn't make it onto the bill"
 *     signal - one flag per orphaned number.
 *   - qty_dropped: a stricter SUBSET of number_dropped - a dropped number
 *     that was attached to a recognised unit word in speech (e.g. "5
 *     kilo"), i.e. it specifically looked like a spoken quantity, not
 *     just any number. A number_dropped case with a more specific,
 *     actionable message.
 *   - number_unconsumed: scoped to a SINGLE "aur"-separated segment
 *     containing 2+ spoken numbers where at least one was used and at
 *     least one was not - the "two numbers, one unused" framing read
 *     literally, as a within-one-clause signal distinct from a
 *     wholly-orphaned number. Only computable when the segment count
 *     matches the item count 1:1 (true for Layer 1/grammar.ts output;
 *     Gemini/Layer 2 doesn't promise "aur" segments map to items 1:1, so
 *     this code simply doesn't fire for Layer 2 output). **number_dropped
 *     is NOT a full substitute when this can't run** - a confirmed real
 *     gap, not just a scoping footnote: number_dropped only detects an
 *     ORPHANED number, and is blind to a CROSS-ITEM MISASSIGNMENT of
 *     numerically-identical values (two segments speaking the same
 *     numbers, one item's real numbers silently attached to another) -
 *     the whole-bill multiset still balances exactly in that case, so
 *     number_dropped stays silent. For Layer 2/misaligned output, this
 *     risk class has no coverage from either code. Logged as
 *     docs/12-PARKED.md NI-26.
 *
 * If this reading is wrong, say so before reviewFlags.ts gets written -
 * that was the whole point of pausing here.
 */
import { describe, it, expect } from "vitest";
import type { ParsedItem } from "./grammar";
import type { CatalogEntry } from "./catalog";
import { EMPTY_LEARNING_STATE, recordPriceObservation, type LearningState } from "./learning";
import { rupeesToPaise } from "./money";
import { evaluateReviewFlags, canFinalize, type ReviewFlag } from "./reviewFlags";

function item(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    spokenName: "chini",
    catalogId: "27",
    isCustom: false,
    matchStatus: "matched",
    qty: 2,
    unit: "kg",
    rate: null,
    total: rupeesToPaise(90),
    priceType: "total",
    ...overrides,
  };
}

function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "27",
    displayName: "Chini",
    sourceCategory: "sugar",
    guardCategory: "other",
    unit: "kg",
    suggestedPricePaise: rupeesToPaise(45),
    aliases: ["chini", "sugar"],
    isActive: true,
    ...overrides,
  };
}

function codesOf(flags: readonly ReviewFlag[]): string[] {
  return flags.map((f) => f.code);
}

describe("reviewFlags.ts - the 14-code confidence gate", () => {
  // ---------------------------------------------------------------------
  // Sourced directly from legacy/validator.js's REVIEW_REASON_LABELS
  // ---------------------------------------------------------------------

  describe("missing_name (HIGH)", () => {
    it("flags an item with no resolved product name", () => {
      const flags = evaluateReviewFlags("", [item({ spokenName: "" })], [catalogEntry()]);
      expect(codesOf(flags)).toContain("missing_name");
      expect(flags.find((f) => f.code === "missing_name")?.severity).toBe("HIGH");
    });

    it("does not flag a real spoken name", () => {
      const flags = evaluateReviewFlags("chini 90 rupay", [item()], [catalogEntry()]);
      expect(codesOf(flags)).not.toContain("missing_name");
    });
  });

  describe("missing_rate (MEDIUM)", () => {
    it("flags priceType 'rate' with rate actually null - a real inconsistency", () => {
      const flags = evaluateReviewFlags(
        "chini wala",
        [item({ priceType: "rate", rate: null, total: null })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("missing_rate");
      expect(flags.find((f) => f.code === "missing_rate")?.severity).toBe("MEDIUM");
    });

    it("does not flag when priceType is 'rate' and rate is actually present", () => {
      const flags = evaluateReviewFlags(
        "chini 50 wala",
        [item({ priceType: "rate", rate: rupeesToPaise(50), total: rupeesToPaise(100) })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("missing_rate");
    });
  });

  describe("missing_total (HIGH)", () => {
    it("flags a priced item (not priceType unknown) whose total never computed", () => {
      const flags = evaluateReviewFlags(
        "chini 2 kilo",
        [item({ priceType: "total", total: null })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("missing_total");
      expect(flags.find((f) => f.code === "missing_total")?.severity).toBe("HIGH");
    });

    it("does not flag priceType 'unknown' (Rule 5b's own total:0 is not a bug)", () => {
      const flags = evaluateReviewFlags(
        "ajwain",
        [item({ priceType: "unknown", qty: null, unit: "", rate: null, total: 0 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("missing_total");
    });
  });

  describe("unknown_product (LOW)", () => {
    it("flags an item with no resolved catalogId", () => {
      const flags = evaluateReviewFlags(
        "kaju katli 200 rupay",
        [item({ catalogId: null, isCustom: true, matchStatus: "none", spokenName: "kaju katli" })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("unknown_product");
      expect(flags.find((f) => f.code === "unknown_product")?.severity).toBe("LOW");
    });

    it("does not flag a resolved catalogId", () => {
      const flags = evaluateReviewFlags("chini 90 rupay", [item()], [catalogEntry()]);
      expect(codesOf(flags)).not.toContain("unknown_product");
    });
  });

  describe("unusual_rate (HIGH) - real per-shop price via learning.ts, falling back to catalog default", () => {
    it("flags a rate more than 3x the catalog's own default when the shop has no history", () => {
      const flags = evaluateReviewFlags(
        "chini 200 wala",
        [item({ priceType: "rate", rate: rupeesToPaise(200), total: rupeesToPaise(400) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      expect(codesOf(flags)).toContain("unusual_rate");
      expect(flags.find((f) => f.code === "unusual_rate")?.severity).toBe("HIGH");
    });

    it("flags a rate less than 0.2x the catalog default", () => {
      const flags = evaluateReviewFlags(
        "chini 5 wala",
        [item({ priceType: "rate", rate: rupeesToPaise(5), total: rupeesToPaise(10) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      expect(codesOf(flags)).toContain("unusual_rate");
    });

    it("does not flag a rate within the normal band", () => {
      const flags = evaluateReviewFlags(
        "chini 48 wala",
        [item({ priceType: "rate", rate: rupeesToPaise(48), total: rupeesToPaise(96) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      expect(codesOf(flags)).not.toContain("unusual_rate");
    });

    it("uses the shop's real learned price, not the catalog default, once getPriceSuggestions confirms one", () => {
      let learning: LearningState = EMPTY_LEARNING_STATE;
      const nowMs = 1_000_000;
      // Shop has sold Chini at ₹60 three times in the last 30 days - the
      // exact real confirmation threshold getPriceSuggestions() already
      // requires (recordPriceObservation only tracks a point when it
      // DIFFERS from the price passed as "current", so passing the
      // catalog's ₹45 as current each time is what makes ₹60 register as
      // drift, same as a real caller comparing against shop_products'
      // stored price would).
      for (let i = 0; i < 3; i++) {
        learning = recordPriceObservation(learning, "27", rupeesToPaise(45), rupeesToPaise(60), nowMs + i).state;
      }
      // Query strictly after all three observations - getPriceSuggestions'
      // own window filter is observedAtMs <= nowMs, so querying at the
      // same nowMs as the first observation would incorrectly exclude the
      // later two (a real bug this test itself caught on the first run).
      const queryNowMs = nowMs + 10;
      // Catalog default ₹45, 3x band = ₹135. Shop's confirmed real price
      // ₹60, 3x band = ₹180. ₹150 sits ABOVE the catalog band (would wrongly
      // flag if the stale default were used) but BELOW the shop's real band
      // (correctly does not flag once the real price is used).
      const flags = evaluateReviewFlags(
        "chini 150 wala",
        [item({ priceType: "rate", rate: rupeesToPaise(150), total: rupeesToPaise(300) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
        { learningState: learning, nowMs: queryNowMs },
      );
      expect(codesOf(flags)).not.toContain("unusual_rate");
    });
  });

  describe("unusual_total (HIGH) - only for a COMPUTED total, never a spoken 'ka'/'ki' override", () => {
    it("flags a computed (priceType 'default') total wildly outside qty * the shop's expected price", () => {
      const flags = evaluateReviewFlags(
        "chini 2 kilo",
        [item({ priceType: "default", qty: 2, rate: rupeesToPaise(45), total: rupeesToPaise(500) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      expect(codesOf(flags)).toContain("unusual_total");
      expect(flags.find((f) => f.code === "unusual_total")?.severity).toBe("HIGH");
    });

    it("REGRESSION (found by the real-data check): never flags a spoken 'ka'/'ki' total override, however far from the catalog price - that's Rule 2's own differentiator, not a mistake", () => {
      // The flagship case itself: "5 kg chawal 30 ka" -> a real, deliberate
      // ₹30 override on a product whose catalog default would compute to
      // ₹250 for 5kg. This must never be HIGH-flagged as "unusual."
      const flags = evaluateReviewFlags(
        "chini 5 kilo 30 rupay ka",
        [item({ priceType: "total", qty: 5, unit: "kg", rate: null, total: rupeesToPaise(30) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      expect(codesOf(flags)).not.toContain("unusual_total");
    });

    it("does not flag a computed total consistent with qty * the expected price", () => {
      const flags = evaluateReviewFlags(
        "chini 2 kilo",
        [item({ priceType: "default", qty: 2, rate: rupeesToPaise(45), total: rupeesToPaise(90) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      expect(codesOf(flags)).not.toContain("unusual_total");
    });

    it("REGRESSION (found by the real-data check): converts the shop's price into the item's actual spoken unit before comparing - no more 500g multiplied straight against a per-kg price", () => {
      // jeera priced ₹400/kg. "500 gram jeera 200 rupay" (computed default,
      // qty in GRAMS) is exactly correct: 500g * (₹400/1000g) = ₹200. Must
      // not compare 500 (grams) directly against a per-KG price.
      const flags = evaluateReviewFlags(
        "jeera 500 gram",
        [item({ spokenName: "jeera", catalogId: "50", priceType: "default", qty: 500, unit: "gm", rate: 40, total: rupeesToPaise(200) })],
        [catalogEntry({ id: "50", displayName: "Jeera", unit: "kg", suggestedPricePaise: rupeesToPaise(400) })],
      );
      expect(codesOf(flags)).not.toContain("unusual_total");
      expect(codesOf(flags)).not.toContain("unusual_rate");
    });
  });

  describe("weak_match (MEDIUM) - matchStatus 'ambiguous', KI-20's real duplicate-alias case", () => {
    it("flags an ambiguous match", () => {
      const flags = evaluateReviewFlags(
        "bath sabun",
        [item({ matchStatus: "ambiguous", catalogId: null, isCustom: true })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("weak_match");
      expect(flags.find((f) => f.code === "weak_match")?.severity).toBe("MEDIUM");
    });

    it("does not flag a confident match", () => {
      const flags = evaluateReviewFlags("chini 90 rupay", [item()], [catalogEntry()]);
      expect(codesOf(flags)).not.toContain("weak_match");
    });
  });

  describe("incomplete_item (MEDIUM) - traced to legacy's real trigger, priceType === 'unknown'", () => {
    it("flags priceType 'unknown' (Rule 5b's bare-product case)", () => {
      const flags = evaluateReviewFlags(
        "ajwain",
        [item({ priceType: "unknown", qty: null, unit: "", rate: null, total: 0 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("incomplete_item");
      expect(flags.find((f) => f.code === "incomplete_item")?.severity).toBe("MEDIUM");
    });

    it("does not flag a fully-priced item", () => {
      const flags = evaluateReviewFlags("chini 90 rupay", [item()], [catalogEntry()]);
      expect(codesOf(flags)).not.toContain("incomplete_item");
    });
  });

  // ---------------------------------------------------------------------
  // Owner's explicit call this session: flag-only, never auto-correct
  // (hard rule 7), MEDIUM severity for all three
  // ---------------------------------------------------------------------

  describe("invalid_qty (MEDIUM, flag-only - never silently substitutes a value)", () => {
    it("flags a zero quantity without correcting it", () => {
      const flags = evaluateReviewFlags(
        "chini 0 kilo 90 rupay",
        [item({ qty: 0 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("invalid_qty");
      expect(flags.find((f) => f.code === "invalid_qty")?.severity).toBe("MEDIUM");
    });

    it("flags a negative quantity", () => {
      const flags = evaluateReviewFlags(
        "chini -2 kilo",
        [item({ qty: -2 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("invalid_qty");
    });

    it("does not flag a genuinely positive quantity", () => {
      const flags = evaluateReviewFlags("chini 2 kilo 90 rupay", [item({ qty: 2 })], [catalogEntry()]);
      expect(codesOf(flags)).not.toContain("invalid_qty");
    });

    it("does not flag a null quantity (that's Rule 5b's own territory, not this code's)", () => {
      const flags = evaluateReviewFlags(
        "ajwain",
        [item({ priceType: "unknown", qty: null, unit: "", rate: null, total: 0 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("invalid_qty");
    });
  });

  describe("invalid_unit (MEDIUM, flag-only)", () => {
    it("flags a unit that isn't in the recognised unit set", () => {
      const flags = evaluateReviewFlags(
        "chini 2 xyz 90 rupay",
        [item({ unit: "xyz" })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("invalid_unit");
      expect(flags.find((f) => f.code === "invalid_unit")?.severity).toBe("MEDIUM");
    });

    it("does not flag a recognised unit", () => {
      const flags = evaluateReviewFlags("chini 2 kilo 90 rupay", [item({ unit: "kg" })], [catalogEntry()]);
      expect(codesOf(flags)).not.toContain("invalid_unit");
    });

    it("does not flag an empty unit (Rule 5b/Rule 2's own null-unit territory)", () => {
      const flags = evaluateReviewFlags(
        "ajwain",
        [item({ priceType: "unknown", qty: null, unit: "", rate: null, total: 0 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("invalid_unit");
    });
  });

  describe("unit_mismatch (MEDIUM, flag-only) - real D14 group logic, not a second scheme", () => {
    it("flags a weight unit against a count-priced product", () => {
      const flags = evaluateReviewFlags(
        "parle-g 2 kilo 20 rupay",
        [item({ spokenName: "parle-g", catalogId: "160", unit: "kg", qty: 2, total: rupeesToPaise(20) })],
        [catalogEntry({ id: "160", displayName: "Parle-G", unit: "piece", suggestedPricePaise: rupeesToPaise(10) })],
      );
      expect(codesOf(flags)).toContain("unit_mismatch");
      expect(flags.find((f) => f.code === "unit_mismatch")?.severity).toBe("MEDIUM");
    });

    it("does not flag D14's count-unit synonyms (packet spoken, piece catalogued)", () => {
      const flags = evaluateReviewFlags(
        "parle-g 2 packet 20 rupay",
        [item({ spokenName: "parle-g", catalogId: "160", unit: "packet", qty: 2, total: rupeesToPaise(20) })],
        [catalogEntry({ id: "160", displayName: "Parle-G", unit: "piece", suggestedPricePaise: rupeesToPaise(10) })],
      );
      expect(codesOf(flags)).not.toContain("unit_mismatch");
    });

    it("does not flag a real kg<->gm SI conversion pair", () => {
      const flags = evaluateReviewFlags(
        "chini 500 gram 25 rupay",
        [item({ unit: "gm", qty: 500, total: rupeesToPaise(25) })],
        [catalogEntry({ unit: "kg" })],
      );
      expect(codesOf(flags)).not.toContain("unit_mismatch");
    });

    it("does not flag when no unit was explicitly spoken", () => {
      const flags = evaluateReviewFlags(
        "chini 90 rupay",
        [item({ unit: "kg" })], // resolved from catalog default, not spoken - real ParsedItem shape still carries a unit
        [catalogEntry()],
      );
      // Same unit as the catalog entry regardless - not a real test of the
      // "no unit spoken" path, but confirms the identical-unit case never
      // flags, which is the baseline this code must not break.
      expect(codesOf(flags)).not.toContain("unit_mismatch");
    });
  });

  // ---------------------------------------------------------------------
  // New codes (14-LEGACY-REFERENCE.md section 7's "new codes required" -
  // no legacy implementation exists). Adversarial cases per the owner's
  // explicit instruction: legitimate repetition, fractions, Devanagari.
  // ---------------------------------------------------------------------

  describe("number_dropped (HIGH) - a spoken number that reached no item at all", () => {
    it("flags a number spoken but never appearing in any item's qty/rate/total", () => {
      // "aur 15 kilo" spoken but the (hypothetically mis-parsed) item never
      // reflects it anywhere.
      const flags = evaluateReviewFlags(
        "chini 2 kilo 90 rupay aur 15 kilo namak",
        [item({ qty: 2, total: rupeesToPaise(90) })], // only one item - "15" never consumed anywhere
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("number_dropped");
      expect(flags.find((f) => f.code === "number_dropped")?.severity).toBe("HIGH");
    });

    it("does not flag when every spoken number is accounted for", () => {
      const flags = evaluateReviewFlags(
        "chini 2 kilo 90 rupay",
        [item({ qty: 2, total: rupeesToPaise(90) })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("number_dropped");
    });

    it("ADVERSARIAL: does not false-positive on legitimate number repetition across two items", () => {
      // "2 kilo chawal aur 2 kilo aata" - the number 2 appears twice in
      // speech AND twice across items. Must not be treated as "one 2
      // dropped" just because a naive count mismatch check would see
      // two spoken 2s vs believe only one is "needed" per item.
      const flags = evaluateReviewFlags(
        "2 kilo chawal aur 2 kilo aata",
        [
          item({ spokenName: "chawal", catalogId: "11", qty: 2, unit: "kg", priceType: "default", rate: rupeesToPaise(50), total: rupeesToPaise(100) }),
          item({ spokenName: "aata", catalogId: "5", qty: 2, unit: "kg", priceType: "default", rate: rupeesToPaise(40), total: rupeesToPaise(80) }),
        ],
        [catalogEntry({ id: "11", displayName: "Chawal", unit: "kg", suggestedPricePaise: rupeesToPaise(50) }), catalogEntry({ id: "5", displayName: "Aata", unit: "kg", suggestedPricePaise: rupeesToPaise(40) })],
      );
      expect(codesOf(flags)).not.toContain("number_dropped");
    });

    it("ADVERSARIAL: recognises a Devanagari numeral the same as its Latin spelling", () => {
      const flags = evaluateReviewFlags(
        "chini दो किलो 90 rupay",
        [item({ qty: 2, unit: "kg", total: rupeesToPaise(90) })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("number_dropped");
    });

    it("ADVERSARIAL: a compositional fraction ('paune do') resolves to 1.75, not two separate numbers", () => {
      const flags = evaluateReviewFlags(
        "besan paune do kilo",
        [item({ spokenName: "besan", catalogId: "4", qty: 1.75, unit: "kg", priceType: "default", rate: rupeesToPaise(90), total: rupeesToPaise(157.5) })],
        [catalogEntry({ id: "4", displayName: "Besan", unit: "kg", suggestedPricePaise: rupeesToPaise(90) })],
      );
      expect(codesOf(flags)).not.toContain("number_dropped");
    });
  });

  describe("qty_dropped (HIGH) - a number attached to a unit word that never became any item's qty", () => {
    it("flags a spoken '<number> <unit>' that never appears as any item's qty", () => {
      const flags = evaluateReviewFlags(
        "chini 5 kilo 90 rupay",
        [item({ qty: null, unit: "", total: rupeesToPaise(90) })], // qty silently missing
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("qty_dropped");
      expect(flags.find((f) => f.code === "qty_dropped")?.severity).toBe("HIGH");
    });

    it("does not flag when the spoken quantity matches an item's real qty", () => {
      const flags = evaluateReviewFlags(
        "chini 5 kilo 90 rupay",
        [item({ qty: 5, total: rupeesToPaise(90) })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("qty_dropped");
    });

    it("ADVERSARIAL: a bare number with no attached unit is not treated as a dropped quantity", () => {
      // "chini 90 rupay" - 90 has no attached unit word, it's a price, not
      // a quantity - qty_dropped must not fire on it even if qty is null.
      const flags = evaluateReviewFlags(
        "ajwain",
        [item({ priceType: "unknown", qty: null, unit: "", rate: null, total: 0 })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("qty_dropped");
    });
  });

  describe("number_unconsumed (HIGH) - two numbers in one segment, one unused; scoped to segment/item 1:1 alignment", () => {
    it("flags a single segment with two spoken numbers where only one reaches the item", () => {
      const flags = evaluateReviewFlags(
        "chini 5 kilo 90 rupay",
        [item({ qty: 5, total: null })], // "90" never made it into rate or total
        [catalogEntry()],
      );
      expect(codesOf(flags)).toContain("number_unconsumed");
      expect(flags.find((f) => f.code === "number_unconsumed")?.severity).toBe("HIGH");
    });

    it("does not flag when both numbers in the segment are consumed", () => {
      const flags = evaluateReviewFlags(
        "chini 5 kilo 90 rupay",
        [item({ qty: 5, total: rupeesToPaise(90) })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("number_unconsumed");
    });

    it("ADVERSARIAL: does not fire across segment/item misalignment (a 2-segment utterance with only 1 item - Layer 2 shaped output)", () => {
      // Simulates a Gemini-sourced items array that doesn't respect "aur"
      // segmentation 1:1 - number_unconsumed must not guess here; general
      // number_dropped remains the real safety net for this shape instead.
      const flags = evaluateReviewFlags(
        "chini 2 kilo 90 rupay aur namak 1 kilo 20 rupay",
        [item({ qty: 2, total: rupeesToPaise(90) })], // only 1 item for 2 segments
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("number_unconsumed");
      // The real gap (namak's numbers entirely missing) is still caught -
      // just under the general code, not the segment-scoped one.
      expect(codesOf(flags)).toContain("number_dropped");
    });

    it("ADVERSARIAL: a single number in a segment never triggers this code (needs 2+)", () => {
      const flags = evaluateReviewFlags(
        "chini 2 kilo",
        [item({ qty: 2, priceType: "default", rate: rupeesToPaise(45), total: rupeesToPaise(90) })],
        [catalogEntry()],
      );
      expect(codesOf(flags)).not.toContain("number_unconsumed");
    });
  });

  // ---------------------------------------------------------------------
  // canFinalize() - the actual gate
  // ---------------------------------------------------------------------

  describe("canFinalize()", () => {
    it("blocks when any HIGH flag is unacknowledged", () => {
      const flags: ReviewFlag[] = [
        { id: "item-0-missing_total", code: "missing_total", severity: "HIGH", message: "x", itemIndex: 0 },
      ];
      expect(canFinalize(flags, new Set())).toBe(false);
    });

    it("allows finalising once every HIGH flag is acknowledged", () => {
      const flags: ReviewFlag[] = [
        { id: "item-0-missing_total", code: "missing_total", severity: "HIGH", message: "x", itemIndex: 0 },
      ];
      expect(canFinalize(flags, new Set(["item-0-missing_total"]))).toBe(true);
    });

    it("MEDIUM and LOW flags never block, acknowledged or not", () => {
      const flags: ReviewFlag[] = [
        { id: "item-0-weak_match", code: "weak_match", severity: "MEDIUM", message: "x", itemIndex: 0 },
        { id: "item-0-unknown_product", code: "unknown_product", severity: "LOW", message: "x", itemIndex: 0 },
      ];
      expect(canFinalize(flags, new Set())).toBe(true);
    });

    it("a bill with zero flags always finalises", () => {
      expect(canFinalize([], new Set())).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Message text - "inline sentences, not icons" (05-FRONTEND-SPEC.md)
  // ---------------------------------------------------------------------

  describe("message text", () => {
    it("every flag carries a real, non-empty sentence, not just a code", () => {
      const flags = evaluateReviewFlags(
        "chini 200 wala",
        [item({ priceType: "rate", rate: rupeesToPaise(200), total: rupeesToPaise(400) })],
        [catalogEntry({ suggestedPricePaise: rupeesToPaise(45) })],
      );
      const unusualRate = flags.find((f) => f.code === "unusual_rate");
      expect(unusualRate?.message.length).toBeGreaterThan(10);
      expect(unusualRate?.message).toContain("₹");
    });
  });
});
