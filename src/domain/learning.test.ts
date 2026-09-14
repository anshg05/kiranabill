import { describe, expect, it } from "vitest";
import {
  EMPTY_LEARNING_STATE,
  recordProductSighting,
  manuallyPromoteProduct,
  recordAliasConfirmation,
  suppressAlias,
  recordPriceObservation,
  getPriceSuggestions,
  ignorePriceSuggestion,
  type LearningState,
} from "./learning";

/**
 * KB-008 - domain/learning.ts. Tests written before the implementation,
 * same process as KB-005/KB-005b. docs/08-LEARNING-ENGINE.md is mostly a
 * forward design spec for this ticket, not an extraction of legacy
 * behavior (unlike every prior ticket this session) - legacy/
 * learning-store.js has no confidence score, no suppression, no manual
 * promotion, and no price-suggestion mechanism at all. Where the doc
 * doesn't give a number, that's stated in the test name/comment, not
 * silently picked.
 *
 * Confidence constants under test (docs/08-LEARNING-ENGINE.md section 4,
 * proposed where the doc is silent - see the handoff for exact reasoning):
 *   initial confidence on first correction: 0.5 (doc-given)
 *   +0.2 per confirmation without edit (doc-given, from the worked example)
 *   promotion threshold: >= 0.8 (doc-given)
 *   -0.2 per suppression (PROPOSED - doc only says "symmetric with promotion")
 *   retirement: a separate suppressionCount reaching 2 (PROPOSED - doc says
 *     "two suppressions retire it", read as a count, not a confidence floor)
 */

const NOW = Date.UTC(2026, 8, 14); // 14 Sep 2026, a fixed reference point - every time-dependent test is explicit about "now", never Date.now()
const DAY_MS = 24 * 60 * 60 * 1000;

function sighting(overrides: Partial<{ spokenName: string; displayName: string; unit: string; pricePaise: number }> = {}) {
  return {
    spokenName: "ajwain",
    displayName: "Ajwain",
    unit: "gm",
    pricePaise: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// L1 - product promotion
// ---------------------------------------------------------------------------
describe("L1 - automatic promotion at 3 sightings, not before", () => {
  it("1st sighting: not promoted", () => {
    const result = recordProductSighting(EMPTY_LEARNING_STATE, sighting());
    expect(result.promoted).toBe(false);
  });

  it("2nd sighting: still not promoted (sequence-dependent - same key, prior state matters)", () => {
    const after1 = recordProductSighting(EMPTY_LEARNING_STATE, sighting()).state;
    const after2 = recordProductSighting(after1, sighting());
    expect(after2.promoted).toBe(false);
  });

  it("3rd sighting: promoted - the exact point the same input starts behaving differently", () => {
    const after1 = recordProductSighting(EMPTY_LEARNING_STATE, sighting()).state;
    const after2 = recordProductSighting(after1, sighting()).state;
    const after3 = recordProductSighting(after2, sighting());
    expect(after3.promoted).toBe(true);
    expect(after3.promotedCatalogEntry?.displayName).toBe("Ajwain");
  });

  it("promotion price is the MODAL observed price across the 3 sightings, not the latest (unlike legacy's last-write-wins)", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordProductSighting(state, sighting({ pricePaise: 4000 })).state;
    state = recordProductSighting(state, sighting({ pricePaise: 4000 })).state;
    const result = recordProductSighting(state, sighting({ pricePaise: 5000 })); // latest differs from mode
    expect(result.promoted).toBe(true);
    expect(result.promotedCatalogEntry?.pricePaise).toBe(4000); // mode, not the latest 5000
  });

  it("a 3-way price tie breaks toward the first-observed price (proposed tie-break, not doc-specified)", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordProductSighting(state, sighting({ pricePaise: 4000 })).state;
    state = recordProductSighting(state, sighting({ pricePaise: 5000 })).state;
    const result = recordProductSighting(state, sighting({ pricePaise: 6000 }));
    expect(result.promotedCatalogEntry?.pricePaise).toBe(4000);
  });

  it("two different items are tracked independently - one reaching 3 sightings doesn't promote the other", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordProductSighting(state, sighting({ spokenName: "ajwain" })).state;
    state = recordProductSighting(state, sighting({ spokenName: "ajwain" })).state;
    const ajwainResult = recordProductSighting(state, sighting({ spokenName: "ajwain" }));
    const saunfResult = recordProductSighting(ajwainResult.state, sighting({ spokenName: "saunf", displayName: "Saunf" }));
    expect(ajwainResult.promoted).toBe(true);
    expect(saunfResult.promoted).toBe(false);
  });
});

