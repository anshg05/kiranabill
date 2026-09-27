import type { ParsedItem } from "@/domain/grammar";
import { unitScale } from "@/domain/grammar";
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
 * The rate, with its unit only when a real conversion sits between the rate
 * and the line (D36): "500 gm chini" at ₹45/kg shows "₹45/kg". Same unit, or
 * interchangeable count units (packet vs piece, unitScale 0), shows plain
 * "₹60" (owner, 27 Sep 2026). An incompatible pair (unitScale null) should
 * never come out of the parser; if it does, the suffix is shown rather than
 * hiding a mismatch.
 */
export function formatRate(item: Pick<ParsedItem, "rate" | "rateUnit" | "unit">): string {
  if (item.rate === null) return UNKNOWN;
  const plain = formatRupees(item.rate);
  if (item.rateUnit === null) return plain;
  return unitScale(item.unit, item.rateUnit) === 0 ? plain : `${plain}/${item.rateUnit}`;
}
