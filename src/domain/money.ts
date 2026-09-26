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
  return roundHalfUpAtPowerOfTen(milliPaise, 3);
}

/**
 * Rounds an exact integer that represents (value x 10^places) to the
 * nearest whole value, HALF-UP. Same string-slicing technique as always
 * (never a division - see money.no-float.test.ts and no-division.test.ts),
 * generalised from 3 places so KB-005f's cross-unit totals can round at
 * 10^6 exactly. Callers keep the integer below Number.MAX_SAFE_INTEGER
 * (~9 x 10^15) - see lineTotalPaiseScaled.
 */
function roundHalfUpAtPowerOfTen(scaled: number, places: number): number {
  const sign = scaled < 0 ? -1 : 1;
  const digits = String(Math.abs(scaled)).padStart(places + 1, "0");
  const whole = Number(digits.slice(0, -places));
  const remainder = digits.slice(-places);
  const halfway = "5".padEnd(places, "0");
  return sign * (remainder >= halfway ? whole + 1 : whole);
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
 * KB-005f (docs/07-DECISIONS.md D36, docs/12-PARKED.md KI-30): a line total
 * when the quantity's unit and the rate's unit differ by a factor of 1000
 * (gm<->kg, ml<->liter). `scale` is the power of ten that converts the
 * quantity into the rate's unit - grammar.ts's unitScale() decides it; this
 * file only does arithmetic, and never imports grammar.ts.
 *
 *   scale  0: same unit                     -> lineTotalPaise(qty, rate)
 *   scale -3: qty in gm/ml, rate per kg/liter -> qty x rate / 10^3
 *   scale +3: qty in kg/liter, rate per gm/ml -> qty x rate x 10^3
 *
 * Exact in every case, rounded half-up ONCE at the line (D11) - never via a
 * per-gram rate rounded to whole paise (KI-30: "500 gram chini" at 4500
 * paise/kg billed 2500, not 2250). qtyMilli x rate must stay below
 * ~9 x 10^15: e.g. 1,000,000 gm (a tonne) at 1,00,00,000 paise/kg is
 * 10^9 x 10^7 = 10^16 - past it, but no kirana line comes near that.
 */
export function lineTotalPaiseScaled(qty: number, ratePaise: number, scale: 0 | 3 | -3): Paise {
  const qtyMilliUnits = Math.round(qty * 1000); // qty has <=3 decimals by contract
  const milliPaise = qtyMilliUnits * ratePaise; // exact integer: paise x 10^3
  if (scale === 0) return roundHalfUpAtPowerOfTen(milliPaise, 3);
  if (scale === -3) return roundHalfUpAtPowerOfTen(milliPaise, 6); // paise x 10^6
  return milliPaise; // scale +3: (qty x 10^3) x rate is already whole paise
}

/**
 * Paise as a plain rupee number (4550 -> 45.5), for comparing against
 * numbers heard in a transcript (reviewFlags.ts number safety). Decimal
 * string shift, not a division. Never used to compute or store money.
 */
export function paiseToRupeeNumber(paise: Paise): number {
  const sign = paise < 0 ? "-" : "";
  const digits = String(Math.abs(paise)).padStart(3, "0");
  return Number(`${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`);
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
