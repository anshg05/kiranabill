import { describe, expect, it } from "vitest";
import { parseUtterance, diagnoseUtterance, extractSpokenNumbers, type ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { lineTotalPaise } from "./money";
import { matchProduct } from "./validator";

/**
 * KB-317 commit 2 - Layer 1 on REAL input: Whisper's Devanagari (language
 * "hi", D44). Every utterance below is either verbatim from the owner's real
 * recordings (eval/real-transcripts.json, RT01-RT25) or a spelling variant
 * the owner listed. Expected products and prices are the owner's (29 Sep
 * 2026): आटा = Chakki Aata, साबुन = generic Sabun (614), शक्कर = Chini, दाल and
 * तूर/तुवर/तूअर/अरहर = Toor Daal (16), चना = Kala Chana (24), मूंग दाल = Moong
 * Daal (18), मसूर दाल = Masoor Daal (19).
 */

const parse = (text: string) => parseUtterance(text, SEED_PARSER_CATALOG);

function parseOne(text: string): ParsedItem {
  const items = parse(text);
  expect(items, `expected one item for "${text}", got null (bailed)`).not.toBeNull();
  expect(items!, `expected one item for "${text}"`).toHaveLength(1);
  return items![0]!;
}

// Same-unit lines only; a cross-unit line (gm of a per-kg product) states its total.
const byDefault = (catalogId: string, qty: number, unit: string, rate: number, rateUnit = unit, total = lineTotalPaise(qty, rate)) => ({
  catalogId, qty, unit, rate, rateUnit, total, priceType: "default",
});

// ---------------------------------------------------------------------------
// Markers and currency in Devanagari - का/की/के = total, वाला/वाले/वाली/वला =
// rate, रुपए/रुपये/रुपया = currency. They are markers, never part of the name.
// ---------------------------------------------------------------------------
describe("Devanagari markers - never part of the spoken name", () => {
  it("5 किलो चावल 30 का -> total Rs.30 (Rule 2, 04 section 3 note); name is 'चावल', not 'चावल का'", () => {
    expect(parseOne("5 किलो चावल 30 का")).toMatchObject({
      spokenName: "चावल", catalogId: "11", qty: 5, unit: "kg", rate: null, total: 3000, priceType: "total",
    });
  });

  it.each([
    ["2 किलो चीनी 100 की", { catalogId: "27", qty: 2, unit: "kg", total: 10000, priceType: "total" }],
    ["2 किलो चीनी 100 के", { catalogId: "27", qty: 2, unit: "kg", total: 10000, priceType: "total" }],
  ])("%s -> total", (text, expected) => {
    expect(parseOne(text)).toMatchObject(expected);
  });

  it.each([
    ["3 पारले जी 10 वाला"],
    ["3 पारले जी 10 वाले"],
    ["3 पारले जी 10 वाली"],
    ["3 पारलेजी 10 वला"],
  ])("%s -> Parle-G 10 x3 at Rs.10 each (rate)", (text) => {
    expect(parseOne(text)).toMatchObject({ catalogId: "52", qty: 3, rate: 1000, total: 3000, priceType: "rate" });
  });

  it.each([["साबुन 180 रुपए"], ["साबुन 180 रुपये"], ["साबुन 180 रुपया"]])(
    "%s -> generic Sabun (614), qty empty (D47), Rs.180",
    (text) => {
      expect(parseOne(text)).toMatchObject({
        spokenName: "साबुन", catalogId: "614", qty: null, unit: "", rate: null, total: 18000, priceType: "total",
      });
    },
  );

  it("2 किलो चीनी 12.50 रुपए -> total 1250 paise (the literal the owner asked for in the decimal fix)", () => {
    expect(parseOne("2 किलो चीनी 12.50 रुपए")).toMatchObject({ catalogId: "27", qty: 2, total: 1250, priceType: "total" });
  });

  it.each([
    ["no marker leaks: चावल का / चीनी की / चीनी के", "5 किलो चावल 30 का", "चावल"],
    ["", "2 किलो चीनी 100 की", "चीनी"],
    ["", "3 पारले जी 10 वाला", "पारले जी"],
    ["", "साबुन 180 रुपए", "साबुन"],
  ])("%s %s -> spokenName %s", (_label, text, name) => {
    expect(parseOne(text).spokenName).toBe(name);
  });
});

// ---------------------------------------------------------------------------
// D47 (supersedes D13 point 1): only a total spoken -> qty null, unit "".
// ---------------------------------------------------------------------------
describe("D47 - only a total spoken -> qty stays empty, never 1", () => {
  it.each([
    ["ajwain 10 ki", "117", 1000],
    ["namak दस ka", "29", 1000],
    ["साबुन 180 रुपए", "614", 18000],
  ])("%s -> catalog %s, qty null, unit '', total as spoken", (text, id, total) => {
    expect(parseOne(text)).toMatchObject({ catalogId: id, qty: null, unit: "", rate: null, total, priceType: "total" });
  });

  it("a spoken qty is still kept: 1 kilo besan 85 rupay -> qty 1 kg (it WAS said)", () => {
    expect(parseOne("1 kilo besan 85 rupay")).toMatchObject({ catalogId: "4", qty: 1, unit: "kg", total: 8500 });
  });
});

// ---------------------------------------------------------------------------
// Units in Devanagari.
// ---------------------------------------------------------------------------
describe("Devanagari units", () => {
  it.each([
    ["1 लिटर तेल", byDefault("33", 1, "liter", 13000)],
    ["1 लीटर तेल", byDefault("33", 1, "liter", 13000)],
    ["एक पैकेट सर्फ एक्सल", { catalogId: "189", qty: 1, unit: "packet", rate: 6000, total: 6000, priceType: "default" }],
    ["500 ग्राम जीरा", byDefault("104", 500, "gm", 40000, "kg", 20000)],
  ])("%s", (text, expected) => {
    expect(parseOne(text)).toMatchObject(expected);
  });
});

// ---------------------------------------------------------------------------
// Fraction words - every spelling Whisper produces (owner: ड vs ढ are
// different letters; nukta normalisation alone doesn't cover them). RT25:
// "साड़े तीन किलो चावल" read [3] and raised 3 false HIGH flags.
// ---------------------------------------------------------------------------
describe("fraction and number word spellings", () => {
  it.each([
    ["साढ़े तीन किलो चावल", [3.5]],
    ["साड़े तीन किलो चावल", [3.5]],
    ["साढे तीन किलो चावल", [3.5]],
    ["साडे तीन किलो चावल", [3.5]],
    ["डेढ़ किलो चीनी", [1.5]],
    ["डेड़ किलो चीनी", [1.5]],
    ["डेढ किलो चीनी", [1.5]],
    ["ढाई किलो चीनी", [2.5]],
    ["ढाइ किलो चीनी", [2.5]],
    ["डाई किलो चीनी", [2.5]],
    ["पौने दो किलो चीनी", [1.75]],
    ["पोने दो किलो चीनी", [1.75]],
    ["सवा दो किलो चीनी", [2.25]],
    ["आधा किलो बेसन", [0.5]],
    ["पाँच किलो चीनी", [5]],
  ])("extractSpokenNumbers: %s -> %j", (text, expected) => {
    expect(extractSpokenNumbers(text)).toEqual(expected);
  });

  it.each([
    ["साड़े तीन किलो चावल", byDefault("11", 3.5, "kg", 5000)],
    ["साडे तीन किलो चावल", byDefault("11", 3.5, "kg", 5000)],
    ["डेड़ किलो चीनी", byDefault("27", 1.5, "kg", 4500)],
    ["डाई किलो चीनी", byDefault("27", 2.5, "kg", 4500)],
    ["पोने दो किलो चीनी", byDefault("27", 1.75, "kg", 4500)],
    ["सवा दो किलो चीनी", byDefault("27", 2.25, "kg", 4500)],
    ["आधा किलो बेशन", byDefault("4", 0.5, "kg", 9000)],
  ])("Layer 1: %s", (text, expected) => {
    expect(parseOne(text)).toMatchObject(expected);
  });
});

// ---------------------------------------------------------------------------
// Nukta: फ़ुटाना (catalog) = फुटाना (Whisper), both directions.
// ---------------------------------------------------------------------------
describe("nukta normalisation", () => {
  it.each([["एक किलो फुटाना"], ["एक किलो फ़ुटाना"]])("%s -> Futana (609)", (text) => {
    expect(parseOne(text)).toMatchObject(byDefault("609", 1, "kg", 9000));
  });
});

// ---------------------------------------------------------------------------
// KI-44: a number word glued to wala.
// ---------------------------------------------------------------------------
describe("KI-44 - number glued to wala", () => {
  it.each([["3 पारलेजी दसवाला"], ["3 parle g daswala"]])("%s -> Parle-G 10 x3 at Rs.10", (text) => {
    expect(parseOne(text)).toMatchObject({ catalogId: "52", qty: 3, rate: 1000, total: 3000, priceType: "rate" });
  });

  it.each([["दसवाला", [10]], ["3 पारलेजी दसवाला", [3, 10]]])("extractSpokenNumbers: %s -> %j", (text, expected) => {
    expect(extractSpokenNumbers(text)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Segmenting: और and commas separate items, like "aur". If ANY segment lacks a
// product or a number, the whole utterance is a miss (owner) - never a line
// silently dropped or merged.
// ---------------------------------------------------------------------------
describe("segmenting on और and commas", () => {
  it("2 किलो चीनी और 3 पार लेजी 10 वाला (RT01) -> two lines", () => {
    expect(parse("2 किलो चीनी और 3 पार लेजी 10 वाला")).toMatchObject([
      byDefault("27", 2, "kg", 4500),
      { catalogId: "52", qty: 3, rate: 1000, total: 3000, priceType: "rate" },
    ]);
  });

  it("5 किलो आटा, 2 किलो दाल, 1 लिटर तेल -> three lines (Chakki Aata, Toor Daal, Tel)", () => {
    expect(parse("5 किलो आटा, 2 किलो दाल, 1 लिटर तेल")).toMatchObject([
      byDefault("2", 5, "kg", 3800),
      byDefault("16", 2, "kg", 9000),
      byDefault("33", 1, "liter", 13000),
    ]);
  });

  it("5 किलो चीनी, 3 पारलेजी दसवाला और 2 किलो बेशन (RT05) -> three lines, comma and और together", () => {
    expect(parse("5 किलो चीनी, 3 पारलेजी दसवाला और 2 किलो बेशन")).toMatchObject([
      byDefault("27", 5, "kg", 4500),
      { catalogId: "52", qty: 3, total: 3000, priceType: "rate" },
      byDefault("4", 2, "kg", 9000),
    ]);
  });

  it("3.5 किलो चावल और 250 ग्राम जीरा (RT19) -> Chawal Rs.175 + Jeera Rs.100", () => {
    expect(parse("3.5 किलो चावल और 250 ग्राम जीरा")).toMatchObject([
      byDefault("11", 3.5, "kg", 5000),
      byDefault("104", 250, "gm", 40000, "kg", 10000),
    ]);
  });

  it("Latin commas split too: 2 kilo chini, 3 kilo chawal -> two lines", () => {
    expect(parse("2 kilo chini, 3 kilo chawal")).toMatchObject([byDefault("27", 2, "kg", 4500), byDefault("11", 3, "kg", 5000)]);
  });

  it.each([
    ["चीनी, 2 किलो"],
    ["2 किलो चीनी, चावल"],
    ["2 किलो चीनी और चावल"],
    ["2 किलो, 3 किलो चावल"],
  ])("%s -> miss: a segment lacks a product or a number", (text) => {
    expect(parse(text)).toBeNull();
    expect(diagnoseUtterance(text, SEED_PARSER_CATALOG).hit).toBe(false);
  });

  it("existing 'aur' behaviour unchanged: chini sau ka aur daal pachas ka -> Rs.100, Rs.50", () => {
    expect(parse("chini sau ka aur daal pachas ka")?.map((i) => i.total)).toEqual([10000, 5000]);
  });

  // RT07 (no separator at all) stays a miss at the voice level - the hit rule
  // and the HIGH number flags (eval/real-transcripts.test.ts); here, the
  // number check still hears all four numbers.
  it("no separator at all (RT07): every number is still heard", () => {
    expect(extractSpokenNumbers("2 किलो चीनी 3 पालेजी 10 वाला 1 किलो बेसन")).toEqual([2, 3, 10, 1]);
  });

  it.each([
    ["3.5 किलो चावल और 250 ग्राम जीरा", [3.5, 250]],
    ["5 किलो आटा, 2 किलो दाल, 1 लिटर तेल", [5, 2, 1]],
  ])("extractSpokenNumbers segments the same way: %s -> %j", (text, expected) => {
    expect(extractSpokenNumbers(text)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Product names as Whisper writes them - the owner's rulings plus the
// misspellings in the real recordings. The catalog's display name is what
// the bill shows (data/voiceBilling.ts); here, the catalog id is what counts.
// ---------------------------------------------------------------------------
describe("product names as Whisper writes them", () => {
  it.each([
    ["एक किलो आटा", "2"], // Chakki Aata, never गेहूं (owner)
    ["एक किलो गेहूं", "1"], // गेहूं itself still reaches गेहूं
    ["2 किलो शक्कर", "27"], // Chini (owner)
    ["2 kilo shakkar", "27"], // was a Chini / Desi Shakkar tie
    ["2 किलो देशी शक्कर", "32"], // Desi Shakkar only when "desi" is said
    ["2 किलो बेशन", "4"],
    ["2 किलो बेसन", "4"],
    ["3 पार लेजी", "52"],
    ["3 पारलेजी", "52"],
    ["3 पालेजी", "52"],
    ["3 पारले जी", "52"],
    ["250 ग्राम चायपत्ती", "89"],
    ["250 ग्राम चाय पत्ती", "89"],
    ["एक पैकेट सर्फ एक्सल", "189"],
    ["दो मैगी", "81"],
    ["2 किलो दाल", "16"], // generic dal = Toor Daal (owner)
    ["1 किलो तूर दाल", "16"],
    ["1 किलो तुवर दाल", "16"],
    ["1 किलो तूअर दाल", "16"],
    ["1 किलो तूअल दाल", "16"], // Whisper's ल for र (RT23)
    ["1 किलो अरहर दाल", "16"], // same pulse (owner)
    ["1 किलो मूंग दाल", "18"], // split Moong Daal, not whole Moong (625)
    ["1 किलो मुंग दाल", "18"],
    ["1 किलो मसूर दाल", "19"], // split Masoor Daal, not Khadi (623)
    ["1 किलो मसूल दाल", "19"],
    ["1 किलो चना", "24"], // Kala Chana (owner)
    ["1 किलो देशी चना", "24"],
    ["1 किलो बरवटी दाल", "629"],
    ["1 किलो बरबटी दाल", "629"],
  ])("%s -> catalog id %s", (text, id) => {
    expect(parseOne(text).catalogId).toBe(id);
  });

  // Must NOT match - a looser reading of Devanagari must never land on a
  // near-name in another category, or on a brand nobody said.
  it.each([
    ["2 किलो चीनी", "27"], // not Dalchini, not Madhur Chini
    ["1 लिटर सरसों तेल", "34"], // Sarson Tel, not Surf
    ["1 किलो काबुली चना", "23"], // Kabuli only when said
    ["1 किलो खड़ा मसूर", "623"], // Khadi only when said
    ["नहाने का साबुन 30 रुपए", "160"], // Bath Sabun when "bath" is said
  ])("must-not-match: %s -> %s", (text, id) => {
    const items = parse(text);
    expect(items?.[0]?.catalogId ?? null).toBe(id);
  });

  // का/की/के are markers only straight after a number; inside a name they stay.
  it.each([
    ["1 लिटर सरसों का तेल", byDefault("34", 1, "liter", 14500)],
    ["नहाने का साबुन 30 रुपए", { catalogId: "160", qty: null, total: 3000, priceType: "total" }],
    ["2 किलो चने का आटा", byDefault("4", 2, "kg", 9000)],
  ])("का inside a name is not a marker: %s", (text, expected) => {
    expect(parseOne(text)).toMatchObject(expected);
  });

  // दालचीनी contains "दाल"; the category guard used to read it as a dal and
  // reject Dalchini (KI-55). It must never land on दाल or चीनी - and now it
  // lands on Dalchini itself.
  it("100 ग्राम दालचीनी never lands on Toor Daal, Chini or Madhur Chini", () => {
    expect(["16", "27", "340"]).not.toContain(parse("100 ग्राम दालचीनी")?.[0]?.catalogId ?? null);
  });

  it("100 ग्राम दालचीनी -> Dalchini (115), Rs.100 (KI-55)", () => {
    expect(parseOne("100 ग्राम दालचीनी")).toMatchObject({ catalogId: "115", qty: 100, unit: "gm", total: 10000 });
  });

  it.each([["2 किलो पालक"], ["2 किलो बेल"], ["एक सरसों"]])("no false product: %s never lands on Parle-G / Besan / Surf", (text) => {
    const id = parse(text)?.[0]?.catalogId ?? null;
    expect(["52", "4", "189", "188"]).not.toContain(id);
  });
});

// ---------------------------------------------------------------------------
// KB-317 (owner, 29 Sep 2026): general spelling folds, not one alias per
// misspelling - catalogIndex.ts foldDevanagariSpelling, on catalog AND query.
// Measured on every real Whisper spelling seen and every catalog alias.
// ---------------------------------------------------------------------------
describe("spelling folds - the same word however Whisper spells it", () => {
  it.each([
    ["साबून 180 रुपए", "614"], // ू/ु - the owner's 29 Sep run
    ["आधा किलो बेशन", "4"], // श -> स (no alias any more)
    ["1 किलो मुंग दाल", "18"], // ु/ू
    ["1 किलो देशी चना", "24"], // श -> स
    ["1 किलो बरवटी दाल", "629"], // व -> ब
    ["1 किलो तूअर दाल", "16"], // ू/ु onto तुअर दाल
    ["3 परलेजी 10 वाला", "52"], // its own alias - no fold reaches a moved word boundary
  ])("%s -> %s", (text, id) => {
    expect(parseOne(text).catalogId).toBe(id);
  });

  // ा is NOT folded: measured, it turned these two into ties.
  it.each([["ताज़ा", "92"], ["तज", "115"]])("unfolded ा keeps %s on %s", (name, id) => {
    expect(matchProduct(name, { index: SEED_PARSER_CATALOG.index })).toMatchObject({ kind: "matched", catalogId: id });
  });

  // KI-55 (owner: fixed inside KB-317): the six aliases the category guard
  // sent to ANOTHER product (Maggi Masala -> Maggi Masala Mix, मूंग दाल नमकीन ->
  // Moong Daal, ...) - the list is now empty and must stay empty.
  it("every alias of every active catalog product lands on its own product or on none - never on another", () => {
    const wrong: string[] = [];
    for (const entry of SEED_PARSER_CATALOG.entries) {
      for (const alias of [entry.displayName, ...entry.aliases]) {
        const outcome = matchProduct(alias, { index: SEED_PARSER_CATALOG.index });
        if (outcome.kind === "matched" && outcome.catalogId !== entry.id) wrong.push(`${alias} (${entry.id}) -> ${outcome.catalogId}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("currency spellings (owner, 29 Sep 2026)", () => {
  it.each([["साबुन 180 रुपे"], ["साबुन 180 रु"], ["साबुन 180 रूपये"]])("%s -> Sabun, Rs.180 total, qty empty", (text) => {
    expect(parseOne(text)).toMatchObject({ catalogId: "614", qty: null, total: 18000, priceType: "total" });
  });
});
