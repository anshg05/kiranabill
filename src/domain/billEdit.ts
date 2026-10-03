import type { CatalogEntry } from "./catalog.js";
import { unitsAreCompatible, unitScale, type ParsedItem } from "./grammar.js";
import { lineTotalPaiseScaled, type Paise } from "./money.js";
import { evaluateReviewFlags, flagAcrossUtterances, type ReviewFlag } from "./reviewFlags.js";

/**
 * KB-303 - editing a bill line (owner, 1 Oct 2026). Pure: every function
 * takes a line and returns a new one, or the reason it can't.
 *
 * The hard rule: the app never changes a number itself. A value moves only
 * when the shopkeeper commits an edit; the one derived number is a line total
 * computed from numbers they typed (qty x rate, D36 exact arithmetic via
 * lineTotalPaiseScaled - no division, no float; no-division.test.ts scans this
 * file). Typed input is parsed from its text, never through a float, and is
 * rejected - never rounded - when it doesn't fit.
 *
 * What is editable (owner, decisions 1-3):
 *  - qty, on every line. A rate/default line's total follows; a spoken-total
 *    ("ka") line keeps the total the shopkeeper SAID; a qty-less D47 line needs
 *    a unit with it.
 *  - rate, on every line with a qty. Typed per the unit it is SHOWN in - the
 *    coarser of the pair (SG-09: kg / liter) - and stored per it, so Rs.455/kg
 *    on a gm line never has to become 45.5 paise/gm. The line becomes a rate line.
 *  - amount, only where there is no rate (a spoken total or an unpriced line) -
 *    otherwise the amount is qty x rate, and two sources of truth would conflict.
 *  - unit, only between compatible units (gm<->kg, ml<->liter, count<->count).
 *    The qty number stays; the rate keeps its own unit; the total follows.
 */

export type EditResult = { readonly ok: true; readonly item: ParsedItem } | { readonly ok: false; readonly error: string };
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** Owner: explicit upper limits, rejected with a message. */
export const MAX_QTY = 99_999;
export const MAX_RATE_PAISE = 1_00_000_00; // Rs.1,00,000
export const MAX_AMOUNT_PAISE = 10_00_000_00; // Rs.10,00,000

/** Every unit a line may carry, in the order the unit picker shows them. */
const BILL_UNITS = ["kg", "gm", "liter", "ml", "piece", "packet", "dozen", "box", "bottle", "pouch", "bag", "can", "tin"] as const;

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Owner: Devanagari digits are accepted - ०-९ read as 0-9. */
export function normalizeDigits(text: string): string {
  return [...text].map((ch) => {
    const d = DEVANAGARI_DIGITS.indexOf(ch);
    return d === -1 ? ch : String(d);
  }).join("");
}

/** "10000000" -> "1,00,00,000": Indian digit grouping, by string. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const pairs = head.replace(/\B(?=(\d{2})+$)/g, ",");
  return `${pairs},${digits.slice(-3)}`;
}

/** A whole-rupee paise limit as "₹1,00,000" - the limits are whole rupees. */
function rupeeLimit(maxPaise: number): string {
  return `₹${groupIndian(String(maxPaise).slice(0, -2))}`;
}

const NUMBER_TEXT = /^(\d+)(?:\.(\d+))?$/;

/** Rupees as typed ("12.50", "₹ 45", "१२.५०") -> exact integer paise. */
export function parseMoneyInput(text: string, maxPaise: number): ParseResult<Paise> {
  const match = NUMBER_TEXT.exec(normalizeDigits(text).replace(/₹/g, "").trim());
  if (!match) return { ok: false, error: "Enter an amount like 45 or 12.50" };
  const [, rupees, paiseDigits = ""] = match;
  if (paiseDigits.length > 2) return { ok: false, error: "At most 2 digits after the point" };
  const paise = Number(rupees) * 100 + Number(paiseDigits.padEnd(2, "0"));
  if (paise === 0) return { ok: false, error: "Must be more than ₹0" };
  if (paise > maxPaise) return { ok: false, error: `Too large — at most ${rupeeLimit(maxPaise)}` };
  return { ok: true, value: paise };
}

