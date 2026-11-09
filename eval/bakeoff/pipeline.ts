import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { extractSpokenNumbers, matchProductName, pieceHasPerUnitPrice, type ParsedItem } from "../../src/domain/grammar.js";
import type { CheckSource } from "../../src/domain/reviewFlags.js";
import { aiAnswerBill, checkedAnswer, fillFromCatalog, type AnswerBill } from "../../src/domain/aiAnswerBill.js";
import { checksOf, warnedLinesOf, type ActualBill } from "../acceptance/compare.js";

// KB-370 (V1 bake-off). Candidate C answers the WHOLE order from the audio (transcript + items), so its items are checked as a Layer 2
// answer for every piece. KB-384a: the check chain and the price fill now live in src/domain/aiAnswerBill.ts (the phone uses them);
// these are the eval's thin wrappers - same names, so run.ts, replay.ts and the tests did not change.

export function checkAudioAnswer(spoken: string, items: readonly ParsedItem[], shop: ParserCatalog, source: CheckSource = "spoken"): ActualBill {
  return toActual(checkedAnswer(spoken, items, shop, source));
}

/** The eval's summary of a bill: the lines, and the Theek hai checks / warned lines the screen would show. */
function toActual({ lines, flags }: AnswerBill): ActualBill {
  if (lines.length === 0) return { lines: [], unresolved: 0, checks: 0 };
  return { lines, unresolved: 0, checks: checksOf(flags, lines.length), warnedLines: warnedLinesOf(flags, lines.length) };
}

/**
 * Candidate D: C's items, but a QUANTITY counts only if B's transcript (a second, independent ear) has that number - or it is the 1 of a
 * per-kilo price (the owner's ruling, D47's exception). Otherwise it becomes "quantity needed". Prices are then checked by
 * checkAudioAnswer(bTranscript, ...), so a rate or total only C heard is dropped the same way.
 */
export function hybridItems(bTranscript: string, cItems: readonly ParsedItem[]): ParsedItem[] {
  const heard = extractSpokenNumbers(bTranscript);
  const perUnit = pieceHasPerUnitPrice(bTranscript);
  return cItems.map((it) => (it.qty === null || heard.some((n) => Math.abs(n - it.qty!) < 1e-9) || (it.qty === 1 && perUnit) ? it : { ...it, qty: null }));
}

/**
 * KB-370 round 2 (D102): the catalog only FILLS A PRICE THAT WAS NOT SAID, and only when the spoken name clearly matches ONE item - the
 * one the answer claims. Anything else (a different product, several, none) loses the claim and shows "Price needed"; the name stays as said.
 */
export function d102Fill(items: readonly ParsedItem[], shop: ParserCatalog): ParsedItem[] {
  return items.map((it) => {
    if (it.priceType !== "default") return it;
    const match = matchProductName(it.spokenName, shop);
    if (it.catalogId !== null && match.matchStatus === "matched" && match.catalogId === it.catalogId) return it;
    return { ...it, catalogId: null, isCustom: true, matchStatus: "none", rate: null, rateUnit: null, total: null, priceType: "unknown" };
  });
}

export { fillFromCatalog };

/** KB-379 (D104): the Gemini path's bill - src/domain/aiAnswerBill.ts (KB-384a: the phone runs the same function), summarised for the eval. */
export function nocatBill(transcript: string, items: readonly ParsedItem[], shop: ParserCatalog): ActualBill {
  return toActual(aiAnswerBill(transcript, items, shop));
}

/**
 * KB-370 round 2: two independent ears must agree. A line whose quantity, rate or total B's transcript of the SAME recording does not have
 * (the 1 of a per-kilo price excepted, as in hybridItems) gets a Theek hai - the line is kept, never changed (hard rule 7).
 */
export function flagNotHeardByB(bill: ActualBill, bTranscript: string): ActualBill {
  const heard = extractSpokenNumbers(bTranscript).map((n) => Math.round(n * 100));
  const has = (paise: number) => heard.includes(paise);
  const perUnit = pieceHasPerUnitPrice(bTranscript);
  const warned = new Set(bill.warnedLines ?? []);
  bill.lines.forEach(({ item: i }, k) => {
    const qtyOk = i.qty === null || has(Math.round(i.qty * 100)) || (i.qty === 1 && perUnit);
    const price = i.priceType === "rate" ? i.rate : i.priceType === "total" ? i.total : null;
    if (!qtyOk || (price !== null && !has(price))) warned.add(k);
  });
  const warnedLines = [...warned].sort((a, b) => a - b);
  return { ...bill, warnedLines, checks: Math.max(bill.checks, warnedLines.length) };
}
