import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { editQty, editRate, customItem } from "./billEdit";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { deterministicUuid } from "./ids";
import {
  EMPTY_LEARNING_STATE,
  learnFromBill,
  recordAliasConfirmation,
  recordProductSighting,
  type LearnLine,
  type LearningState,
} from "./learning";

// KB-307 commit 3 (owner, 3 Oct 2026): what one finalised bill teaches -
// docs/08-LEARNING-ENGINE.md §2-§5, per line kind. Pure; data/learnBill.ts
// persists it. Real parser output (D39), turned into bill items exactly as
// finalise does (buildFinalBill).

const catalog = SEED_PARSER_CATALOG.entries;
const NOW = Date.parse("2026-10-03T12:00:00.000Z");

/** Bill items as finalise writes them, from real parser output. */
function items(...lines: { transcript: string; source?: FinalLine["source"]; edit?: (i: FinalLine["item"]) => FinalLine["item"] }[]): LearnLine[] {
  const finalLines: FinalLine[] = lines.flatMap((l, u) =>
    parseUtterance(l.transcript, SEED_PARSER_CATALOG)!.map((item) => {
      const edited = l.edit ? l.edit(item) : item;
      return {
        id: `l${u}`,
        utteranceId: u,
        item: edited,
        original: item,
        displayName: item.catalogId ? SEED_PARSER_CATALOG.byId.get(item.catalogId)!.displayName : item.spokenName,
        source: l.source ?? "fastpath",
      };
    }),
  );
  const built = buildFinalBill(finalLines, []);
  if (!built.ok) throw new Error(built.error);
  return built.items.map((i) => ({ ...i }));
}

const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};
const kinds = (r: ReturnType<typeof learnFromBill>) => r.decisions.map((d) => d.kind);

describe("deterministicUuid - the same input always gives the same id (re-runs are no-ops)", () => {
  it("stable, distinct, and a valid UUID (bills/learning local_id columns are uuid)", () => {
    const a = deterministicUuid("price_observation", "bill-1", 2);
    expect(deterministicUuid("price_observation", "bill-1", 2)).toBe(a);
    expect(deterministicUuid("price_observation", "bill-1", 3)).not.toBe(a);
    expect(deterministicUuid("price_observation", "bill-2", 2)).not.toBe(a);
    expect(deterministicUuid("learning_event", "bill-1", 2)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Parts are delimited, so ("ab","c") and ("a","bc") never collide.
    expect(deterministicUuid("ab", "c")).not.toBe(deterministicUuid("a", "bc"));
  });
});

describe("learnFromBill - L2 aliases (08 §2, §4)", () => {
  it("an unedited voice line whose words are NOT an exact alias ('चिनी' -> Chini) teaches the alias, tagged with its source layer", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "2 kilo चिनी" }), discarded: [] }, catalog, NOW);
    expect(r.decisions).toEqual([
      { kind: "alias_confirmed", lineNo: 1, alias: "चिनी", shopProductId: "27", sourceLayer: "fastpath", confidenceBefore: null, confidenceAfter: 0.5, hitCount: 1, promoted: false },
    ]);
    expect(r.state.learnedAliases["चिनी"]).toMatchObject({ catalogId: "27", confidence: 0.5, hitCount: 1 });
  });

  it("words that ARE an exact alias ('cheeni') teach nothing (owner, decision 6)", () => {
    expect(kinds(learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "2 kilo cheeni" }), discarded: [] }, catalog, NOW))).toEqual([]);
  });

  it("a Gemini line is tagged 'gemini' (owner: Gemini guesses need a higher bar later - KB-323)", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "3 parle ji 10 wala", source: "voice" }), discarded: [] }, catalog, NOW);
    expect(r.decisions).toEqual([expect.objectContaining({ kind: "alias_confirmed", alias: "parle ji", shopProductId: "52", sourceLayer: "gemini" })]);
  });

  it("confirmed again: 0.5 -> 0.7 -> 0.9, promoted at >= 0.8 (two-decimal confidence, numeric(3,2))", () => {
    let state: LearningState = EMPTY_LEARNING_STATE;
    const seen: [number | null, number, boolean][] = [];
    for (let i = 0; i < 3; i++) {
      const r = learnFromBill(state, { lines: items({ transcript: "2 kilo चिनी" }), discarded: [] }, catalog, NOW);
      const d = r.decisions[0]!;
      if (d.kind !== "alias_confirmed") throw new Error(d.kind);
      seen.push([d.confidenceBefore, d.confidenceAfter, d.promoted]);
      state = r.state;
    }
    expect(seen).toEqual([
      [null, 0.5, false],
      [0.5, 0.7, false],
      [0.7, 0.9, true],
    ]);
  });

  it("an EDITED voice line teaches no alias (an edit isn't an acceptance)", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "2 kilo चिनी", edit: (i) => ok(editQty(i, "3")) }), discarded: [] }, catalog, NOW);
    expect(kinds(r)).toEqual([]);
  });

  it("a hand-added line never teaches an alias, even unedited (owner, decision 4)", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "2 kilo चिनी", source: "manual" }), discarded: [] }, catalog, NOW);
    expect(kinds(r)).toEqual([]);
  });

  it("a REMOVED voice line that used a learned alias suppresses it (-0.2): from 0.5 that reaches the 0.3 retirement threshold (D15)", () => {
    const learned = recordAliasConfirmation(EMPTY_LEARNING_STATE, { spokenName: "चिनी", catalogId: "27" }).state;
    const discarded = [{ spokenName: "चिनी", shopProductId: "27", source: "fastpath" as const }];
    const first = learnFromBill(learned, { lines: items({ transcript: "1 kilo besan" }), discarded }, catalog, NOW);
    expect(first.decisions).toEqual([
      { kind: "alias_suppressed", index: 0, alias: "चिनी", shopProductId: "27", sourceLayer: "fastpath", confidenceBefore: 0.5, confidenceAfter: 0.3, retired: true },
    ]);
    expect(first.state.learnedAliases["चिनी"]).toBeUndefined();
  });

  it("a removed line whose words were never learned changes nothing", () => {
    const discarded = [{ spokenName: "cheeni", shopProductId: "27", source: "fastpath" as const }];
    expect(kinds(learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "1 kilo besan" }), discarded }, catalog, NOW))).toEqual([]);
  });
});

