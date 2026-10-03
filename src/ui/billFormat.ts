import type { ParsedItem } from "@/domain/grammar";
import { shownRate } from "@/domain/billEdit";
import { formatRupees, type Paise } from "@/domain/money";

// KB-301: how a bill line's numbers are SHOWN. No arithmetic here - every
// value comes from the domain; this only decides the text. 13-DESIGN.md §6c:
// an unknown value is "—", never 0 or ₹0 (₹0 means "free").

export const UNKNOWN = "—";

export function formatAmount(paise: Paise | null): string {
  return paise === null ? UNKNOWN : formatRupees(paise);
}

export function formatQty(qty: number | null): string {
  return qty === null ? UNKNOWN : String(qty);
}

/**
 * The rate, shown per the COARSER unit of its pair (SG-09, KB-303 - owner):
 * a per-gm catalog price shows per kg ("1 kilo ajwain" -> ₹500, never
 * ₹0.50/gm). Its unit is added only when a real conversion sits between the
 * rate and the line (D36): "500 gm chini" -> "₹45/kg". Same unit, or
 * interchangeable count units (packet vs piece, unitScale 0), shows plain
 * "₹60" (owner, 27 Sep 2026). An incompatible pair (unitScale null) should
 * never come out of the parser; if it does, the suffix is shown rather than
 * hiding a mismatch.
 */
export function formatRate(item: Pick<ParsedItem, "rate" | "rateUnit" | "unit">): string {
  const shown = shownRate(item);
  if (shown === null) return UNKNOWN;
  return shown.unit === null ? formatRupees(shown.paise) : `${formatRupees(shown.paise)}/${shown.unit}`;
}

/** A paise value as the rupee text an input starts from ("45", "12.50"). */
export function paiseText(paise: Paise | null): string {
  return paise === null ? "" : formatRupees(paise).replace("₹", "");
}