describe("L1 - manual promotion bypasses the count entirely", () => {
  it("promotes on sighting 1, before the automatic threshold would ever fire", () => {
    const afterSighting = recordProductSighting(EMPTY_LEARNING_STATE, sighting()).state;
    const result = manuallyPromoteProduct(afterSighting, "ajwain");
    expect(result.promoted).toBe(true);
    expect(result.promotedCatalogEntry?.displayName).toBe("Ajwain");
  });

  it("uses the single observed price directly - no modal calculation needed with one data point", () => {
    const afterSighting = recordProductSighting(EMPTY_LEARNING_STATE, sighting({ pricePaise: 7000 })).state;
    const result = manuallyPromoteProduct(afterSighting, "ajwain");
    expect(result.promotedCatalogEntry?.pricePaise).toBe(7000);
  });

  it("automatic (2 sightings, not yet 3) and manual promotion are genuinely different code paths - manual succeeds where automatic would not yet have fired", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordProductSighting(state, sighting()).state;
    const autoAttempt = recordProductSighting(state, sighting());
    expect(autoAttempt.promoted).toBe(false); // only 2 sightings - automatic path correctly declines

    const manualAttempt = manuallyPromoteProduct(autoAttempt.state, "ajwain");
    expect(manualAttempt.promoted).toBe(true); // manual path promotes anyway
  });
});

// ---------------------------------------------------------------------------
// L2 - alias confidence, promotion, and suppression
// ---------------------------------------------------------------------------
describe("L2 - alias confidence climbs 0.5 -> 0.7 -> 0.9, promoted at >=0.8", () => {
  const correction = { spokenName: "पाले जी", catalogId: "52" };

  it("1st correction creates the mapping at confidence 0.5, not yet promoted", () => {
    const result = recordAliasConfirmation(EMPTY_LEARNING_STATE, correction);
    const alias = result.state.learnedAliases["पाले जी"];
    expect(alias?.confidence).toBe(0.5);
    expect(alias?.hitCount).toBe(1);
    expect(result.promoted).toBe(false);
  });

  it("2nd confirmation (same phrase, no further edit) -> confidence 0.7, still not promoted", () => {
    const after1 = recordAliasConfirmation(EMPTY_LEARNING_STATE, correction).state;
    const result = recordAliasConfirmation(after1, correction);
    expect(result.state.learnedAliases["पाले जी"]?.confidence).toBeCloseTo(0.7, 10);
    expect(result.promoted).toBe(false);
  });

  it("3rd confirmation -> confidence 0.9, crosses the 0.8 threshold - sequence-dependent: identical call, different result than confirmation 1 or 2", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordAliasConfirmation(state, correction).state;
    state = recordAliasConfirmation(state, correction).state;
    const result = recordAliasConfirmation(state, correction);
    expect(result.state.learnedAliases["पाले जी"]?.confidence).toBeCloseTo(0.9, 10);
    expect(result.promoted).toBe(true);
  });

  it("two unrelated aliases accumulate independently", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordAliasConfirmation(state, correction).state;
    state = recordAliasConfirmation(state, { spokenName: "दूथ", catalogId: "45" }).state;
    expect(state.learnedAliases["पाले जी"]?.hitCount).toBe(1);
    expect(state.learnedAliases["दूथ"]?.hitCount).toBe(1);
  });
});

