/**
 * KB-208 - Layer 3's confidence gate (docs/04-VOICE-PIPELINE.md section 5).
 * The 14-code review system explicitly deferred out of validator.ts
 * (KB-005b): 11 codes from legacy/validator.js's REVIEW_REASON_LABELS,
 * plus 3 new number-safety codes 14-LEGACY-REFERENCE.md section 7 names
 * as required but never implemented anywhere (number_dropped, qty_dropped,
 * number_unconsumed).
 *
 * Severity, resolved this session with no invented values:
 *  - 6 codes sourced directly from legacy/validator.js + 04-VOICE-PIPELINE.md
 *    section 5's own table: missing_name/missing_total/unusual_rate/
 *    unusual_total (HIGH), missing_rate (MEDIUM), unknown_product (LOW).
 *  - weak_match and incomplete_item resolved by cross-referencing section
 *    5's table against legacy's real trigger conditions (traced directly
 *    in legacy/validator.js, not guessed): both MEDIUM.
 *  - invalid_qty/invalid_unit/unit_mismatch: legacy silently substitutes a
 *    plausible-looking value when these trigger (qty->1, unit->fallback) -
 *    real conflict with hard rule 7 ("never auto-change a price or unit -
 *    suggest only"). Owner's explicit call: flag-only, never substitute,
 *    MEDIUM severity for all three, following FROM that behavior decision.
 *  - number_dropped/qty_dropped/number_unconsumed: no legacy source at
 *    all, new detection logic. Interpretation documented in
 *    reviewFlags.test.ts's file header, reviewed there before this file
 *    was written.
 *
 * "Never auto-change a price or unit" (hard rule 7) applies throughout:
 * this module only ever reads items and produces flags, never mutates a
 * ParsedItem.
 */

import type { ParsedItem } from "./grammar.js";
import { extractSpokenNumbers, extractSpokenNumberEntries, unitsAreCompatible, convertPriceBetweenUnits } from "./grammar.js";
import type { CatalogEntry } from "./catalog.js";
import { formatRupees, type Paise } from "./money.js";
import { getEffectivePrice, type LearningState } from "./learning.js";

export type ReviewCode =
  | "missing_name"
  | "missing_rate"
  | "missing_total"
  | "unknown_product"
  | "unusual_rate"
  | "unusual_total"
  | "weak_match"
  | "incomplete_item"
  | "invalid_qty"
  | "invalid_unit"
  | "unit_mismatch"
  | "number_dropped"
  | "qty_dropped"
  | "number_unconsumed";

export type ReviewSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface ReviewFlag {
  readonly id: string;
  readonly code: ReviewCode;
  readonly severity: ReviewSeverity;
  readonly message: string;
  /** null for a whole-bill-level flag (number_dropped/qty_dropped are not
   * tied to one specific line). */
  readonly itemIndex: number | null;
}

const RECOGNISED_UNITS = new Set([
  "kg", "gm", "liter", "ml", "piece", "packet", "dozen", "box", "bottle", "pouch", "bag", "can", "tin", "",
]);

const UNUSUAL_HIGH_MULTIPLE = 3;
const UNUSUAL_LOW_MULTIPLE = 0.2;
const NUMBER_MATCH_EPSILON = 0.001;

function push(
  flags: ReviewFlag[],
  id: string,
  code: ReviewCode,
  severity: ReviewSeverity,
  message: string,
  itemIndex: number | null,
): void {
  flags.push({ id, code, severity, message, itemIndex });
}

/** Removes at most one matching value (within a small float epsilon) from
 * a working multiset, returning whether a match was found. Mutates the
 * passed array in place - callers use a scratch copy. */
function consumeOne(pool: number[], value: number): boolean {
  const index = pool.findIndex((candidate) => Math.abs(candidate - value) < NUMBER_MATCH_EPSILON);
  if (index === -1) return false;
  pool.splice(index, 1);
  return true;
}

function itemConsumedNumbers(item: ParsedItem, includeQty: boolean): number[] {
  const values: number[] = [];
  if (includeQty && item.qty !== null) values.push(item.qty);
  if (item.rate !== null) values.push(item.rate / 100);
  if (item.total !== null) values.push(item.total / 100);
  return values;
}

export interface EvaluateReviewFlagsOptions {
  readonly learningState: LearningState;
  readonly nowMs: number;
}

