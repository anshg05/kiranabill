import type { BillEntry, PlacedFlag } from "./billEdit.js";
import { isEdited } from "./billEdit.js";
import type { ParsedItem, PriceType } from "./grammar.js";
import { sumPaise, type Paise } from "./money.js";
import type { ReviewCode, ReviewSeverity } from "./reviewFlags.js";

// KB-307 commit 2 (owner, 3 Oct 2026): what a finalised bill is made of -
// pure. data/finalise.ts writes it; the screen decides when Bill Banao is on.

/**
 * Decision 2: a receipt never carries a line without an amount. "price" - no
 * price at all: priceType "unknown" (a custom item; Rule 5b's bare "ajwain",
 * whose total of 0 means NO price, not a ₹0 price), or no total and no rate;
 * "quantity" - a rate but no qty, so no total. A real ₹0 (a rate, total or
 * default price) is an amount. Cleared only by a value - never by "Theek hai".
 */
export function amountNeeded(item: Pick<ParsedItem, "total" | "rate" | "qty" | "priceType">): "price" | "quantity" | null {
  if (item.priceType === "unknown") return "price";
  if (item.total !== null) return null;
  return item.rate !== null && item.qty === null ? "quantity" : "price";
}

/** The flags "Price needed" replaces on a line that needs an amount -
 * missing_total is HIGH and acknowledgeable, so leaving it would let "Theek
 * hai" pass an unpriced line; and one line must never be two checks. */
export const AMOUNT_SUPERSEDES: ReadonlySet<ReviewCode> = new Set<ReviewCode>(["missing_total", "incomplete_item"]);

/** The bill's flags as shown and counted: superseded codes dropped on lines that need an amount. */
export function visibleFlags<F extends Pick<PlacedFlag, "lineId" | "code">>(flags: readonly F[], entries: readonly BillEntry[]): F[] {
  const needing = new Set(entries.filter((e) => amountNeeded(e.item) !== null).map((e) => e.id));
  return flags.filter((f) => !(f.lineId !== null && needing.has(f.lineId) && AMOUNT_SUPERSEDES.has(f.code)));
}

/** A bill line as the screen holds it. */
export interface FinalLine extends BillEntry {
  readonly displayName: string;
  readonly source: "fastpath" | "voice" | "manual";
}

/** A flag as shown - placed, with whether the shopkeeper said "Theek hai". */
export type FinalFlag = Pick<PlacedFlag, "lineId" | "anchorLineId" | "code" | "severity"> & { readonly acknowledged: boolean };

/** bill_items.review_flags (owner): what the shopkeeper saw, and confirmed. */
export interface StoredReviewFlag {
  readonly code: ReviewCode;
  readonly severity: ReviewSeverity;
  readonly acknowledged: boolean;
}

/** One bill_items row, without the ids data/ adds. */
export interface FinalItem {
  readonly lineNo: number;
  /** The SHOP's product id (shop catalog entries are shop_products rows); null for a custom item. */
  readonly shopProductId: string | null;
  readonly displayName: string;
  readonly spokenName: string | null;
  readonly qty: number | null;
  readonly unit: string | null;
  readonly ratePaise: Paise | null;
  /** null exactly when ratePaise is (bill_items_rate_unit_iff_rate). */
  readonly rateUnit: string | null;
  readonly totalPaise: Paise;
  readonly priceType: PriceType;
  readonly source: FinalLine["source"];
  readonly reviewFlags: readonly StoredReviewFlag[];
  readonly wasEdited: boolean;
}

export type BuildResult = { readonly ok: true; readonly items: readonly FinalItem[]; readonly totalPaise: Paise } | { readonly ok: false; readonly error: string };

/**
 * The bill's items in bill order and its total. A bill-level flag (no line)
 * is stored on its anchor line - the utterance's last line, where it was shown.
 * Refuses an empty bill or a line without an amount (decision 2) - the screen
 * never offers Bill Banao then, and this is the guarantee behind it.
 */
export function buildFinalBill(lines: readonly FinalLine[], flags: readonly FinalFlag[]): BuildResult {
  if (lines.length === 0) return { ok: false, error: "The bill has no items" };
  const missing = lines.find((l) => amountNeeded(l.item) !== null);
  if (missing) return { ok: false, error: `${missing.displayName} needs a ${amountNeeded(missing.item)}` };
  const items = lines.map((line, i): FinalItem => {
    const { item } = line;
    return {
      lineNo: i + 1,
      shopProductId: item.catalogId,
      displayName: line.displayName,
      spokenName: item.spokenName || null,
      qty: item.qty,
      unit: item.unit || null,
      ratePaise: item.rate,
      rateUnit: item.rate === null ? null : (item.rateUnit ?? (item.unit || null)),
      totalPaise: item.total!,
      priceType: item.priceType,
      source: line.source,
      reviewFlags: flags
        .filter((f) => (f.lineId ?? f.anchorLineId) === line.id)
        .map((f) => ({ code: f.code, severity: f.severity, acknowledged: f.acknowledged })),
      wasEdited: isEdited(item, line.original),
    };
  });
  return { ok: true, items, totalPaise: sumPaise(items.map((i) => i.totalPaise)) };
}