describe("L2 - suppression: a learned alias can be un-learned, not just accumulated (docs/08-LEARNING-ENGINE.md section 10 rule 5, retirement mechanism per docs/07-DECISIONS.md D15)", () => {
  const correction = { spokenName: "पाले जी", catalogId: "52" };

  it("one suppression decrements confidence by 0.2; a well-confirmed alias survives it", () => {
    const state = (() => {
      let s: LearningState = EMPTY_LEARNING_STATE;
      s = recordAliasConfirmation(s, correction).state;
      s = recordAliasConfirmation(s, correction).state;
      return recordAliasConfirmation(s, correction).state; // confidence 0.9
    })();

    const afterSuppression = suppressAlias(state, "पाले जी");
    expect(afterSuppression.learnedAliases["पाले जी"]).toBeDefined(); // still present
    expect(afterSuppression.learnedAliases["पाले जी"]?.confidence).toBeCloseTo(0.7, 10); // 0.9 - 0.2
  });

  it("retirement is confidence-threshold-based (<=0.3), not a flat suppression count - D15: a freshly-created alias (confidence 0.5) retires after exactly ONE suppression", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordAliasConfirmation(state, correction).state; // confidence 0.5
    state = suppressAlias(state, "पाले जी"); // 0.5 - 0.2 = 0.3 <= 0.3 -> retired
    expect(state.learnedAliases["पाले जी"]).toBeUndefined();
  });

  it("D15's actual point: a HEAVILY confirmed alias (confidence 0.9, three confirmations) survives two suppressions that a freshly-created one (confidence 0.5, one confirmation) does not survive even once", () => {
    // Freshly created - does not survive a single suppression.
    let freshState: LearningState = EMPTY_LEARNING_STATE;
    freshState = recordAliasConfirmation(freshState, correction).state; // 0.5
    freshState = suppressAlias(freshState, "पाले जी"); // 0.3 -> retired
    expect(freshState.learnedAliases["पाले जी"]).toBeUndefined();

    // Heavily confirmed - survives the same two suppressions the fresh one couldn't survive even one of.
    let establishedState: LearningState = EMPTY_LEARNING_STATE;
    establishedState = recordAliasConfirmation(establishedState, correction).state;
    establishedState = recordAliasConfirmation(establishedState, correction).state;
    establishedState = recordAliasConfirmation(establishedState, correction).state; // 0.9
    establishedState = suppressAlias(establishedState, "पाले जी"); // 0.7
    establishedState = suppressAlias(establishedState, "पाले जी"); // 0.5
    expect(establishedState.learnedAliases["पाले जी"]).toBeDefined();
    expect(establishedState.learnedAliases["पाले जी"]?.confidence).toBeCloseTo(0.5, 10);
  });

  it("the gradient between those two extremes: a moderately confirmed alias (confidence 0.7, two confirmations) survives one suppression but not a second", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordAliasConfirmation(state, correction).state;
    state = recordAliasConfirmation(state, correction).state; // 0.7
    state = suppressAlias(state, "पाले जी"); // 0.5 - survives
    expect(state.learnedAliases["पाले जी"]).toBeDefined();
    state = suppressAlias(state, "पाले जी"); // 0.3 - retires
    expect(state.learnedAliases["पाले जी"]).toBeUndefined();
  });

  it("a retired alias can be re-learned from scratch, at confidence 0.5, not blocked forever", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordAliasConfirmation(state, correction).state; // 0.5
    state = suppressAlias(state, "पाले जी"); // retired (0.3)
    expect(state.learnedAliases["पाले जी"]).toBeUndefined();
    state = recordAliasConfirmation(state, correction).state; // spoken again later
    expect(state.learnedAliases["पाले जी"]?.confidence).toBe(0.5);
    expect(state.learnedAliases["पाले जी"]?.hitCount).toBe(1);
  });

  it("suppressing an alias that was never learned is a no-op, not an error", () => {
    const state = suppressAlias(EMPTY_LEARNING_STATE, "कभी नहीं सुना");
    expect(state).toEqual(EMPTY_LEARNING_STATE);
  });
});