/** A quantity as typed ("2", "0.5", "१.५") - up to 3 decimals (numeric(12,3)). */
export function parseQtyInput(text: string): ParseResult<number> {
  const match = NUMBER_TEXT.exec(normalizeDigits(text).trim());
  if (!match) return { ok: false, error: "Enter a quantity like 2 or 0.5" };
  const [, whole, fraction = ""] = match;
  if (fraction.length > 3) return { ok: false, error: "At most 3 digits after the point" };
  const qty = Number(fraction ? `${whole}.${fraction}` : whole);
  if (qty === 0) return { ok: false, error: "Must be more than 0" };
  if (qty > MAX_QTY) return { ok: false, error: `Too large — at most ${groupIndian(String(MAX_QTY))}` };
  return { ok: true, value: qty };
}

/** gm -> kg, ml -> liter; every other unit is its own coarser unit. */
function coarserUnit(unit: string): string {
  if (unit === "gm") return "kg";
  if (unit === "ml") return "liter";
  return unit;
}

/**
 * SG-09 (owner): the rate as shown - per the coarser unit of its pair. A
 * per-gm catalog price (ajwain, 50 paise/gm) shows as Rs.500/kg. Multiplication
 * only. null when the line has no rate.
 */
export function displayRate(item: Pick<ParsedItem, "rate" | "rateUnit" | "unit">): { paise: Paise; unit: string } | null {
  if (item.rate === null) return null;
  const unit = item.rateUnit ?? item.unit;
  const shown = coarserUnit(unit);
  return { paise: shown === unit ? item.rate : item.rate * 1000, unit: shown };
}

/**
 * The rate as SHOWN (SG-09): displayRate's value, and its unit only when a
 * real conversion sits between the rate and the line (D36) - null means
 * "show it plain". Same unit, or interchangeable count units (unitScale 0),
 * is plain; an incompatible pair keeps its unit rather than hide a mismatch.
 * Shared by the screen (formatRate) and the receipt (KB-308).
 */
export function shownRate(item: Pick<ParsedItem, "rate" | "rateUnit" | "unit">): { paise: Paise; unit: string | null } | null {
  const shown = displayRate(item);
  if (shown === null) return null;
  if (item.rateUnit === null || !item.unit) return { paise: shown.paise, unit: null };
  return { paise: shown.paise, unit: unitScale(item.unit, shown.unit) === 0 ? null : shown.unit };
}

/** A rate line's total from its own qty, unit and rate; any other line keeps its total. */
function withDerivedTotal(item: ParsedItem): ParsedItem | null {
  if (item.rate === null || item.rateUnit === null) return item;
  if (item.qty === null) return { ...item, total: null };
  const scale = unitScale(item.unit, item.rateUnit);
  if (scale === null) return null;
  return { ...item, total: lineTotalPaiseScaled(item.qty, item.rate, scale) };
}

function isBillUnit(unit: string): boolean {
  return (BILL_UNITS as readonly string[]).includes(unit);
}

/** Edit the qty. `unit` is only for a line that has none yet (D47: qty "—"). */
export function editQty(item: ParsedItem, text: string, unit?: string): EditResult {
  const qty = parseQtyInput(text);
  if (!qty.ok) return qty;
  const lineUnit = item.unit || unit;
  if (!lineUnit || !isBillUnit(lineUnit)) return { ok: false, error: "Choose a unit" };
  const next = withDerivedTotal({ ...item, qty: qty.value, unit: lineUnit });
  if (!next) return { ok: false, error: `Can't use ${lineUnit} with a rate per ${item.rateUnit}` };
  return { ok: true, item: next };
}

/** Edit the rate - typed per the unit it is shown in (SG-09), stored per it. */
export function editRate(item: ParsedItem, text: string): EditResult {
  const rate = parseMoneyInput(text, MAX_RATE_PAISE);
  if (!rate.ok) return rate;
  if (item.qty === null || !item.unit) return { ok: false, error: "Enter the quantity first" };
  const rateUnit = coarserUnit(item.rateUnit ?? item.unit);
  const next = withDerivedTotal({ ...item, rate: rate.value, rateUnit, priceType: "rate" });
  if (!next) return { ok: false, error: `Can't use ${item.unit} with a rate per ${rateUnit}` };
  return { ok: true, item: next };
}

