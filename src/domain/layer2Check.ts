/**
 * KB-359 (owner, 29-30 Oct 2026) - Gemini's answer checked against what Layer 1 could read of the SAME spoken piece.
 * Positional: it only works when Layer 2 returned exactly one line per piece it was sent; otherwise the pieces cannot be paired and
 * nothing is checked here (the ordered number alignment, checkLayer2NumberOrder, still runs).
 *
 *  A. Layer 1 read a quantity, unit and an explicit price (rate or total) and the AI's line differs -> the AI's numbers stay
 *     (showing different numbers than the AI wrote would be an auto-change, hard rule 7) with a HIGH flag on that line.
 *  C. A quantity nobody said (A27, A47, A49: "लाइजॉल 110 रुपए" came back as 1 piece) is dropped: the line keeps what was said and shows
 *     "quantity needed" - D47, never a number nobody said. Exceptions that ARE a quantity: a number the reader finds in the piece, and a
 *     price per kilo / litre with no quantity (the owner's ruling: 1 kg).
 *  E. A rate or total that is not a number anyone SPOKE (A48: "साथ 200 रुपए" came back as Rs 602; A24: the catalog's Rs 70 as a "rate"
 *     while Rs 56 was said) is dropped: the line stays with what was said and shows "Price needed" - dropUnspokenPrices, text-level, so it
 *     needs no pairing of pieces and lines.
 *  B. A price was said but nobody could read it (a currency word inside the name) -> any price the AI gave is DISCARDED: the line
 *     keeps its quantity and has no price ("price needed", hard rule 5). Nothing is flagged: the missing price is the signal.
 *
 * Why B is stricter: the model measurement found every model invents a number for a price it cannot read; one that was never
 * understood must not reach a bill, whoever supplied it.
 */
import type { ParsedItem, UtterancePart } from "./grammar.js";
import { extractSpokenNumbers, pieceHasPerUnitPrice, pieceHasUnreadPrice } from "./grammar.js";
import type { SettledLine } from "./layer2.js";
import { formatRupees } from "./money.js";
import type { ReviewFlag } from "./reviewFlags.js";

export interface CheckedLayer2 {
  readonly lines: readonly SettledLine[];
  /** itemIndex is relative to `lines`. */
  readonly flags: readonly ReviewFlag[];
}

const hasAPrice = (item: ParsedItem): boolean => item.priceType !== "unknown" && (item.total !== null || item.rate !== null) && (item.total ?? item.rate ?? 0) > 0;

function say(item: ParsedItem): string {
  const amount = item.total !== null ? ` for ${formatRupees(item.total)}` : "";
  return `${item.qty ?? "?"} ${item.unit || "piece"}${amount}`;
}

/** Is this quantity one the speaker said (a number the shared reader finds in the piece), or the 1 of a per-unit price? */
function quantitySaid(text: string, qty: number): boolean {
  return extractSpokenNumbers(text).some((n) => Math.abs(n - qty) < 1e-9) || (qty === 1 && pieceHasPerUnitPrice(text));
}

/**
 * KB-366: "never silently a wrong number" as an invariant. A line Layer 2 priced as a spoken RATE or a spoken TOTAL must carry a number
 * the shared reader finds in the text it was asked about (digits, number words, compounds, fractions). Anything else is a number nobody said:
 * the price is dropped (priceType unknown) and the line shows "Price needed". The shop's own price (priceType default) and lines with no
 * price are untouched.
 */
export function dropUnspokenPrices(asked: string, lines: readonly SettledLine[]): SettledLine[] {
  const spoken = new Set(extractSpokenNumbers(asked).map((n) => Math.round(n * 100)));
  return lines.map((line) => {
    const { priceType, rate, total } = line.item;
    const claimed = priceType === "rate" ? rate : priceType === "total" ? total : null;
    if (claimed === null || spoken.has(claimed)) return line;
    return { ...line, item: { ...line.item, rate: null, rateUnit: null, total: null, priceType: "unknown" } };
  });
}

export function checkLayer2AgainstSpoken(pieces: readonly UtterancePart[], lines: readonly SettledLine[]): CheckedLayer2 {
  if (pieces.length !== lines.length) return { lines, flags: [] };
  const flags: ReviewFlag[] = [];
  const checked = lines.map((line, i): SettledLine => {
    let settled = line;
    const piece = pieces[i]!;
    let ai = settled.item;
    // (when Layer 1 read a quantity for the piece, a DIFFERENT AI quantity is Check A's loud HIGH flag, not a silent drop)
    if (ai.qty !== null && piece.item?.qty == null && !quantitySaid(piece.text, ai.qty)) {
      ai = { ...ai, qty: null, unit: "", total: ai.priceType === "total" ? ai.total : null };
      settled = { ...settled, item: ai };
    }
    if (pieceHasUnreadPrice(piece.text)) {
      if (!hasAPrice(ai)) return settled;
      return { ...settled, item: { ...ai, rate: null, rateUnit: null, total: null, priceType: "unknown" } };
    }
    const heard = piece.item;
    if (!heard || heard.qty === null || heard.total === null || (heard.priceType !== "rate" && heard.priceType !== "total")) return settled;
    // An AI line with no price (or no quantity) invented nothing - only a different number is a disagreement.
    const differs = (ai.qty !== null && ai.qty !== heard.qty) || (ai.unit !== "" && ai.unit !== heard.unit) || (ai.total !== null && ai.total !== heard.total);
    if (differs) {
      flags.push({
        id: `item-${i}-layer2_disagrees`,
        code: "layer2_disagrees",
        severity: "HIGH",
        message: `Heard ${say(heard)}, but the AI wrote ${say(ai)} — check this line.`,
        itemIndex: i,
      });
    }
    return settled;
  });
  return { lines: checked, flags };
}