// ---------------------------------------------------------------------------
// L3 - price suggestion, NEVER auto-applied
// ---------------------------------------------------------------------------
describe("L3 - price drift produces a SUGGESTION only, never changes the price itself", () => {
  const CATALOG_ID = "27"; // Chini
  const CURRENT_PRICE = 4500; // paise, matches the real catalog's Chini price

  it("1 or 2 observations of a different price -> no suggestion yet", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + DAY_MS).state;
    expect(getPriceSuggestions(state, NOW + DAY_MS)).toEqual([]);
  });

  it("3rd observation of the SAME different price within 30 days -> a suggestion appears - sequence-dependent, same as L1/L2's 3rd-time behavior", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + DAY_MS).state;
    const result = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + 2 * DAY_MS);
    const suggestions = getPriceSuggestions(result.state, NOW + 2 * DAY_MS);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.catalogId).toBe(CATALOG_ID);
    expect(suggestions[0]!.suggestedPricePaise).toBe(4800);
    expect(suggestions[0]!.observationCount).toBe(3);
  });

  it("THE SUGGESTION NEVER BECOMES THE PRICE ON ITS OWN: recording observations and reading suggestions never touches a 'current price' anywhere in state", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    for (let i = 0; i < 5; i++) {
      state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + i * DAY_MS).state;
    }
    // The suggestion exists...
    const suggestions = getPriceSuggestions(state, NOW + 5 * DAY_MS);
    expect(suggestions[0]!.suggestedPricePaise).toBe(4800);
    // ...but nothing in LearningState represents an actual product price at
    // all - there is no field anywhere that recordPriceObservation could
    // have silently written the new price into. Suggesting and applying
    // are two separate steps; this module only ever does the first one.
    expect(state).not.toHaveProperty("currentPricePaise");
    expect(Object.keys(state)).toEqual(["provisionalProducts", "learnedAliases", "priceObservations"]);
  });

  it("three DIFFERENT alternate prices (each seen once) do NOT trigger a suggestion - the rule is 3 of the SAME price, not 3 of any differing price", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 5000, NOW + DAY_MS).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 5200, NOW + 2 * DAY_MS).state;
    expect(getPriceSuggestions(state, NOW + 2 * DAY_MS)).toEqual([]);
  });

  it("an observation exactly matching the current price is not counted as drift at all", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, CURRENT_PRICE, NOW).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, CURRENT_PRICE, NOW + DAY_MS).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, CURRENT_PRICE, NOW + 2 * DAY_MS).state;
    expect(getPriceSuggestions(state, NOW + 2 * DAY_MS)).toEqual([]);
  });

  it("observations older than 30 days fall out of the window and don't count toward the threshold", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW).state; // will be 31 days old
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + 31 * DAY_MS).state;
    state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + 32 * DAY_MS).state;
    const asOf = NOW + 32 * DAY_MS;
    // only the last two observations are within 30 days of "asOf" - the
    // first one (day 0) is 32 days old by then, outside the window.
    expect(getPriceSuggestions(state, asOf)).toEqual([]);
  });

  it("[Ignore] suppresses that specific suggestion for 90 days; fresh observations after that reinstate it", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    for (let i = 0; i < 3; i++) {
      state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, NOW + i * DAY_MS).state;
    }
    expect(getPriceSuggestions(state, NOW + 2 * DAY_MS)).toHaveLength(1);

    state = ignorePriceSuggestion(state, CATALOG_ID, NOW + 2 * DAY_MS);
    expect(getPriceSuggestions(state, NOW + 2 * DAY_MS)).toEqual([]); // suppressed immediately after
    expect(getPriceSuggestions(state, NOW + 2 * DAY_MS + 89 * DAY_MS)).toEqual([]); // still suppressed, day 89

    // The 90-day ignore window is longer than the 30-day observation
    // window, so the original 3 observations are always aged out by the
    // time "ignore" lapses - reappearance has to come from NEW
    // observations after that point, not the same ones re-counting.
    const afterIgnoreLapses = NOW + 2 * DAY_MS + 91 * DAY_MS;
    for (let i = 0; i < 3; i++) {
      state = recordPriceObservation(state, CATALOG_ID, CURRENT_PRICE, 4800, afterIgnoreLapses + i * DAY_MS).state;
    }
    expect(getPriceSuggestions(state, afterIgnoreLapses + 2 * DAY_MS).length).toBeGreaterThan(0);
  });

  it("suggestion and acceptance are two separate steps - this module has no 'accept' function at all, by design", () => {
    // There is deliberately no acceptPriceSuggestion()/applyPrice() export.
    // Accepting a suggestion means the CALLER updates shop_products.price
    // itself (a database write, Phase 1) - this module's job stops at
    // producing the suggestion. Asserting the module's surface here so a
    // future edit that adds an auto-apply path fails this test loudly.
    const learningModule = { recordPriceObservation, getPriceSuggestions, ignorePriceSuggestion };
    expect(Object.keys(learningModule).some((name) => /accept|apply/i.test(name))).toBe(false);
  });
});