export function evaluateReviewFlags(
  transcript: string,
  items: readonly ParsedItem[],
  catalog: readonly CatalogEntry[],
  opts?: EvaluateReviewFlagsOptions,
): readonly ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));

  items.forEach((item, index) => {
    const entry = item.catalogId ? catalogById.get(item.catalogId) : undefined;

    if (!item.spokenName.trim()) {
      push(flags, `item-${index}-missing_name`, "missing_name", "HIGH", "This item's name wasn't understood.", index);
    }

    if (item.priceType === "rate" && item.rate === null) {
      push(flags, `item-${index}-missing_rate`, "missing_rate", "MEDIUM", "A rate was expected for this line, but none was found.", index);
    }

    if (item.priceType !== "unknown" && item.total === null) {
      push(flags, `item-${index}-missing_total`, "missing_total", "HIGH", "This line's total couldn't be computed.", index);
    }

    if (item.catalogId === null) {
      push(flags, `item-${index}-unknown_product`, "unknown_product", "LOW", `"${item.spokenName}" isn't in your catalog yet — added anyway.`, index);
    }

    if (item.matchStatus === "ambiguous") {
      push(flags, `item-${index}-weak_match`, "weak_match", "MEDIUM", `"${item.spokenName}" matched more than one product — pick the right one.`, index);
    }

    if (item.priceType === "unknown") {
      push(flags, `item-${index}-incomplete_item`, "incomplete_item", "MEDIUM", `"${item.spokenName}" has no price yet — add one to include it.`, index);
    }

    if (item.qty !== null && item.qty <= 0) {
      push(flags, `item-${index}-invalid_qty`, "invalid_qty", "MEDIUM", `The quantity for "${item.spokenName}" doesn't look right (${item.qty}). Check?`, index);
    }

    if (item.unit && !RECOGNISED_UNITS.has(item.unit)) {
      push(flags, `item-${index}-invalid_unit`, "invalid_unit", "MEDIUM", `"${item.unit}" isn't a recognised unit for "${item.spokenName}". Check?`, index);
    }

    if (item.unit && entry && item.unit !== entry.unit && !unitsAreCompatible(item.unit, entry.unit)) {
      push(flags, `item-${index}-unit_mismatch`, "unit_mismatch", "MEDIUM", `"${item.unit}" doesn't match how "${entry.displayName}" is usually sold (${entry.unit}). Check?`, index);
    }

    if (item.rate !== null && entry) {
      const effectivePrice = effectivePriceInItemUnit(item, entry, opts);
      if (effectivePrice !== null && isOutsideBand(item.rate, effectivePrice)) {
        push(
          flags,
          `item-${index}-unusual_rate`,
          "unusual_rate",
          "HIGH",
          `Rate ${formatRupees(item.rate)}/${item.unit || entry.unit} — usually ${formatRupees(effectivePrice)}. Check?`,
          index,
        );
      }
    }

    // unusual_total is a check on a COMPUTED total (priceType "default" -
    // the catalog/shop price applied automatically, or "rate" - qty times
    // a spoken rate) - never on priceType "total", a spoken "ka"/"ki"
    // TOTAL override. KB-208's own real-data check caught this the hard
    // way: a spoken total is a deliberate shopkeeper statement (Rule 2 -
    // the pricing grammar's actual differentiator, e.g. "5 kg chawal 30
    // ka" = a real ₹30 override, not a mistake), never something to
    // second-guess against the catalog's default price. Flagging it would
    // have meant HIGH-flagging the differentiator's own canonical example.
    if (
      item.total !== null &&
      item.qty !== null &&
      item.qty > 0 &&
      entry &&
      (item.priceType === "default" || item.priceType === "rate")
    ) {
      const effectivePrice = effectivePriceInItemUnit(item, entry, opts);
      if (effectivePrice !== null) {
        const expectedTotal = Math.round(item.qty * effectivePrice);
        if (isOutsideBand(item.total, expectedTotal)) {
          push(
            flags,
            `item-${index}-unusual_total`,
            "unusual_total",
            "HIGH",
            `Total ${formatRupees(item.total)} — expected around ${formatRupees(expectedTotal)}. Check?`,
            index,
          );
        }
      }
    }
  });

  evaluateNumberSafety(transcript, items, flags);

  return flags;
}

/**
 * The shop's effective price for this item's product, expressed in the
 * unit the item ACTUALLY carries - not the catalog entry's own unit
 * blindly multiplied against a differently-scaled qty (the real bug
 * KB-208's own real-data check caught: "500 gram" multiplied straight
 * against a per-kg price, off by 1000x). Returns null when the item's
 * unit isn't convertible to the catalog entry's unit at all - unit_mismatch
 * already flags that separately; unusual_rate/unusual_total simply don't
 * apply when there's no sound basis for the comparison.
 */
