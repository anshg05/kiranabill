/**
 * KB-359 (owner, 29-30 Oct 2026) - Gemini's answer checked against what Layer 1 could read of the SAME spoken piece.
 * Positional: it only works when Layer 2 returned exactly one line per piece it was sent; otherwise the pieces cannot be paired and
 * nothing is checked here (the ordered number alignment, checkLayer2NumberOrder, still runs).
 *
 *  A. Layer 1 read a quantity, unit and an explicit price (rate or total) and the AI's line differs -> the AI's numbers stay
 *     (showing different numbers than the AI wrote would be an auto-change, hard rule 7) with a HIGH flag on that line.
 *  B. A price was said but nobody could read it (a currency word inside the name) -> any price the AI gave is DISCARDED: the line
 *     keeps its quantity and has no price ("price needed", hard rule 5). Nothing is flagged: the missing price is the signal.
 *
 * Why B is stricter: the model measurement found every model invents a number for a price it cannot read; one that was never
 * understood must not reach a bill, whoever supplied it.
 */
import type { ParsedItem, UtterancePart } from "./grammar.js";
import { pieceHasUnreadPrice } from "./grammar.js";
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

export function checkLayer2AgainstSpoken(pieces: readonly UtterancePart[], lines: readonly SettledLine[]): CheckedLayer2 {
  if (pieces.length !== lines.length) return { lines, flags: [] };
  const flags: ReviewFlag[] = [];
  const checked = lines.map((settled, i): SettledLine => {
    const piece = pieces[i]!;
    const ai = settled.item;
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