describe("learnFromBill - L3 price observations (08 §5: suggest, never apply)", () => {
  it("a rate differing from the shop's price, in the shop's own unit, is observed - voice or hand-added", () => {
    const r = learnFromBill(
      EMPTY_LEARNING_STATE,
      { lines: items({ transcript: "2 kilo cheeni", edit: (i) => ok(editRate(i, "48")) }, { transcript: "1 kilo besan", source: "manual", edit: (i) => ok(editRate(i, "95")) }), discarded: [] },
      catalog,
      NOW,
    );
    expect(r.decisions).toEqual([
      { kind: "price_observed", lineNo: 1, shopProductId: "27", observedPricePaise: 4800, shopPricePaise: 4500 },
      { kind: "price_observed", lineNo: 2, shopProductId: expect.any(String), observedPricePaise: 9500, shopPricePaise: 9000 },
    ]);
    expect(Object.keys(r.state.priceObservations).sort()).toEqual(["27", r.decisions[1]!.kind === "price_observed" ? r.decisions[1]!.shopProductId : ""].sort());
  });

  it("the shop's own price is not drift; a total-only line has no rate to compare", () => {
    expect(kinds(learnFromBill(EMPTY_LEARNING_STATE, { lines: items({ transcript: "2 kilo cheeni" }, { transcript: "sabun 180 rupay" }), discarded: [] }, catalog, NOW))).toEqual([]);
  });
});

describe("learnFromBill - L1 new products (08 §3)", () => {
  function customLine(name: string, rate: string | null): LearnLine {
    let item = customItem(name);
    item = { ...item, unit: "kg", qty: 2 };
    item = rate === null ? { ...item, total: 5000, priceType: "total" } : ok(editRate(item, rate));
    const built = buildFinalBill([{ id: "c", utteranceId: 9, item, original: customItem(name), displayName: name, source: "manual" }], []);
    if (!built.ok) throw new Error(built.error);
    return built.items[0]!;
  }

  it("a custom item is a provisional sighting - name, unit, its rate as the observed price", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: [customLine("kuch naya", "30")], discarded: [] }, catalog, NOW);
    expect(r.decisions).toEqual([{ kind: "product_sighted", lineNo: 1, spokenName: "kuch naya", unit: "kg", pricePaise: 3000, seenCount: 1, promotionDue: false }]);
  });

  it("a total-only custom item is sighted with no price (never a made-up per-unit price)", () => {
    const r = learnFromBill(EMPTY_LEARNING_STATE, { lines: [customLine("kuch naya", null)], discarded: [] }, catalog, NOW);
    expect(r.decisions).toEqual([expect.objectContaining({ kind: "product_sighted", pricePaise: null, seenCount: 1 })]);
  });

  it("the third sighting is 'promotion due' (once) - no shop_product is created here (KB-320)", () => {
    let state = recordProductSighting(EMPTY_LEARNING_STATE, { spokenName: "kuch naya", displayName: "kuch naya", unit: "kg", pricePaise: 3000 }).state;
    state = recordProductSighting(state, { spokenName: "kuch naya", displayName: "kuch naya", unit: "kg", pricePaise: null }).state;
    const r = learnFromBill(state, { lines: [customLine("kuch naya", "30")], discarded: [] }, catalog, NOW);
    expect(r.decisions).toEqual([expect.objectContaining({ kind: "product_sighted", seenCount: 3, promotionDue: true })]);
  });
});

describe("learnFromBill is pure", () => {
  it("the same state and bill give the same decisions and state; the input state is untouched", () => {
    const input = { lines: items({ transcript: "2 kilo चिनी" }, { transcript: "2 kilo cheeni", edit: (i: FinalLine["item"]) => ok(editRate(i, "48")) }), discarded: [] };
    const a = learnFromBill(EMPTY_LEARNING_STATE, input, catalog, NOW);
    const b = learnFromBill(EMPTY_LEARNING_STATE, input, catalog, NOW);
    expect(a).toEqual(b);
    expect(EMPTY_LEARNING_STATE).toEqual({ provisionalProducts: {}, learnedAliases: {}, priceObservations: {} });
  });
});