/** Edit the amount - only where no rate exists (owner, decision 1). */
export function editAmount(item: ParsedItem, text: string): EditResult {
  if (item.rate !== null) return { ok: false, error: "The amount follows qty × rate — change the rate instead" };
  const amount = parseMoneyInput(text, MAX_AMOUNT_PAISE);
  if (!amount.ok) return amount;
  return { ok: true, item: { ...item, total: amount.value, priceType: "total" } };
}

/** Edit the unit - only between compatible units (owner, decision 3). */
export function editUnit(item: ParsedItem, unit: string): EditResult {
  if (!isBillUnit(unit)) return { ok: false, error: `"${unit}" isn't a unit` };
  if (unit === item.unit) return { ok: true, item };
  if (item.unit && !unitsAreCompatible(item.unit, unit)) return { ok: false, error: `Can't change ${item.unit} to ${unit}` };
  const next = withDerivedTotal({ ...item, unit });
  if (!next) return { ok: false, error: `Can't use ${unit} with a rate per ${item.rateUnit}` };
  return { ok: true, item: next };
}

/** The units the picker offers: compatible ones; a line with no unit may take any. */
export function unitChoices(item: ParsedItem): string[] {
  return BILL_UNITS.filter((u) => !item.unit || unitsAreCompatible(item.unit, u));
}

/**
 * was_edited - the learning signal (08-LEARNING-ENGINE.md section 2): the
 * line's qty, unit, rate or amount differs from what was spoken. A rate is
 * compared as shown (Rs.500/kg == 50 paise/gm), so re-typing the same value,
 * or putting a line back as it was, is not a correction.
 */
export function isEdited(item: ParsedItem, original: ParsedItem): boolean {
  const a = displayRate(item);
  const b = displayRate(original);
  const sameRate = a === null || b === null ? a === b : a.paise === b.paise && a.unit === b.unit;
  return item.qty !== original.qty || item.unit !== original.unit || item.total !== original.total || !sameRate;
}

/** A line on the bill, with the utterance it came from and what was spoken. */
export interface BillEntry {
  readonly id: string;
  readonly utteranceId: number;
  readonly item: ParsedItem;
  /** As spoken - never changed; KB-307 reads it for learning. */
  readonly original: ParsedItem;
}

/** One utterance: its lines' ids (in order), what was said, and the flags the
 * voice pipeline raised for them (itemIndex relative to lineIds). */
export interface UtteranceRecord {
  readonly id: number;
  readonly lineIds: readonly string[];
  readonly flags: readonly ReviewFlag[];
  /** KB-304: shown above the utterance's bill-level flags ("Heard: ..."). */
  readonly transcript?: string;
}

/**
 * KB-304: a flag placed on the bill. A line flag has its `lineId`; a
 * bill-level flag (number_dropped, qty_dropped, number_misaligned - about the
 * utterance, not one line) has none, and is shown under `anchorLineId`, the
 * utterance's last line, with its `transcript`. `key` is what a "Theek hai" is
 * recorded against: the line (or the utterance's lines) AND their numbers -
 * stable when OTHER lines come and go, different once these numbers change.
 */
export interface PlacedFlag extends ReviewFlag {
  readonly lineId: string | null;
  readonly utteranceId: number | null;
  readonly anchorLineId: string;
  readonly transcript: string;
  readonly key: string;
}

/** A line's numbers - part of an acknowledgement's key. */
function fingerprint(item: ParsedItem): string {
  return JSON.stringify([item.qty, item.unit, item.rate, item.rateUnit, item.total]);
}

/** The key prefixes an edit to this line must clear (KB-304, owner: an
 * acknowledgement lapses on any edit to its line). */
export function acknowledgementScopes(lineId: string, utteranceId: number): readonly string[] {
  return [`${lineId}|`, `u${utteranceId}|`];
}

/**
 * The bill's flags after any edit or removal (KB-303), placed (KB-304).
 *  - An untouched utterance keeps exactly the flags the voice pipeline raised
 *    (Layer 2 settling, number alignment and all), re-based onto the bill.
 *  - An utterance with an edited or removed line is re-checked line by line -
 *    WITHOUT its transcript: the shopkeeper's numbers differ from the spoken
 *    ones on purpose, so the transcript number checks (number_dropped,
 *    qty_dropped, number_unconsumed, number_misaligned) would only raise false
 *    alarms. duplicate_line is recomputed, so removing one of two clears it.
 *  - Across utterances: MEDIUM already_on_bill (owner, decision 4).
 */
