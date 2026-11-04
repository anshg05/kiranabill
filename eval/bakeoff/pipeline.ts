import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { extractSpokenNumbers, matchProductName, parseUtteranceParts, pieceHasPerUnitPrice, type ParsedItem } from "../../src/domain/grammar.js";
import { settleLayer2Items } from "../../src/domain/layer2.js";
import { checkLayer2AgainstSpoken, dropUnspokenPrices } from "../../src/domain/layer2Check.js";
import { checkLayer2NumberOrder, evaluateReviewFlags } from "../../src/domain/reviewFlags.js";
import { flagWeakProducts } from "../../src/domain/weakProduct.js";
import { checksOf, warnedLinesOf, type ActualBill } from "../acceptance/compare.js";

// KB-370 (V1 bake-off). Candidate C answers the WHOLE order from the audio (transcript + items), so its items are checked as a Layer 2
// answer for every piece: this mirrors the Layer 2 half of data/voiceBilling.ts resolveUtterance step by step (settle, KB-359, KB-366,
// the empty-line rule, Layer 3 flags, KB-368, the number order). pipeline.test.ts proves it gives the shipped resolver's lines and checks.
// shortcut: a copy of ~20 lines, not a shared function - V3 extracts one from resolveUtterance if C or D wins.

export function checkAudioAnswer(spoken: string, items: readonly ParsedItem[], shop: ParserCatalog): ActualBill {
  const parts = parseUtteranceParts(spoken, shop);
  const settledRaw = settleLayer2Items(items, shop);
  const checked = checkLayer2AgainstSpoken(parts, settledRaw.lines);
  const grounded = dropUnspokenPrices(spoken, checked.lines);
  const priceDropped = grounded.map((l, i) => l !== checked.lines[i]);
  const allFlags = [...settledRaw.flags, ...checked.flags];
  const kept = grounded.map((l, i) => !isEmptyLine(l.item) || priceDropped[i]!);
  const lines = grounded.filter((_, i) => kept[i]);
  if (lines.length === 0) return { lines: [], unresolved: 0, checks: 0 };
  const newIndex = kept.reduce<number[]>((acc, k, i) => (acc.push(k ? (acc[i - 1] ?? -1) + 1 : (acc[i - 1] ?? -1)), acc), []);
  const settledFlags = allFlags.filter((f) => f.itemIndex === null || kept[f.itemIndex]).map((f) => (f.itemIndex === null ? f : { ...f, itemIndex: newIndex[f.itemIndex]! }));
  const lineItems = lines.map((l) => l.item);
  const misaligned = checkLayer2NumberOrder(spoken, lineItems);
  const flags = [...evaluateReviewFlags(spoken, lineItems, shop.entries), ...flagWeakProducts(lineItems, shop.entries), ...settledFlags, ...(misaligned ? [misaligned] : [])];
  return { lines, unresolved: 0, checks: checksOf(flags, lines.length), warnedLines: warnedLinesOf(flags, lines.length) };
}

function isEmptyLine(item: ParsedItem): boolean {
  return item.catalogId === null && item.qty === null && item.rate === null && item.total === null;
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
