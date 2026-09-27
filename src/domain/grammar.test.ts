import { describe, expect, it } from "vitest";
import { parseUtterance, diagnoseUtterance, extractSpokenNumbers, type ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { prepareParserCatalog } from "./catalogIndex";
import { getCatalogEntryById } from "./catalog";
import { lineTotalPaise } from "./money";
import voiceCases from "../../eval/voice-cases.json";
import numberBenchmarkCases from "../../eval/number-benchmark.json";

/**
 * KB-005 - domain/grammar.ts, the pricing grammar. Tests written before the
 * implementation, per the owner's instruction - see the design notes in the
 * commit/handoff for the interpretive calls made while deriving these rules
 * from docs/14-LEGACY-REFERENCE.md section 1 (the old Gemini prompt) as
 * deterministic logic instead of an LLM instruction.
 *
 * Every default-price expectation below is read from the LIVE catalog via
 * getCatalogEntryById(), never hardcoded - docs/12-PARKED.md KI-17 was
 * exactly this class of bug in eval/voice-cases.json (KB-004), and these
 * tests should not repeat it.
 */

function parseOne(text: string): ParsedItem {
  const items = parseUtterance(text, SEED_PARSER_CATALOG);
  expect(items, `expected exactly one item for "${text}", got null (bailed out)`).not.toBeNull();
  expect(items!, `expected exactly one item for "${text}"`).toHaveLength(1);
  return items![0]!;
}

function catalogEntry(id: string) {
  const entry = getCatalogEntryById(id);
  if (!entry) throw new Error(`test fixture error: catalog id "${id}" does not exist`);
  return entry;
}

// ---------------------------------------------------------------------------
// Rule 1: "X wala" / "X wali" = X is the per-unit RATE
// ---------------------------------------------------------------------------
// KB-302 (owner, Q2): Layer 1 parses against the catalog it is GIVEN - the
// shop's own (D4) - never silently against the base seed.
describe("the catalog is a required argument - the shop's own catalog decides", () => {
  const seedChini = getCatalogEntryById("27")!;
  const shopChini = { ...seedChini, id: "shop-product-chini", suggestedPricePaise: 5200 };

  it("a shop's own price wins: '2 kilo chini' bills the shop's ₹52/kg, not the seed's ₹45", () => {
    const [line] = parseUtterance("2 kilo chini", prepareParserCatalog([shopChini]))!;
    expect(line).toMatchObject({ catalogId: "shop-product-chini", rate: 5200, rateUnit: "kg", total: 10400, priceType: "default" });
    // Same words against the seed, for contrast:
    expect(parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)![0]).toMatchObject({ catalogId: "27", total: 9000 });
  });

  it("a 'start empty' shop (no products): chini is an unknown product - never priced from the seed", () => {
    const [line] = parseUtterance("2 kilo chini", prepareParserCatalog([]))!;
    expect(line).toMatchObject({ catalogId: null, isCustom: true, rate: null, total: null, priceType: "unknown" });
  });
});

describe("Rule 1 - wala/wali means per-unit rate", () => {
  it("qty unit product rate wala - 5 kg chawal 30 wala", () => {
    const item = parseOne("5 kg chawal 30 wala");
    expect(item.spokenName).toBe("chawal");
    expect(item.catalogId).toBe("11");
    expect(item.qty).toBe(5);
    expect(item.unit).toBe("kg");
    expect(item.rate).toBe(3000);
    expect(item.total).toBe(15000);
    expect(item.priceType).toBe("rate");
  });

  it("wali variant, reversed order - kanki 36 wali 5kg", () => {
    const item = parseOne("kanki 36 wali 5kg");
    expect(item.catalogId).toBe("620");
    expect(item.qty).toBe(5);
    expect(item.unit).toBe("kg");
    expect(item.rate).toBe(3600);
    expect(item.total).toBe(18000);
    expect(item.priceType).toBe("rate");
  });

  it("piece item with a Hindi quantity word - teen bath sabun 10 wala", () => {
    const item = parseOne("teen bath sabun 10 wala");
    expect(item.qty).toBe(3);
    expect(item.unit).toBe("piece");
    expect(item.rate).toBe(1000);
    expect(item.total).toBe(3000);
    expect(item.priceType).toBe("rate");
  });
});