export function billFlags(entries: readonly BillEntry[], utterances: readonly UtteranceRecord[], catalog: readonly CatalogEntry[]): PlacedFlag[] {
  const billIndex = new Map(entries.map((e, i) => [e.id, i]));
  const entryOf = (id: string) => entries[billIndex.get(id)!]!;
  const flags: PlacedFlag[] = [];
  const place = (f: ReviewFlag, lineId: string | null, u: UtteranceRecord, present: readonly string[], id: string) => {
    const anchorLineId = lineId ?? present[present.length - 1]!;
    const key = lineId
      ? `${lineId}|${f.code}|${fingerprint(entryOf(lineId).item)}`
      : `u${u.id}|${f.id}|${present.map((p) => fingerprint(entryOf(p).item)).join("")}`;
    flags.push({ ...f, id, itemIndex: lineId ? billIndex.get(lineId)! : null, lineId, utteranceId: u.id, anchorLineId, transcript: u.transcript ?? "", key });
  };
  for (const u of utterances) {
    const present = u.lineIds.filter((id) => billIndex.has(id));
    if (present.length === 0) continue;
    const touched = present.length !== u.lineIds.length || present.some((id) => isEdited(entryOf(id).item, entryOf(id).original));
    if (!touched) {
      for (const f of u.flags) place(f, f.itemIndex === null ? null : u.lineIds[f.itemIndex]!, u, present, `u${u.id}-${f.id}`);
      continue;
    }
    const items = present.map((id) => entryOf(id).item);
    for (const f of evaluateReviewFlags("", items, catalog)) {
      place(f, f.itemIndex === null ? null : present[f.itemIndex]!, u, present, `u${u.id}-edited-${f.id}`);
    }
  }
  const byId = new Map(utterances.map((u) => [u.id, u]));
  for (const f of flagAcrossUtterances(entries, catalog)) {
    const line = entries[f.itemIndex!]!;
    const u = byId.get(line.utteranceId);
    flags.push({
      ...f,
      lineId: line.id,
      utteranceId: line.utteranceId,
      anchorLineId: line.id,
      transcript: u?.transcript ?? "",
      key: `${line.id}|${f.code}|${fingerprint(line.item)}`,
    });
  }
  return flags;
}

/** KB-304: the "N checks pending" count - HIGH flags not yet acknowledged
 * (the same rule as reviewFlags.canFinalize). */
export function pendingChecks(flags: readonly PlacedFlag[], acknowledged: ReadonlySet<string>): number {
  return flags.filter((f) => f.severity === "HIGH" && !acknowledged.has(f.key)).length;
}

/**
 * KB-305 (05 S3a): a catalog product added by hand - qty 1 at the SHOP's
 * price, through the same editQty as any edit (KB-303). Named by the
 * product, never by what was typed to find it: finalise must not learn a
 * typed fragment ("chi") as an alias (owner, decision 4).
 */
export function manualItem(entry: CatalogEntry): ParsedItem {
  const base: ParsedItem = {
    spokenName: entry.displayName,
    catalogId: entry.id,
    isCustom: false,
    matchStatus: "matched",
    qty: null,
    unit: "",
    rate: entry.suggestedPricePaise,
    rateUnit: entry.unit,
    total: null,
    priceType: "default",
  };
  const one = editQty(base, "1", entry.unit);
  // A catalog unit the bill can't use leaves qty "—" for the shopkeeper (never a guess).
  return one.ok ? one.item : base;
}

/**
 * KB-305 (owner, 2 Oct 2026): a product not in the catalog, by the name the
 * shopkeeper typed. Qty "—" AND unit "—" (KB-303: no qty without a unit),
 * price "—" - incomplete_item (MEDIUM) until filled. Only a bill line: the
 * product itself comes through L1 at finalise (08 section 3, KB-307+).
 */
export function customItem(name: string): ParsedItem {
  return {
    spokenName: name.trim(),
    catalogId: null,
    isCustom: true,
    matchStatus: "none",
    qty: null,
    unit: "",
    rate: null,
    rateUnit: null,
    total: null,
    priceType: "unknown",
  };
}
