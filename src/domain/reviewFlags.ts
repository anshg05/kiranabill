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
import { extractSpokenNumbers, extractSpokenNumberEntries, splitItemSegments, unitsAreCompatible, unitScale } from "./grammar.js";
import type { CatalogEntry } from "./catalog.js";
import { formatRupees, lineTotalPaiseScaled, paiseToRupeeNumber, type Paise } from "./money.js";
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
  | "number_unconsumed"
  | "number_misaligned"
  | "duplicate_line";

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
  // Transcript numbers are rupees; stored money is paise. A decimal shift,
  // not a division (KB-005f, no-division.test.ts).
  if (item.rate !== null) values.push(paiseToRupeeNumber(item.rate));
  if (item.total !== null) values.push(paiseToRupeeNumber(item.total));
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
      // KB-005f (D36): the rate is per item.rateUnit, the shop price per the
      // catalog unit. Compare them in one unit by scaling the FINER unit's
      // price UP by 1000 - multiplication only, never a per-gram price
      // rounded to whole paise (KI-30's basis).
      const shopPrice = shopPriceInCatalogUnit(entry, opts);
      const rateUnit = item.rateUnit ?? (item.unit || entry.unit);
      const scale = unitScale(rateUnit, entry.unit);
      if (scale !== null) {
        const actualComparable = scale === -3 ? item.rate * 1000 : item.rate;
        const expectedComparable = scale === 3 ? shopPrice * 1000 : shopPrice;
        if (isOutsideBand(actualComparable, expectedComparable)) {
          const usual = rateUnit === entry.unit ? formatRupees(shopPrice) : `${formatRupees(shopPrice)}/${entry.unit}`;
          push(
            flags,
            `item-${index}-unusual_rate`,
            "unusual_rate",
            "HIGH",
            `Rate ${formatRupees(item.rate)}/${rateUnit} — usually ${usual}. Check?`,
            index,
          );
        }
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
      // KB-005f (D36): the expected total is computed exactly - the spoken
      // qty times the shop price, shifted by 1000 across gm/kg or ml/liter,
      // half-up once (D11) - the same arithmetic grammar.ts bills with.
      // "500 gram chini" at 4500/kg expects Rs.22.50, not the old Rs.25.
      const scale = unitScale(item.unit || entry.unit, entry.unit);
      if (scale !== null) {
        const expectedTotal = lineTotalPaiseScaled(item.qty, shopPriceInCatalogUnit(entry, opts), scale);
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
  flagDuplicateLines(items, catalogById, flags);

  return flags;
}

/**
 * KB-317 commit 3 (KI-46, owner Q1: HIGH). Whisper can repeat a segment
 * ("दो किलो शक्कर दो किलो शक्कर ..."); every number is then consumed, so no
 * number check fires and the bill silently carries the item twice. A line
 * identical to an earlier one - same product (or, unmatched, the same spoken
 * name), qty, unit, rate and total - is FLAGGED on the repeat, never deduped:
 * the same item twice can be real (Rule 4), so the shopkeeper decides.
 */
function flagDuplicateLines(items: readonly ParsedItem[], catalogById: ReadonlyMap<string, CatalogEntry>, flags: ReviewFlag[]): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const who = item.catalogId !== null ? `id:${item.catalogId}` : `name:${item.spokenName.trim().toLowerCase()}`;
    const key = JSON.stringify([who, item.qty, item.unit, item.rate, item.rateUnit, item.total]);
    if (!seen.has(key)) {
      seen.add(key);
      return;
    }
    const name = (item.catalogId ? catalogById.get(item.catalogId)?.displayName : undefined) ?? item.spokenName;
    push(flags, `item-${index}-duplicate_line`, "duplicate_line", "HIGH", `"${name}" is on the bill twice, same quantity and price — said twice, or heard twice? Check.`, index);
  });
}

/**
 * The shop's effective price for this item's product, per the catalog
 * entry's OWN unit - learning.ts's confirmed price when there is one,
 * else the catalog default. Callers do the cross-unit comparison exactly
 * (KB-005f): unusual_rate scales the finer-unit price up by 1000,
 * unusual_total uses lineTotalPaiseScaled. This used to re-express the
 * price in the item's unit by dividing by 1000 and rounding to whole paise
 * - the same KI-30 basis error as grammar.ts ("expected ₹25" for 500 gm of
 * a 4500/kg product). Incompatible units: the callers skip the comparison
 * (unitScale() is null) - unit_mismatch already flags that separately.
 */
function shopPriceInCatalogUnit(entry: CatalogEntry, opts: EvaluateReviewFlagsOptions | undefined): Paise {
  return opts
    ? getEffectivePrice(opts.learningState, entry.id, entry.suggestedPricePaise, opts.nowMs)
    : entry.suggestedPricePaise;
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
  //
  // KB-317 (owner): the PARSER's own segments - grammar.ts splitItemSegments
  // (aur / और / comma), the one function, never a copy. This used to split on
  // "aur" alone, so on every Devanagari और or comma order the counts never
  // lined up and the check silently didn't run.
  const segments = splitItemSegments(transcript);

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

/**
 * KB-302 (owner, Q7) - closes the gap NI-26 describes for Layer 2 output:
 * a cross-item misassignment of numbers. The transcript's numbers are taken in
 * spoken order; walking the items in the order Gemini returned them, each
 * item's spoken-origin numbers must be found at positions AFTER every number
 * the previous item used (any order within one item). Earliest-match is
 * optimal, so a greedy walk is exact. Deliberately no segmentation on commas
 * or "aur" - Whisper drops commas, which would make it noisy exactly where
 * Layer 2 runs.
 *
 * An item's spoken-origin numbers: its qty; its rate on a "rate" line; its
 * total on a "total" line. A "default" line's rate and total come from the
 * catalog, not speech. A qty of exactly 1 that appears nowhere in the
 * transcript is treated as implied ("sabun 180 rupay" -> 1 piece), not as a
 * number that must be found.
 */
export function checkLayer2NumberOrder(transcript: string, items: readonly ParsedItem[]): ReviewFlag | null {
  const spoken = extractSpokenNumberEntries(transcript).map((e) => e.value);
  const used = new Array<boolean>(spoken.length).fill(false);
  let floor = -1; // positions must be > floor

  for (const item of items) {
    const needed: number[] = [];
    if (item.qty !== null && !(item.qty === 1 && !spoken.some((v) => Math.abs(v - 1) < NUMBER_MATCH_EPSILON))) {
      needed.push(item.qty);
    }
    if (item.priceType === "rate" && item.rate !== null) needed.push(paiseToRupeeNumber(item.rate));
    if (item.priceType === "total" && item.total !== null) needed.push(paiseToRupeeNumber(item.total));

    let itemMax = floor;
    for (const value of needed) {
      const at = spoken.findIndex((v, i) => i > floor && !used[i] && Math.abs(v - value) < NUMBER_MATCH_EPSILON);
      if (at === -1) {
        return {
          id: "bill-number_misaligned",
          code: "number_misaligned",
          severity: "HIGH",
          message: "Couldn't match every number to its item in what was said — check each line's numbers.",
          itemIndex: null,
        };
      }
      used[at] = true;
      itemMax = Math.max(itemMax, at);
    }
    floor = itemMax;
  }
  return null;
}
