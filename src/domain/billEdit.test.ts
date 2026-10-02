import { describe, expect, it } from "vitest";
import { parseUtterance, type ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { evaluateReviewFlags, type ReviewFlag } from "./reviewFlags";
import {
  billFlags,
  customItem,
  manualItem,
  displayRate,
  editAmount,
  editQty,
  editRate,
  editUnit,
  isEdited,
  MAX_AMOUNT_PAISE,
  MAX_QTY,
  MAX_RATE_PAISE,
  normalizeDigits,
  parseMoneyInput,
  parseQtyInput,
  pendingChecks,
  unitChoices,
  type BillEntry,
  type UtteranceRecord,
} from "./billEdit";

// KB-303 (owner, 1 Oct 2026): editing a bill line. Every line under test is
// REAL parseUtterance() output (D39). The app never changes a number itself -
// a value moves only on the shopkeeper's edit; the one derived number is a
// total computed from numbers they typed (qty x rate, D36 exact arithmetic).

function one(text: string): ParsedItem {
  const items = parseUtterance(text, SEED_PARSER_CATALOG);
  if (!items || items.length !== 1) throw new Error(`"${text}" did not parse to one line`);
  return items[0]!;
}

function ok(r: { ok: true; item: ParsedItem } | { ok: false; error: string }): ParsedItem {
  if (!r.ok) throw new Error(`expected ok, got "${r.error}"`);
  return r.item;
}

// ---------------------------------------------------------------------------
// Typed input: parsed exactly from the text - never through a float for money.
// ---------------------------------------------------------------------------
describe("typed input", () => {
  it("Devanagari digits read as ASCII: १२.५० -> 12.50", () => {
    expect(normalizeDigits("१२.५०")).toBe("12.50");
    expect(normalizeDigits("०१२३४५६७८९")).toBe("0123456789");
  });

  it.each([
    ["12.50", 1250],
    ["12.5", 1250],
    ["१२.५०", 1250],
    ["45", 4500],
    ["₹ 45", 4500],
    [" 0.05 ", 5],
    ["100000", 10_000_000],
  ])("money %j -> %i paise", (text, paise) => {
    expect(parseMoneyInput(text, MAX_RATE_PAISE)).toEqual({ ok: true, value: paise });
  });

  it.each([
    ["", "Enter an amount like 45 or 12.50"],
    ["abc", "Enter an amount like 45 or 12.50"],
    ["-3", "Enter an amount like 45 or 12.50"],
    ["1e3", "Enter an amount like 45 or 12.50"],
    ["1,5", "Enter an amount like 45 or 12.50"],
    ["12.505", "At most 2 digits after the point"],
    ["0", "Must be more than ₹0"],
    ["0.00", "Must be more than ₹0"],
    ["100000.01", "Too large — at most ₹1,00,000"],
  ])("money %j is rejected, never rounded: %s", (text, error) => {
    expect(parseMoneyInput(text, MAX_RATE_PAISE)).toEqual({ ok: false, error });
  });

  it("the amount limit is its own: ₹10,00,000", () => {
    expect(MAX_AMOUNT_PAISE).toBe(1_000_000_00);
    expect(parseMoneyInput("1000000", MAX_AMOUNT_PAISE)).toEqual({ ok: true, value: 100_000_000 });
    expect(parseMoneyInput("1000000.01", MAX_AMOUNT_PAISE)).toEqual({ ok: false, error: "Too large — at most ₹10,00,000" });
  });

  it.each([
    ["2", 2],
    ["0.5", 0.5],
    ["2.125", 2.125],
    ["१.५", 1.5],
    ["99999", 99_999],
  ])("qty %j -> %d", (text, qty) => {
    expect(parseQtyInput(text)).toEqual({ ok: true, value: qty });
  });

  it.each([
    ["", "Enter a quantity like 2 or 0.5"],
    ["x", "Enter a quantity like 2 or 0.5"],
    ["-1", "Enter a quantity like 2 or 0.5"],
    ["2.1255", "At most 3 digits after the point"],
    ["0", "Must be more than 0"],
    ["100000", "Too large — at most 99,999"],
  ])("qty %j is rejected: %s", (text, error) => {
    expect(parseQtyInput(text)).toEqual({ ok: false, error });
    expect(MAX_QTY).toBe(99_999);
  });
});

// ---------------------------------------------------------------------------
// SG-09 (owner): a rate is SHOWN per the coarser unit of its pair (kg / liter).
// ---------------------------------------------------------------------------
describe("SG-09 - rates shown per the coarser unit", () => {
  it.each([
    ["500 gram chini", { paise: 4500, unit: "kg" }], // already per kg
    ["1 kilo ajwain", { paise: 50000, unit: "kg" }], // catalog 50 paise/gm -> Rs.500/kg
    ["250 gram ajwain", { paise: 50000, unit: "kg" }],
    ["Surf Excel ek packet", { paise: 6000, unit: "piece" }], // count units: as is
  ])("%s -> %j", (text, expected) => {
    expect(displayRate(one(text))).toEqual(expected);
  });

  it("a total-only line has no rate to show", () => {
    expect(displayRate(one("5 kg chawal 30 ka"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Editing qty.
// ---------------------------------------------------------------------------
describe("edit qty", () => {
  it("default (catalog price): the total follows - 2 kilo chini -> 3 kg = Rs.135", () => {
    expect(ok(editQty(one("2 kilo chini"), "3"))).toMatchObject({ qty: 3, unit: "kg", rate: 4500, total: 13500, priceType: "default" });
  });

  it("cross-unit default, exact (D36): 500 gram chini -> 750 gm = Rs.33.75", () => {
    expect(ok(editQty(one("500 gram chini"), "750"))).toMatchObject({ qty: 750, unit: "gm", rate: 4500, rateUnit: "kg", total: 3375 });
  });

  it("rate line ('wala'): the total follows - 2 kilo rajma do sau wala -> 3 kg = Rs.600", () => {
    expect(ok(editQty(one("2 kilo rajma do sau wala"), "3"))).toMatchObject({ qty: 3, rate: 20000, total: 60000, priceType: "rate" });
  });

  it("spoken total ('ka'): the total the shopkeeper SAID stays - 5 kg chawal 30 ka -> 6 kg, still Rs.30, no rate", () => {
    expect(ok(editQty(one("5 kg chawal 30 ka"), "6"))).toMatchObject({ qty: 6, rate: null, total: 3000, priceType: "total" });
  });

  it("D47 line (qty '—'): a qty needs a unit - refused without one", () => {
    const sabun = one("sabun 180 rupay");
    expect(sabun).toMatchObject({ qty: null, unit: "" });
    expect(editQty(sabun, "2")).toEqual({ ok: false, error: "Choose a unit" });
  });

  it("D47 line: qty + unit filled, the spoken total stays, no rate derived", () => {
    expect(ok(editQty(one("sabun 180 rupay"), "2", "piece"))).toMatchObject({ qty: 2, unit: "piece", rate: null, total: 18000, priceType: "total" });
  });

  it("bad input: refused with the message, the line untouched", () => {
    expect(editQty(one("2 kilo chini"), "2.1255")).toEqual({ ok: false, error: "At most 3 digits after the point" });
  });
});

// ---------------------------------------------------------------------------
// Editing the rate - typed per the SHOWN (coarser) unit, stored per it.
// ---------------------------------------------------------------------------
describe("edit rate", () => {
  it("default -> rate line: 2 kilo chini at Rs.50/kg = Rs.100", () => {
    expect(ok(editRate(one("2 kilo chini"), "50"))).toMatchObject({ rate: 5000, rateUnit: "kg", total: 10000, priceType: "rate" });
  });

  it("SG-09 storage: Rs.455/kg typed on a gm line is stored per kg (45.5 paise/gm can't be stored) - 500 gram chini = Rs.227.50", () => {
    expect(ok(editRate(one("500 gram chini"), "455"))).toMatchObject({ qty: 500, unit: "gm", rate: 45500, rateUnit: "kg", total: 22750 });
  });

  it("SG-09 storage: 1 kilo ajwain (catalog per gm) typed Rs.600 -> stored per kg, Rs.600", () => {
    expect(ok(editRate(one("1 kilo ajwain"), "600"))).toMatchObject({ rate: 60000, rateUnit: "kg", total: 60000 });
  });

  it("a rate on a spoken-total line makes it a rate line - the shopkeeper's explicit act", () => {
    expect(ok(editRate(one("5 kg chawal 30 ka"), "40"))).toMatchObject({ qty: 5, rate: 4000, rateUnit: "kg", total: 20000, priceType: "rate" });
  });

  it("paise are exact: Rs.12.50 on 2 kg = Rs.25", () => {
    expect(ok(editRate(one("2 kilo chini"), "12.50"))).toMatchObject({ rate: 1250, total: 2500 });
  });

  it("no qty yet (D47): refused - 'Enter the quantity first'", () => {
    expect(editRate(one("sabun 180 rupay"), "10")).toEqual({ ok: false, error: "Enter the quantity first" });
  });

  it("above ₹1,00,000: refused", () => {
    expect(editRate(one("2 kilo chini"), "100001")).toEqual({ ok: false, error: "Too large — at most ₹1,00,000" });
  });
});

// ---------------------------------------------------------------------------
// Editing the amount - only where no rate exists (owner, decision 1).
// ---------------------------------------------------------------------------
describe("edit amount", () => {
  it("a rate/default line's amount follows qty x rate - not editable", () => {
    expect(editAmount(one("2 kilo chini"), "100")).toEqual({ ok: false, error: "The amount follows qty × rate — change the rate instead" });
  });

  it("spoken-total line: the amount can be corrected", () => {
    expect(ok(editAmount(one("5 kg chawal 30 ka"), "250"))).toMatchObject({ qty: 5, rate: null, total: 25000, priceType: "total" });
  });

  it("an unpriced line (Rule 5b 'ajwain'): the amount fills it - becomes a total line", () => {
    const ajwain = one("ajwain");
    expect(ajwain).toMatchObject({ qty: null, rate: null, priceType: "unknown" }); // Rule 5b (its total is 0 - nothing added)
    expect(ok(editAmount(ajwain, "20"))).toMatchObject({ qty: null, rate: null, total: 2000, priceType: "total" });
  });
});

// ---------------------------------------------------------------------------
// Editing the unit - only between compatible units (owner, decision 3).
// ---------------------------------------------------------------------------
describe("edit unit", () => {
  it("kg -> gm on 2 kilo chini: the qty number stays, the rate keeps its own unit, the total follows (2 gm = 9 paise)", () => {
    expect(ok(editUnit(one("2 kilo chini"), "gm"))).toMatchObject({ qty: 2, unit: "gm", rate: 4500, rateUnit: "kg", total: 9 });
  });

  it("packet -> piece (count units): allowed, same total", () => {
    expect(ok(editUnit(one("Surf Excel ek packet"), "piece"))).toMatchObject({ unit: "piece", total: 6000 });
  });

  it("an incompatible change (kg -> piece) is refused", () => {
    expect(editUnit(one("2 kilo chini"), "piece")).toEqual({ ok: false, error: "Can't change kg to piece" });
  });

  it("a spoken-total line keeps its total when the unit changes", () => {
    expect(ok(editUnit(one("5 kg chawal 30 ka"), "gm"))).toMatchObject({ qty: 5, unit: "gm", total: 3000 });
  });

  it("choices: only compatible units; a line with no unit may take any", () => {
    expect(unitChoices(one("2 kilo chini"))).toEqual(["kg", "gm"]);
    expect(unitChoices(one("1 litre tel"))).toEqual(["liter", "ml"]);
    expect(unitChoices(one("Surf Excel ek packet"))).toEqual(["piece", "packet", "dozen", "box", "bottle", "pouch", "bag", "can", "tin"]);
    expect(unitChoices(one("sabun 180 rupay"))).toContain("kg");
    expect(unitChoices(one("sabun 180 rupay"))).toContain("piece");
  });
});

// ---------------------------------------------------------------------------
// was_edited - the learning signal (08 section 2): the line differs from what
// was spoken. Put back as it was -> not a correction.
// ---------------------------------------------------------------------------
describe("isEdited", () => {
  it("untouched -> false; edited -> true; edited back to the original -> false", () => {
    const chini = one("2 kilo chini");
    expect(isEdited(chini, chini)).toBe(false);
    const three = ok(editQty(chini, "3"));
    expect(isEdited(three, chini)).toBe(true);
    expect(isEdited(ok(editQty(three, "2")), chini)).toBe(false);
  });

  it("a rate re-typed at the same value per kg is not a correction (ajwain Rs.500/kg == 50 paise/gm)", () => {
    const ajwain = one("1 kilo ajwain");
    const retyped = ok(editRate(ajwain, "500"));
    expect(retyped).toMatchObject({ rate: 50000, rateUnit: "kg" });
    expect(isEdited({ ...retyped, priceType: ajwain.priceType }, ajwain)).toBe(false);
  });

  it("a unit change is an edit (L4)", () => {
    const chini = one("2 kilo chini");
    expect(isEdited(ok(editUnit(chini, "gm")), chini)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The bill's flags after edits and removals.
// ---------------------------------------------------------------------------
describe("billFlags", () => {
  // One utterance, as the screen stores it: its lines' ids and the flags the
  // voice pipeline raised for them (itemIndex relative to the utterance).
  function utterance(id: number, transcript: string, lineIds: string[]): { record: UtteranceRecord; entries: BillEntry[] } {
    const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
    const flags = evaluateReviewFlags(transcript, items, SEED_PARSER_CATALOG.entries);
    return {
      record: { id, lineIds, flags },
      entries: items.map((item, i) => ({ id: lineIds[i]!, utteranceId: id, item, original: item })),
    };
  }
  const codes = (flags: readonly ReviewFlag[]) => flags.map((f) => `${f.severity} ${f.code}@${f.itemIndex}`);

  it("an untouched utterance keeps the flags the voice pipeline raised, re-based onto the bill", () => {
    const u = utterance(1, "दो किलो चीनी, दो किलो चीनी", ["a", "b"]);
    const flags = billFlags(u.entries, [u.record], SEED_PARSER_CATALOG.entries);
    expect(codes(flags)).toEqual(["HIGH duplicate_line@1"]);
    expect(flags[0]!.id).toBe("u1-item-1-duplicate_line");
  });

  it("removing one of the two duplicates clears duplicate_line", () => {
    const u = utterance(1, "दो किलो चीनी, दो किलो चीनी", ["a", "b"]);
    expect(billFlags(u.entries.slice(0, 1), [u.record], SEED_PARSER_CATALOG.entries)).toEqual([]);
  });

  it("an edited utterance drops its transcript number checks - the shopkeeper's numbers differ from the spoken ones on purpose", () => {
    const u = utterance(1, "2 kilo chini", ["a"]);
    const record = { ...u.record, flags: [{ id: "bill-number_dropped-7", code: "number_dropped" as const, severity: "HIGH" as const, message: "x", itemIndex: null }] };
    expect(codes(billFlags(u.entries, [record], SEED_PARSER_CATALOG.entries))).toEqual(["HIGH number_dropped@null"]); // untouched: kept
    const edited = [{ ...u.entries[0]!, item: ok(editQty(u.entries[0]!.item, "3")) }];
    expect(billFlags(edited, [record], SEED_PARSER_CATALOG.entries)).toEqual([]);
  });

  it("an edited line is still checked on its own: a Rs.5/kg rate on chini -> HIGH unusual_rate and unusual_total (Rs.10 vs ~Rs.90)", () => {
    const u = utterance(1, "2 kilo chini", ["a"]);
    const edited = [{ ...u.entries[0]!, item: ok(editRate(u.entries[0]!.item, "5")) }];
    expect(codes(billFlags(edited, [u.record], SEED_PARSER_CATALOG.entries))).toEqual(["HIGH unusual_rate@0", "HIGH unusual_total@0"]);
  });

  it("the same line said again in ANOTHER utterance -> MEDIUM already_on_bill on the later one (owner, decision 4)", () => {
    const first = utterance(1, "2 kilo chini", ["a"]);
    const second = utterance(2, "2 kilo chini", ["b"]);
    const flags = billFlags([...first.entries, ...second.entries], [first.record, second.record], SEED_PARSER_CATALOG.entries);
    expect(codes(flags)).toEqual(["MEDIUM already_on_bill@1"]);
    expect(flags[0]!.message).toContain("Chini");
    // removing the second clears it
    expect(billFlags(first.entries, [first.record, second.record], SEED_PARSER_CATALOG.entries)).toEqual([]);
  });

  // KB-304: where a flag belongs, and the key a "Theek hai" is recorded against.
  it("KB-304: a line flag names its line and utterance; a bill-level flag names only its utterance", () => {
    const u = utterance(1, "1 kilo besan", ["a"]);
    const record = { ...u.record, flags: [{ id: "bill-number_dropped-7", code: "number_dropped" as const, severity: "HIGH" as const, message: "x", itemIndex: null }] };
    const dup = utterance(2, "दो किलो चीनी, दो किलो चीनी", ["b", "c"]);
    const flags = billFlags([...u.entries, ...dup.entries], [record, dup.record], SEED_PARSER_CATALOG.entries);
    expect(flags.map((f) => [f.code, f.lineId, f.utteranceId])).toEqual([
      ["number_dropped", null, 1],
      ["duplicate_line", "c", 2],
    ]);
  });

  it("KB-304: a flag's key survives another line's removal, and changes when its OWN line is edited", () => {
    const first = utterance(1, "1 kilo besan", ["a"]);
    const cheap = utterance(2, "2 kilo chini 5 wala", ["b"]); // HIGH unusual_rate
    const keyOf = (entries: BillEntry[]) =>
      billFlags(entries, [first.record, cheap.record], SEED_PARSER_CATALOG.entries).find((f) => f.code === "unusual_rate")!.key;
    const before = keyOf([...first.entries, ...cheap.entries]);
    expect(keyOf(cheap.entries)).toBe(before); // besan removed: same key
    const edited = [{ ...cheap.entries[0]!, item: ok(editRate(cheap.entries[0]!.item, "6")) }]; // still unusual
    expect(keyOf(edited)).not.toBe(before);
  });

  it("KB-304: pendingChecks counts unacknowledged HIGH flags only", () => {
    const first = utterance(1, "2 kilo chini 5 wala", ["a"]); // HIGH unusual_rate + unusual_total
    const second = utterance(2, "2 kilo chini 5 wala", ["b"]); // + MEDIUM already_on_bill
    const flags = billFlags([...first.entries, ...second.entries], [first.record, second.record], SEED_PARSER_CATALOG.entries);
    expect(flags.filter((f) => f.severity === "HIGH")).toHaveLength(4);
    expect(pendingChecks(flags, new Set())).toBe(4);
    expect(pendingChecks(flags, new Set([flags[0]!.key]))).toBe(3);
  });

  it("a different qty in another utterance is not 'already on the bill'", () => {
    const first = utterance(1, "2 kilo chini", ["a"]);
    const second = utterance(2, "3 kilo chini", ["b"]);
    expect(billFlags([...first.entries, ...second.entries], [first.record, second.record], SEED_PARSER_CATALOG.entries)).toEqual([]);
  });
});

// KB-305 (owner, 2 Oct 2026): a line added by hand. A catalog pick is qty 1 at
// the SHOP's price (05 S3a), through the same editQty as KB-303. A custom item
// is qty "—" AND unit "—" (KB-303: no qty without a unit), price "—".
describe("KB-305 - lines added by hand", () => {
  const entry = (id: string) => SEED_PARSER_CATALOG.byId.get(id)!;

  it("catalog pick: Chini -> 1 kg at ₹45, total ₹45, named by the product (never the typed fragment)", () => {
    expect(manualItem(entry("27"))).toEqual({
      spokenName: "Chini", catalogId: "27", isCustom: false, matchStatus: "matched",
      qty: 1, unit: "kg", rate: 4500, rateUnit: "kg", total: 4500, priceType: "default",
    });
  });

  it("then edited like any line: 500 gm -> ₹22.50 exactly (D36)", () => {
    const gm = editUnit(manualItem(entry("27")), "gm");
    if (!gm.ok) throw new Error(gm.error);
    const half = editQty(gm.item, "500");
    expect(half.ok && half.item.total).toBe(2250);
  });

  it("every active seed product gives a qty-1 line whose total is its own price", () => {
    for (const e of SEED_PARSER_CATALOG.entries) {
      const item = manualItem(e);
      expect([e.displayName, item.qty, item.unit, item.total]).toEqual([e.displayName, 1, e.unit, e.suggestedPricePaise]);
    }
  });

  it("a catalog pick at the shop's price raises no flag", () => {
    expect(evaluateReviewFlags("", [manualItem(entry("27"))], SEED_PARSER_CATALOG.entries)).toEqual([]);
  });

  it("custom item: the typed name, qty '—', unit '—', price '—'", () => {
    expect(customItem("  kuch naya  ")).toEqual({
      spokenName: "kuch naya", catalogId: null, isCustom: true, matchStatus: "none",
      qty: null, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown",
    });
  });

  it("custom item flags: LOW unknown_product + MEDIUM incomplete_item - never HIGH, never blocks", () => {
    const flags = evaluateReviewFlags("", [customItem("kuch naya")], SEED_PARSER_CATALOG.entries);
    expect(flags.map((f) => [f.severity, f.code]).sort()).toEqual([["LOW", "unknown_product"], ["MEDIUM", "incomplete_item"]]);
  });

  it("custom item: no qty without a unit (KB-303); unit, qty, rate -> incomplete_item clears", () => {
    const item = customItem("kuch naya");
    expect(editQty(item, "2")).toEqual({ ok: false, error: "Choose a unit" });
    const kg = editUnit(item, "kg");
    if (!kg.ok) throw new Error(kg.error);
    const two = editQty(kg.item, "२"); // Devanagari digit
    if (!two.ok) throw new Error(two.error);
    const priced = editRate(two.item, "60");
    if (!priced.ok) throw new Error(priced.error);
    expect(priced.item).toMatchObject({ qty: 2, unit: "kg", rate: 6000, total: 12000 });
    expect(evaluateReviewFlags("", [priced.item], SEED_PARSER_CATALOG.entries).map((f) => f.code)).toEqual(["unknown_product"]);
  });
});