function effectivePriceInItemUnit(
  item: ParsedItem,
  entry: CatalogEntry,
  opts: EvaluateReviewFlagsOptions | undefined,
): Paise | null {
  const priceInCatalogUnit = opts
    ? getEffectivePrice(opts.learningState, entry.id, entry.suggestedPricePaise, opts.nowMs)
    : entry.suggestedPricePaise;
  const targetUnit = item.unit || entry.unit;
  return convertPriceBetweenUnits(priceInCatalogUnit, entry.unit, targetUnit);
}

function isOutsideBand(actual: Paise, expected: Paise): boolean {
  if (expected <= 0) return false;
  return actual > expected * UNUSUAL_HIGH_MULTIPLE || actual < expected * UNUSUAL_LOW_MULTIPLE;
}

/**
 * number_dropped / qty_dropped / number_unconsumed. See
 * reviewFlags.test.ts's file header for the documented interpretation -
 * no legacy source exists for these three, only two one-line descriptions
 * each in 04-VOICE-PIPELINE.md section 5 / 14-LEGACY-REFERENCE.md
 * section 7.
 */
function evaluateNumberSafety(transcript: string, items: readonly ParsedItem[], flags: ReviewFlag[]): void {
  // Whole-bill pools: every number consumed by any item, in rupee terms.
  const allConsumed: number[] = [];
  const allConsumedQtyOnly: number[] = [];
  for (const item of items) {
    allConsumed.push(...itemConsumedNumbers(item, true));
    if (item.qty !== null) allConsumedQtyOnly.push(item.qty);
  }

  const spokenEntries = extractSpokenNumberEntries(transcript);

  // number_dropped: every spoken number, matched against every consumed
  // number across the whole bill.
  const dropPool = [...allConsumed];
  for (const entry of spokenEntries) {
    if (!consumeOne(dropPool, entry.value)) {
      push(
        flags,
        `bill-number_dropped-${entry.value}`,
        "number_dropped",
        "HIGH",
        `Heard "${entry.value}" but it doesn't appear on any line. Did you mean to add it?`,
        null,
      );
    }
  }

  // qty_dropped: spoken numbers that looked like a quantity (attached to a
  // unit word), matched only against items' actual qty values - a
  // stricter subset of number_dropped with a more specific message.
  const qtyPool = [...allConsumedQtyOnly];
  for (const entry of spokenEntries) {
    if (entry.attachedUnit === null) continue;
    if (!consumeOne(qtyPool, entry.value)) {
      push(
        flags,
        `bill-qty_dropped-${entry.value}`,
        "qty_dropped",
        "HIGH",
        `Heard a quantity of ${entry.value} but it's missing from the bill. Check?`,
        null,
      );
    }
  }

  // number_unconsumed: per-segment, only when "aur" segments align 1:1
  // with items - not computable otherwise (Layer 2/Gemini output makes no
  // such promise).
  //
  // number_dropped above is NOT a full substitute when this can't run -
  // real, confirmed gap, not just a scoping footnote: number_dropped only
  // detects an ORPHANED number (spoken somewhere, consumed nowhere). It is
  // blind to a CROSS-ITEM MISASSIGNMENT of numerically-identical values -
  // if two segments happen to speak the same numbers (e.g. two items both
  // "5 kilo, 90 rupay") and a parse bug attaches segment A's numbers to
  // item B instead, the whole-bill multiset still balances exactly (same
  // count, same values, nothing orphaned), so number_dropped stays silent
  // even though one item's real price is now silently attributed to
  // another - exactly the invisible-wrong-number failure mode this whole
  // system exists to catch. number_unconsumed's per-segment scoping is
  // what would catch it, by checking THIS segment's numbers landed in
  // THIS segment's own item, not just "some item somewhere." For Layer
  // 2/misaligned output, this specific risk class has no coverage from
  // either code - logged as docs/12-PARKED.md NI-26, not silently assumed
  // covered.
  const segments = transcript
    .split(/\baur\b/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === items.length) {
    segments.forEach((segment, index) => {
      const segmentNumbers = extractSpokenNumbers(segment);
      if (segmentNumbers.length < 2) return;
      const item = items[index]!;
      const pool = itemConsumedNumbers(item, true);
      const unconsumed = segmentNumbers.some((value) => !consumeOne(pool, value));
      if (unconsumed) {
        push(
          flags,
          `item-${index}-number_unconsumed`,
          "number_unconsumed",
          "HIGH",
          `Two numbers were heard for "${item.spokenName}" but only one was used. Check?`,
          index,
        );
      }
    });
  }
}

export function canFinalize(flags: readonly ReviewFlag[], acknowledgedIds: ReadonlySet<string>): boolean {
  return flags.every((flag) => flag.severity !== "HIGH" || acknowledgedIds.has(flag.id));
}