// ---------------------------------------------------------------------------
// Rule 2: "X ka" / "X ki" = X is the TOTAL, never a rate
// ---------------------------------------------------------------------------
describe("Rule 2 - ka/ki means total price, not rate", () => {
  it("THE differentiator case - 5 kg chawal 30 ka is total 3000 paise, rate null (old code returned rate-based 10000)", () => {
    const item = parseOne("5 kg chawal 30 ka");
    expect(item.spokenName).toBe("chawal");
    expect(item.catalogId).toBe("11");
    expect(item.qty).toBe(5);
    expect(item.unit).toBe("kg");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(3000);
    expect(item.priceType).toBe("total");
  });

  it("ki variant - same total", () => {
    const item = parseOne("5 kg chawal 30 ki");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(3000);
    expect(item.priceType).toBe("total");
  });

  it("ka vs wala on IDENTICAL phrasing produce DIFFERENT totals - confirmed differentiator, 04-VOICE-PIPELINE.md O4 (Pilloo returns the same amount for both)", () => {
    const ka = parseOne("5 kg chawal 30 ka");
    const wala = parseOne("5 kg chawal 30 wala");
    expect(ka.total).toBe(3000);
    expect(wala.total).toBe(15000);
    expect(ka.total).not.toBe(wala.total);
  });

  it("no qty/unit spoken, product resolves in catalog -> qty 1 of the catalog's OWN unit, not invented from nothing - ajwain 10 ki", () => {
    const item = parseOne("ajwain 10 ki");
    expect(item.catalogId).toBe("117");
    expect(item.qty).toBe(1);
    expect(item.unit).toBe(catalogEntry("117").unit); // "gm"
    expect(item.rate).toBeNull();
    expect(item.total).toBe(1000);
    expect(item.priceType).toBe("total");
  });

  it("no qty/unit spoken, product does NOT resolve -> qty null, unit '' (nothing to fall back to) - ganesh poha 70 ki", () => {
    const item = parseOne("ganesh poha 70 ki");
    expect(item.catalogId).toBeNull();
    expect(item.isCustom).toBe(true);
    expect(item.qty).toBeNull();
    expect(item.unit).toBe("");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(7000);
    expect(item.priceType).toBe("total");
  });
});

// ---------------------------------------------------------------------------
// Rule 3: bare price (no wala, no ka/ki) = TOTAL, never a rate
// ---------------------------------------------------------------------------
describe("Rule 3 - a bare price with no wala/ka/ki is a total", () => {
  it("explicit qty and unit spoken - 2 kilo chini 90 rupay", () => {
    const item = parseOne("2 kilo chini 90 rupay");
    expect(item.catalogId).toBe("27");
    expect(item.qty).toBe(2);
    expect(item.unit).toBe("kg");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(9000);
    expect(item.priceType).toBe("total");
  });

  it("gram unit, explicit qty - 50 gram jeera 20 rupay", () => {
    const item = parseOne("50 gram jeera 20 rupay");
    expect(item.catalogId).toBe("104");
    expect(item.qty).toBe(50);
    expect(item.unit).toBe("gm");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(2000);
    expect(item.priceType).toBe("total");
  });
});

