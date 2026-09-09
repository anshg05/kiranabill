/**
 * Money is always an integer number of paise - never a float, never rupees,
 * never NUMERIC. See docs/07-DECISIONS.md D1 and D11, docs/03-DATA-MODEL.md
 * section 8.
 */
export type Paise = number;

/**
 * Rounds an exact integer "milli-paise" value (paise * 1000) to the nearest
 * whole paise, HALF-UP (docs/07-DECISIONS.md D11 - not banker's rounding).
 *
 * Implemented with string slicing, not division, so a genuine half-paise tie
 * (e.g. 0.5 kg at a rate ending in an odd half-paise) can never be pushed the
 * wrong way by floating-point division error. See money.no-float.test.ts.
 */
function roundMilliPaiseHalfUp(milliPaise: number): number {
  const sign = milliPaise < 0 ? -1 : 1;
  const digits = String(Math.abs(milliPaise)).padStart(4, "0");
  const whole = Number(digits.slice(0, -3));
  const thousandths = Number(digits.slice(-3));
  return sign * (thousandths >= 500 ? whole + 1 : whole);
}

/**
 * Computes a line total in integer paise from a quantity (up to 3 decimal
 * places, e.g. 0.5 kg - matches numeric(12,3) in docs/03-DATA-MODEL.md) and
 * an integer per-unit rate in paise. Rounds once, half-up, at the line.
 */
export function lineTotalPaise(qty: number, ratePaise: number): Paise {
  const qtyMilliUnits = Math.round(qty * 1000); // qty has <=3 decimals by contract
  const milliPaise = qtyMilliUnits * ratePaise; // exact integer product
  return roundMilliPaiseHalfUp(milliPaise);
}

/**
 * Sums already-rounded line totals. Never re-rounds the sum - re-rounding is
 * the predecessor's bug (docs/03-DATA-MODEL.md section 8): 10.60 + 10.60,
 * rounded per line AND on the sum, displayed as 11 + 11 = 21 - lines that
 * visibly don't add up.
 */
export function sumPaise(lineTotals: readonly Paise[]): Paise {
  return lineTotals.reduce((total, line) => total + line, 0);
}

/**
 * Converts a rupee price (as found in legacy/products.js, at most 2 decimal
 * places) to integer paise, half-up. Used once, at catalog-seed time
 * (scripts/build-catalog-seed.ts) - never at runtime, because runtime money
 * is always already paise.
 */
export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/**
 * Formats paise for display: whole rupees by default, paise shown only when
 * non-zero (docs/03-DATA-MODEL.md section 8; docs/13-DESIGN.md section 6c).
 *
 * Splits on the decimal string rather than `paise / 100`, per
 * docs/07-DECISIONS.md D11's no-float-in-money-paths rule - see
 * money.no-float.test.ts, which asserts this file never divides.
 */
export function formatRupees(paise: Paise): string {
  const sign = paise < 0 ? "-" : "";
  const digits = String(Math.abs(paise)).padStart(3, "0");
  const rupees = digits.slice(0, -2);
  const paiseRemainder = digits.slice(-2);
  return paiseRemainder === "00" ? `${sign}₹${rupees}` : `${sign}₹${rupees}.${paiseRemainder}`;
}
