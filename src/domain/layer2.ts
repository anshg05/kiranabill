/**
 * KB-302 - settling Layer 2 (Gemini) output before it can reach a bill
 * (docs/04-VOICE-PIPELINE.md section 4: "a parse response is a proposal, never
 * financial truth"). Owner decision Q5; closes docs/12-PARKED.md KI-34.
 *
 * Gemini's own `total`, its default `rate` and its `rateUnit` are never
 * trusted: the money on a settled line is re-derived here with the same D36
 * rules Layer 1 bills with (grammar.ts) - the rate carries its own unit,
 * totals are exact, and a default price is always the SHOP's (D4).
 *
 * Its own file (not validator.ts) because it needs grammar.ts's unitScale()
 * and grammar.ts already imports validator.ts - no import cycle.
 */
import type { ParsedItem } from "./grammar.js";
import { unitScale } from "./grammar.js";
import type { ParserCatalog } from "./catalogIndex.js";
import { lineTotalPaise, lineTotalPaiseScaled, type Paise } from "./money.js";
import type { ReviewFlag } from "./reviewFlags.js";

export interface SettledLine {
  readonly item: ParsedItem;
  /** What the bill shows: the shop entry's name for a matched line (owner,
   * Q5b), else what was spoken. `item.spokenName` keeps what was spoken. */
  readonly displayName: string;
}

export interface SettledLayer2 {
  readonly lines: readonly SettledLine[];
  /** One invalid_qty flag per quantity rejected by (c). */
  readonly flags: readonly ReviewFlag[];
}

/** (c) numeric(12,3): finite, > 0, below 10^9, at most 3 decimals. */
function isValidQty(qty: unknown): qty is number {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0 || qty >= 1e9) return false;
  const scaled = qty * 1000;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Hard rule 1: money is integer paise. Anything else is dropped, not rounded. */
function paiseOrNull(value: unknown): Paise | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function settleLayer2Items(items: readonly ParsedItem[], shop: ParserCatalog): SettledLayer2 {
  const flags: ReviewFlag[] = [];
  const lines = items.map((raw, index): SettledLine => {
    // (a) the product must exist in THIS shop's catalog - not merely in the slice.
    const entry = raw.catalogId ? shop.byId.get(raw.catalogId) : undefined;
    const match = entry
      ? { catalogId: entry.id, isCustom: false, matchStatus: raw.matchStatus === "ambiguous" ? ("ambiguous" as const) : ("matched" as const) }
      : { catalogId: null, isCustom: true, matchStatus: "none" as const };

    let qty: number | null = null;
    if (raw.qty !== null) {
      if (isValidQty(raw.qty)) qty = raw.qty;
      else {
        flags.push({
          id: `item-${index}-invalid_qty`,
          code: "invalid_qty",
          severity: "MEDIUM",
          message: `The quantity heard for "${raw.spokenName}" (${String(raw.qty)}) isn't valid — check it.`,
          itemIndex: index,
        });
      }
    }

    const base = { spokenName: raw.spokenName, ...match, qty, unit: raw.unit };
    const unknown: ParsedItem = { ...base, rate: null, rateUnit: null, total: null, priceType: "unknown" };
    const displayName = entry ? entry.displayName : raw.spokenName;

    if (raw.priceType === "default") {
      // A default price only exists for a product the shop actually has.
      if (!entry) return { item: unknown, displayName };
      const scale = unitScale(raw.unit || entry.unit, entry.unit);
      if (scale === null) return { item: { ...base, rate: null, rateUnit: null, total: null, priceType: "default" }, displayName };
      const rate = entry.suggestedPricePaise;
      return {
        item: { ...base, rate, rateUnit: entry.unit, total: qty === null ? null : lineTotalPaiseScaled(qty, rate, scale), priceType: "default" },
        displayName,
      };
    }

    if (raw.priceType === "rate") {
      // A spoken "wala" rate is per the spoken unit, read literally (D36, as grammar.ts).
      const unit = raw.unit || "piece";
      const rate = paiseOrNull(raw.rate);
      return {
        item: {
          ...base,
          unit,
          rate,
          rateUnit: rate === null ? null : unit,
          total: rate === null || qty === null ? null : lineTotalPaise(qty, rate),
          priceType: "rate",
        },
        displayName,
      };
    }

    if (raw.priceType === "total") {
      // The spoken total stands - it's checked against the transcript by the number flags.
      return { item: { ...base, rate: null, rateUnit: null, total: paiseOrNull(raw.total), priceType: "total" }, displayName };
    }

    return { item: unknown, displayName };
  });
  return { lines, flags };
}