// ---------------------------------------------------------------------------
// Rule 4: the same base product spoken twice at different prices is TWO
// separate lines, never merged - within a single multi-item utterance.
// ---------------------------------------------------------------------------
describe("Rule 4 - distinct variants by price are never merged", () => {
  it("chini spoken twice at different prices in one utterance -> two separate lines", () => {
    const items = parseUtterance("chini 30 rupay aur chini 180 rupay", SEED_PARSER_CATALOG);
    expect(items).not.toBeNull();
    expect(items!).toHaveLength(2);
    const [first, second] = items!;

    expect(first!.spokenName).toBe("chini");
    expect(first!.catalogId).toBe("27");
    expect(first!.total).toBe(3000);
    expect(first!.priceType).toBe("total");

    expect(second!.spokenName).toBe("chini");
    expect(second!.catalogId).toBe("27");
    expect(second!.total).toBe(18000);
    expect(second!.priceType).toBe("total");
  });

  it("two different products in one utterance, each at catalog default price - 2 packet oreo aur 1 monaco", () => {
    const items = parseUtterance("2 packet oreo aur 1 monaco", SEED_PARSER_CATALOG);
    expect(items).not.toBeNull();
    expect(items!).toHaveLength(2);
    const [first, second] = items!;

    const oreo = catalogEntry("63");
    const monaco = catalogEntry("55");

    expect(first!.catalogId).toBe("63");
    expect(first!.qty).toBe(2);
    expect(first!.rate).toBe(oreo.suggestedPricePaise);
    expect(first!.total).toBe(lineTotalPaise(2, oreo.suggestedPricePaise));
    expect(first!.priceType).toBe("default");

    expect(second!.catalogId).toBe("55");
    expect(second!.qty).toBe(1);
    expect(second!.rate).toBe(monaco.suggestedPricePaise);
    expect(second!.total).toBe(lineTotalPaise(1, monaco.suggestedPricePaise));
    expect(second!.priceType).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// Rule 5: no price mentioned. Qty spoken -> catalog default. NOTHING spoken
// but a bare item name -> never guess, priceType "unknown", total 0.
// ---------------------------------------------------------------------------
describe("Rule 5a - qty spoken, no price -> catalog default price, never invented", () => {
  it("aadha kilo moong daal - default price read live from the catalog", () => {
    const entry = catalogEntry("18");
    const item = parseOne("aadha kilo moong daal");
    expect(item.catalogId).toBe("18");
    expect(item.qty).toBe(0.5);
    expect(item.unit).toBe("kg");
    expect(item.rate).toBe(entry.suggestedPricePaise);
    expect(item.total).toBe(lineTotalPaise(0.5, entry.suggestedPricePaise));
    expect(item.priceType).toBe("default");
  });

  it("spoken unit differs from the catalog's - 500 gram besan: qty stays as spoken, rate carries the catalog unit (KB-005f, D36)", () => {
    // KB-005f / docs/07-DECISIONS.md D36: the line keeps the qty and unit
    // as spoken; the rate carries its own unit (the catalog's). This used
    // to assert a per-gram rate derived by dividing the per-kg price by
    // 1000 - which only "worked" because Besan's price happens to divide
    // evenly (KI-30: chini's doesn't). Total 500 gm x 9000 paise/kg = 4500.
    const entry = catalogEntry("4"); // Besan, priced per kg
    expect(entry.unit).toBe("kg");

    const item = parseOne("500 gram besan");
    expect(item.catalogId).toBe("4");
    expect(item.qty).toBe(500);
    expect(item.unit).toBe("gm");
    expect(item.rate).toBe(entry.suggestedPricePaise);
    expect(item.rateUnit).toBe("kg");
    expect(item.total).toBe(4500);
    expect(item.priceType).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// KB-005f (docs/12-PARKED.md KI-30, docs/07-DECISIONS.md D36): a line keeps
// qty and unit exactly as spoken; its rate carries its own unit (rateUnit).
// Totals across gm<->kg and ml<->liter are computed exactly - qty x rate,
// shifted by 1000, rounded half-up ONCE at the line (D11) - never via a
// rounded per-gram rate. The old code rounded 4.5 paise/gm up to 5, so
// "500 gram chini" billed Rs.25 instead of Rs.22.50, silently.
// Every expected total below is hand-computed and stated in paise.
// ---------------------------------------------------------------------------
describe("KB-005f - cross-unit default price, exact (KI-30)", () => {
  function expectCrossUnit(text: string, want: { qty: number; unit: string; catalogId: string; rateUnit: string; total: number }) {
    const entry = catalogEntry(want.catalogId);
    const item = parseOne(text);
    expect(item.catalogId).toBe(want.catalogId);
    expect(item.qty).toBe(want.qty);
    expect(item.unit).toBe(want.unit);
    expect(item.rate).toBe(entry.suggestedPricePaise); // the catalog price itself, never re-scaled
    expect(item.rateUnit).toBe(want.rateUnit);
    expect(item.total).toBe(want.total);
    expect(item.priceType).toBe("default");
  }

  it("500 gram chini = 2250 paise (Rs.22.50) - Chini 4500 paise/kg; the KI-30 repro, was 2500", () => {
    expectCrossUnit("500 gram chini", { qty: 500, unit: "gm", catalogId: "27", rateUnit: "kg", total: 2250 });
  });

  it("500 ml doodh = 2800 paise - Doodh 5600 paise/liter; was 3000", () => {
    expectCrossUnit("500 ml doodh", { qty: 500, unit: "ml", catalogId: "44", rateUnit: "liter", total: 2800 });
  });

  it("250 gram chini = 1125 paise - was 1250", () => {
    expectCrossUnit("250 gram chini", { qty: 250, unit: "gm", catalogId: "27", rateUnit: "kg", total: 1125 });
  });

  it("1 gram chini = 5 paise - 4.5 paise exactly, half-up at the line (D11)", () => {
    expectCrossUnit("1 gram chini", { qty: 1, unit: "gm", catalogId: "27", rateUnit: "kg", total: 5 });
  });

  it("333 gram chini = 1499 paise - 1498.5 exactly, a genuine half-paise tie rounded half-up ONCE at the line", () => {
    expectCrossUnit("333 gram chini", { qty: 333, unit: "gm", catalogId: "27", rateUnit: "kg", total: 1499 });
  });

  it("dhai gram chini = 11 paise - 2.5 gm x 4500/kg = 11.25; no bail, no rounded per-gram rate (was 13)", () => {
    expectCrossUnit("dhai gram chini", { qty: 2.5, unit: "gm", catalogId: "27", rateUnit: "kg", total: 11 });
  });

  it("1 kilo ajwain = 50000 paise - the reverse direction: Ajwain 50 paise/gm, rateUnit gm", () => {
    expectCrossUnit("1 kilo ajwain", { qty: 1, unit: "kg", catalogId: "117", rateUnit: "gm", total: 50000 });
  });

  it("rateUnit semantics: same-unit default line -> rateUnit equals unit", () => {
    const item = parseOne("2 kilo chini");
    expect(item.rate).toBe(catalogEntry("27").suggestedPricePaise);
    expect(item.rateUnit).toBe("kg");
    expect(item.total).toBe(9000);
  });

  it("rateUnit semantics: a spoken total (ka) has no rate -> rateUnit is null", () => {
    const item = parseOne("5 kg chawal 30 ka");
    expect(item.rate).toBeNull();
    expect(item.rateUnit).toBeNull();
  });

  it("rateUnit semantics: a spoken wala rate is read literally, per the spoken unit - '500 gram jeera 600 wala' is unchanged (Rs.3,00,000, HIGH-flagged; inferRateBasis is unwired, a separate KI)", () => {
    const item = parseOne("500 gram jeera 600 wala");
    expect(item.qty).toBe(500);
    expect(item.unit).toBe("gm");
    expect(item.rate).toBe(60000);
    expect(item.rateUnit).toBe("gm");
    expect(item.total).toBe(30000000);
    expect(item.priceType).toBe("rate");
  });
});

describe("Rule 5b - a bare item with no qty and no price is never guessed", () => {
  it("ajwain alone -> priceType unknown, total 0, qty/rate null - even though the product resolves in the catalog", () => {
    const item = parseOne("ajwain");
    expect(item.spokenName).toBe("ajwain");
    expect(item.catalogId).toBe("117"); // resolves fine - being unpriced isn't being unknown
    expect(item.isCustom).toBe(false);
    expect(item.qty).toBeNull();
    expect(item.unit).toBe("");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(0);
    expect(item.priceType).toBe("unknown");
  });

  it("a bare item with no qty/price is never guessed, even when it resolves - 'saunth' (id 592, dry ginger) is a real catalog alias, not unrecognised as this test originally assumed; corrected during the KB-005b wiring pass (Rule 5b applies regardless of resolution, same as the 'ajwain' case above)", () => {
    const item = parseOne("saunth");
    expect(item.qty).toBeNull();
    expect(item.total).toBe(0);
    expect(item.priceType).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Hindi fractions - every one, against a real catalog product and unit.
// ---------------------------------------------------------------------------
describe("Hindi fractions", () => {
  it("aadha (0.5) - aadha kilo moong daal", () => {
    const entry = catalogEntry("18");
    const item = parseOne("aadha kilo moong daal");
    expect(item.qty).toBe(0.5);
    expect(item.total).toBe(lineTotalPaise(0.5, entry.suggestedPricePaise));
  });

  it("paav (0.25) - paav kilo chini", () => {
    const entry = catalogEntry("27");
    const item = parseOne("paav kilo chini");
    expect(item.qty).toBe(0.25);
    expect(item.total).toBe(lineTotalPaise(0.25, entry.suggestedPricePaise));
  });

  it("sawa (1.25, bare = sawa ek) - sawa kilo besan", () => {
    const entry = catalogEntry("4");
    const item = parseOne("sawa kilo besan");
    expect(item.qty).toBe(1.25);
    expect(item.total).toBe(lineTotalPaise(1.25, entry.suggestedPricePaise));
  });

  it("dedh (1.5, fixed) - dedh kilo toor daal", () => {
    const entry = catalogEntry("16");
    const item = parseOne("dedh kilo toor daal");
    expect(item.qty).toBe(1.5);
    expect(item.total).toBe(lineTotalPaise(1.5, entry.suggestedPricePaise));
  });

  it("dhai (2.5, fixed) - dhai kilo rajma", () => {
    const entry = catalogEntry("22");
    const item = parseOne("dhai kilo rajma");
    expect(item.qty).toBe(2.5);
    expect(item.total).toBe(lineTotalPaise(2.5, entry.suggestedPricePaise));
  });

  it("paune (0.75, bare = paune ek) - paune kilo besan", () => {
    const entry = catalogEntry("4");
    const item = parseOne("paune kilo besan");
    expect(item.qty).toBe(0.75);
    expect(item.total).toBe(lineTotalPaise(0.75, entry.suggestedPricePaise));
  });
});

// ---------------------------------------------------------------------------
// paune/chataak resolution (docs/14-LEGACY-REFERENCE.md section 3) -
// resolved explicitly here, not deferred.
// ---------------------------------------------------------------------------
describe("paune/chataak conflict - resolved", () => {
  it("paune is COMPOSITIONAL, not a fixed 0.75 - 'paune do' means 2 - 0.25 = 1.75, not 0.75", () => {
    const entry = catalogEntry("4");
    const item = parseOne("paune do kilo besan");
    expect(item.qty).toBe(1.75);
    expect(item.total).toBe(lineTotalPaise(1.75, entry.suggestedPricePaise));
  });

  it("bare paune still means paune ek (0.75) - the bug was ignoring a following number, not the bare form itself", () => {
    const item = parseOne("paune kilo besan");
    expect(item.qty).toBe(0.75);
  });

  it("sawa is given the same compositional treatment, for consistency - 'sawa teen' means 3 + 0.25 = 3.25", () => {
    const entry = catalogEntry("27");
    const item = parseOne("sawa teen kilo chini");
    expect(item.qty).toBe(3.25);
    expect(item.total).toBe(lineTotalPaise(3.25, entry.suggestedPricePaise));
  });

  it("chataak is a UNIT (1 chataak = 50g), not a fraction multiplier - the Gemini prompt's chataak=0.05 conflated the two", () => {
    const item = parseOne("paanch chataak namak 10 rupay");
    expect(item.catalogId).toBe("29"); // Namak
    expect(item.qty).toBe(250); // 5 chataak * 50g
    expect(item.unit).toBe("gm");
    expect(item.rate).toBeNull();
    expect(item.total).toBe(1000);
    expect(item.priceType).toBe("total");
  });

  it("the base chataak multiplier is exactly 50g - ek chataak namak 5 rupay", () => {
    const item = parseOne("ek chataak namak 5 rupay");
    expect(item.qty).toBe(50);
    expect(item.unit).toBe("gm");
  });
});

// ---------------------------------------------------------------------------
// Bail-out: return null on genuine structural ambiguity - never on a merely
// unknown or unpriced product (that's Rule 5b, and it never returns null).
// ---------------------------------------------------------------------------
describe("Bail-out - null on ambiguity, not on an unknown product", () => {
  it("two bare numbers, no wala/ka/ki, no unit - unclear which is qty and which is price", () => {
    expect(parseUtterance("chini 30 40", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("conflicting units in one line", () => {
    expect(parseUtterance("5 kg 3 liter chini 90 rupay", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("empty text", () => {
    expect(parseUtterance("", SEED_PARSER_CATALOG)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KB-005d / KI-21: an orphaned marker (wala/ka/rupay present, but its
// neighbouring word failed to parse as a number) must bail - not silently
// fall through to a confident default-price guess. Found by KB-006's
// number benchmark: these two utterances used to return a confident but
// wrong total (the Pilloo-class failure - a number silently wrong with no
// signal anything was off).
// ---------------------------------------------------------------------------
describe("Bail-out - orphaned wala/ka/rupay marker (KB-005d, KI-21)", () => {
  it("तीस misheard as पीस before 'ka' - used to return a confident ₹250 (5kg chawal's default price), now bails", () => {
    expect(parseUtterance("5 kg chawal पीस ka", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("दस misheard as दीस before 'rupay' - used to return a confident ₹20 (jeera's default price for 50gm), now bails", () => {
    expect(parseUtterance("50 gram jeera दीस rupay", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("orphaned 'ki' (total marker variant) bails the same way as 'ka'", () => {
    expect(parseUtterance("5 kg chawal पीस ki", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("orphaned 'wali' (rate marker variant) bails the same way as 'wala'", () => {
    expect(parseUtterance("5 kg chawal पीस wali", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("this is a structural check, not a hardcoded word list - any unrecognised word orphaning a marker bails, not just पीस/दीस", () => {
    expect(parseUtterance("5 kg chawal xyzzyword ka", SEED_PARSER_CATALOG)).toBeNull();
  });

  it("regression: a correctly-formed wala utterance is completely unaffected", () => {
    const item = parseOne("5 kg chawal 30 wala");
    expect(item.rate).toBe(3000);
    expect(item.total).toBe(15000);
  });

  it("regression: a correctly-formed ka utterance is completely unaffected", () => {
    const item = parseOne("5 kg chawal 30 ka");
    expect(item.total).toBe(3000);
  });

  it("regression: a correctly-formed rupay utterance is completely unaffected", () => {
    const item = parseOne("2 kilo chini 90 rupay");
    expect(item.total).toBe(9000);
  });
});

// ---------------------------------------------------------------------------
// KB-009 - diagnoseUtterance() reason categories, checked against the real
// bail cases already established above, and a self-consistency check
// against every utterance in both eval fixtures. This is what makes the
// diagnostic function trustworthy rather than a parallel implementation
// that could quietly drift from parseUtterance's real logic.
// ---------------------------------------------------------------------------
describe("diagnoseUtterance - reason categories match known bail cases", () => {
  it("empty text", () => {
    expect(diagnoseUtterance("", SEED_PARSER_CATALOG)).toEqual({ hit: false, reason: "empty utterance" });
  });

  it("orphaned marker (KI-21)", () => {
    expect(diagnoseUtterance("5 kg chawal पीस ka", SEED_PARSER_CATALOG)).toEqual({ hit: false, reason: "orphaned marker" });
    expect(diagnoseUtterance("50 gram jeera दीस rupay", SEED_PARSER_CATALOG)).toEqual({ hit: false, reason: "orphaned marker" });
  });

  it("ambiguous two-number utterance", () => {
    expect(diagnoseUtterance("chini 30 40", SEED_PARSER_CATALOG)).toEqual({ hit: false, reason: "ambiguous two-number utterance" });
  });

  it("too many numbers / conflicting units", () => {
    expect(diagnoseUtterance("5 kg 3 liter chini 90 rupay", SEED_PARSER_CATALOG)).toEqual({
      hit: false,
      reason: "too many numbers or conflicting units",
    });
  });

  it("a hit reports hit:true, reason:null", () => {
    expect(diagnoseUtterance("5 kg chawal 30 ka", SEED_PARSER_CATALOG)).toEqual({ hit: true, reason: null });
  });
});

describe("diagnoseUtterance - self-consistency with parseUtterance across every real fixture case", () => {
  const allUtterances: string[] = [
    ...(voiceCases as Array<{ utterance: string }>).map((c) => c.utterance),
    ...(numberBenchmarkCases as Array<{ utterance: string }>).map((c) => c.utterance),
  ];

  it("loaded both fixtures - 25 + 129 = 154 utterances (KB-005f added NB101-NB110, KB-302 NB111-NB129)", () => {
    expect(allUtterances).toHaveLength(154);
  });

  it("diagnoseUtterance().hit agrees with (parseUtterance() !== null) for every one of the 154 cases", () => {
    const disagreements: string[] = [];
    for (const utterance of allUtterances) {
      const diagnosticHit = diagnoseUtterance(utterance, SEED_PARSER_CATALOG).hit;
      const actualHit = parseUtterance(utterance, SEED_PARSER_CATALOG) !== null;
      if (diagnosticHit !== actualHit) {
        disagreements.push(`"${utterance}": diagnoseUtterance said hit=${diagnosticHit}, parseUtterance said hit=${actualHit}`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});

// KB-302 (owner, Option A): compound Hindi numbers. A multiplier word -
// sau/सौ (x100), hazaar/हज़ार/हजार (x1000) - combines ONLY with the number
// token immediately before it; nothing may sit in between. A thousands group
// immediately followed by a hundreds group adds (ek hazaar paanch sau = 1500).
// No lakh. Layer 1 and the number-safety checks share this tokenizer, so both
// are tested. Before this, "paanch sau gram chini" billed 100 gm for Rs.5 with
// no flag, and "do sau wala" silently dropped the "do".
describe("compound Hindi numbers - sau / hazaar", () => {
  describe("extractSpokenNumbers reads the composed number", () => {
    it.each([
      ["paanch sau gram chini", [500]],
      ["पांच सौ ग्राम चीनी", [500]],
      ["dhai sau gram chini", [250]],
      ["dedh sau gram chini", [150]],
      ["sawa sau gram chini", [125]],
      ["25 kilo chawal do hazaar ka", [25, 2000]],
      ["ek hazaar paanch sau gram chini", [1500]],
      ["5 सौ ग्राम चीनी", [500]],
      ["2 kilo rajma do sau wala", [2, 200]],
    ])("%s -> %j", (text, expected) => {
      expect(extractSpokenNumbers(text)).toEqual(expected);
    });

    it.each([
      ["sau kilo besan", [100]],
      ["teen packet surf excel sau wala", [3, 100]],
      ["2 kilo chini sau ka", [2, 100]],
    ])("must NOT combine across other words: %s -> %j", (text, expected) => {
      expect(extractSpokenNumbers(text)).toEqual(expected);
    });
  });

  describe("Layer 1 bills the composed number", () => {
    const chiniGrams = (qty: number, total: number) => ({ catalogId: "27", qty, unit: "gm", rate: 4500, rateUnit: "kg", total, priceType: "default" });

    it.each([
      ["paanch sau gram chini", chiniGrams(500, 2250)],
      ["पांच सौ ग्राम चीनी", chiniGrams(500, 2250)],
      ["dhai sau gram chini", chiniGrams(250, 1125)],
      ["dedh sau gram chini", chiniGrams(150, 675)],
      ["sawa sau gram chini", chiniGrams(125, 563)],
      ["ek hazaar paanch sau gram chini", chiniGrams(1500, 6750)],
      ["5 सौ ग्राम चीनी", chiniGrams(500, 2250)],
      ["25 kilo chawal do hazaar ka", { catalogId: "11", qty: 25, unit: "kg", rate: null, total: 200000, priceType: "total" }],
      ["2 kilo rajma do sau wala", { catalogId: "22", qty: 2, unit: "kg", rate: 20000, rateUnit: "kg", total: 40000, priceType: "rate" }],
    ])("%s", (text, expected) => {
      expect(parseOne(text)).toMatchObject(expected);
    });

    it.each([
      ["sau kilo besan", { catalogId: "4", qty: 100, unit: "kg", rate: 9000, total: 900000, priceType: "default" }],
      ["teen packet surf excel sau wala", { catalogId: "189", qty: 3, unit: "packet", rate: 10000, total: 30000, priceType: "rate" }],
      ["2 kilo chini sau ka", { catalogId: "27", qty: 2, unit: "kg", rate: null, total: 10000, priceType: "total" }],
    ])("must NOT change: %s", (text, expected) => {
      expect(parseOne(text)).toMatchObject(expected);
    });
  });
});

// KB-302 (owner, round 2): tens after a WHOLE hundreds/thousands group,
// paune/sawa before a multiplier multiply (¾ x 100, not 100 - 0.25), and
// saadhe N = N + 0.5 (was silently wrong: "saadhe teen kilo chini" billed 3 kg
// of an unmatched "saadhe chini").
describe("compound Hindi numbers - tens, paune/sawa, saadhe", () => {
  it.each([
    ["do sau pachas gram chini", [250]],
    ["5 kilo chini teen sau pachas ka", [5, 350]],
    ["ek hazaar do sau pachas gram chini", [1250]],
    ["hazaar ka", [1000]],
    ["paune sau gram chini", [75]],
    ["paune do sau gram chini", [175]],
    ["saadhe teen kilo chini", [3.5]],
    ["saadhe teen sau gram chini", [350]],
    ["साढ़े तीन किलो चीनी", [3.5]],
  ])("extractSpokenNumbers: %s -> %j", (text, expected) => {
    expect(extractSpokenNumbers(text)).toEqual(expected);
  });

  it("tens never compose after a fractional group: dhai sau pachas -> [250, 50], never 300", () => {
    expect(extractSpokenNumbers("dhai sau pachas")).toEqual([250, 50]);
  });

  it("guard: 'chini sau ka aur daal pachas ka' stays two items, ₹100 and ₹50", () => {
    const items = parseUtterance("chini sau ka aur daal pachas ka", SEED_PARSER_CATALOG);
    expect(items?.map((i) => i.total)).toEqual([10000, 5000]);
  });

  const chiniGrams = (qty: number, total: number) => ({ catalogId: "27", qty, unit: "gm", rate: 4500, rateUnit: "kg", total, priceType: "default" });
  it.each([
    ["do sau pachas gram chini", chiniGrams(250, 1125)],
    ["ek hazaar do sau pachas gram chini", chiniGrams(1250, 5625)],
    ["paune sau gram chini", chiniGrams(75, 338)],
    ["paune do sau gram chini", chiniGrams(175, 788)],
    ["saadhe teen sau gram chini", chiniGrams(350, 1575)],
    ["saadhe teen kilo chini", { catalogId: "27", qty: 3.5, unit: "kg", rate: 4500, total: 15750, priceType: "default" }],
    ["साढ़े तीन किलो चीनी", { catalogId: "27", qty: 3.5, unit: "kg", rate: 4500, total: 15750, priceType: "default" }],
    ["5 kilo chini teen sau pachas ka", { catalogId: "27", qty: 5, unit: "kg", rate: null, total: 35000, priceType: "total" }],
  ])("Layer 1: %s", (text, expected) => {
    expect(parseOne(text)).toMatchObject(expected);
  });
});
