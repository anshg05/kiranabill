import type { ParserCatalog } from "./catalogIndex";
import { matchProductName, parseUtteranceParts, unitScale, type ParsedItem } from "./grammar";
import { settleLayer2Items, type SettledLine } from "./layer2";
import { checkLayer2AgainstSpoken, dropUnspokenPrices } from "./layer2Check";
import { checkLayer2NumberOrder, evaluateReviewFlags, type CheckSource, type ReviewFlag } from "./reviewFlags";
import { flagWeakProducts } from "./weakProduct";
import { aiAnswerQuantities, aiAnswerRateUnits, aiAnswerRepeatPrices } from "./aiAnswerNumbers";

// KB-384a step 4 (owner, 9 Nov 2026; D104): the bill V3 builds from Gemini's raw answer (transcript + items) - our price fill, the
// checks and the totals. Moved here from eval/bakeoff/pipeline.ts so the PHONE bills exactly what the replay measures (one function for
// the app, the live run and the replay; aiAnswerBillMove.test.ts proves the 85 saved answers' bills did not change).

export interface AnswerBill {
  readonly lines: readonly SettledLine[];
  readonly flags: readonly ReviewFlag[];
  /** For each line, the index of the answer item it came from (empty items are dropped, so the two can differ). */
  readonly sourceIndex: readonly number[];
}

/** KB-385 (D106 item 3): a price OUR CODE filled on that line - never spoken for it. The bill marks it "filled, not spoken". */
export interface FilledPrice {
  readonly index: number;
  readonly kind: "shop_price" | "repeat";
}

/**
 * A whole order's items checked as a Layer 2 answer for every piece - the Layer 2 half of data/voiceBilling.ts resolveUtterance, step
 * by step (settle, KB-359, KB-366, the empty-line rule, Layer 3 flags, KB-368, the number order).
 */
export function checkedAnswer(spoken: string, items: readonly ParsedItem[], shop: ParserCatalog, source: CheckSource = "spoken"): AnswerBill {
  const parts = parseUtteranceParts(spoken, shop);
  const settledRaw = settleLayer2Items(items, shop);
  const checked = checkLayer2AgainstSpoken(parts, settledRaw.lines, source);
  const grounded = dropUnspokenPrices(spoken, checked.lines);
  const priceDropped = grounded.map((l, i) => l !== checked.lines[i]);
  const allFlags = [...settledRaw.flags, ...checked.flags];
  const kept = grounded.map((l, i) => !isEmptyLine(l.item) || priceDropped[i]!);
  const lines = grounded.filter((_, i) => kept[i]);
  if (lines.length === 0) return { lines: [], flags: [], sourceIndex: [] };
  const sourceIndex = kept.flatMap((k, i) => (k ? [i] : []));
  const newIndex = kept.reduce<number[]>((acc, k, i) => (acc.push(k ? (acc[i - 1] ?? -1) + 1 : (acc[i - 1] ?? -1)), acc), []);
  const settledFlags = allFlags.filter((f) => f.itemIndex === null || kept[f.itemIndex]).map((f) => (f.itemIndex === null ? f : { ...f, itemIndex: newIndex[f.itemIndex]! }));
  const lineItems = lines.map((l) => l.item);
  const misaligned = checkLayer2NumberOrder(spoken, lineItems, source);
  return { lines, sourceIndex, flags: [...evaluateReviewFlags(spoken, lineItems, shop.entries, undefined, source), ...flagWeakProducts(lineItems, shop.entries), ...settledFlags, ...(misaligned ? [misaligned] : [])] };
}

function isEmptyLine(item: ParsedItem): boolean {
  return item.catalogId === null && item.qty === null && item.rate === null && item.total === null;
}

/**
 * KB-383 (doc 25 §11): the ONE product a said name clearly matches. If the name matches nothing, the Devanagari spellings the matcher does not
 * fold yet are tried - ॉ / ो and ऑ / ओ ("लाइज़ॉल" -> the catalog's "लाइजोल") - both ways; two different products = none (D102: one clear match
 * or Price needed). AI path only: Layer 1's matcher is unchanged. A census test proves no catalog name lands on another product.
 */
function productOf(name: string, shop: ParserCatalog) {
  const one = (n: string) => {
    const m = matchProductName(n, shop);
    return m.matchStatus === "matched" && m.catalogId !== null ? m.catalogId : null;
  };
  const direct = one(name);
  if (direct) return shop.byId.get(direct);
  // ॉ (U+0949) <-> ो (U+094B), ऑ (U+0911) <-> ओ (U+0913)
  const tries = [name.replace(/ॉ/g, "ो").replace(/ऑ/g, "ओ"), name.replace(/ो/g, "ॉ").replace(/ओ/g, "ऑ")].filter((n) => n !== name).map(one).filter((id): id is string => id !== null);
  return new Set(tries).size === 1 ? shop.byId.get(tries[0]!) : undefined;
}

/**
 * KB-370 nocat (owner, 6 Nov 2026): the model never saw the catalog, so OUR code fills a price that was NOT said - only when the spoken
 * name clearly matches ONE catalog item (D102); several or none = Price needed. A line with a spoken price is never touched; the name
 * stays as said; settleLayer2Items then computes the total from the shop price.
 */
export function fillFromCatalog(items: readonly ParsedItem[], shop: ParserCatalog): ParsedItem[] {
  return items.map((it) => {
    if (it.priceType !== "default") return it;
    const entry = productOf(it.spokenName, shop);
    // KB-380 (A19): a unit the shop's price cannot be scaled to (a packet of a per-kg product) has no shop price - Price needed
    if (entry && unitScale(it.unit || entry.unit, entry.unit) !== null) return { ...it, catalogId: entry.id, isCustom: false, matchStatus: "matched" };
    return { ...it, catalogId: null, isCustom: true, matchStatus: "none", rate: null, rateUnit: null, total: null, priceType: "unknown" };
  });
}

/** KB-379 (D104, doc 25 §12): the Gemini path's bill from the model's raw answer - repeats, our price fill, quantities, rate units, checks. */
export function aiAnswerBill(transcript: string, items: readonly ParsedItem[], shop: ParserCatalog): AnswerBill & { readonly filled: readonly FilledPrice[] } {
  const repeated = aiAnswerRepeatPrices(items);
  const bill = checkedAnswer(transcript, aiAnswerRateUnits(transcript, aiAnswerQuantities(transcript, fillFromCatalog(repeated, shop))), shop, "ai-answer");
  const filled = bill.lines.flatMap(({ item }, index): FilledPrice[] => {
    if (item.priceType === "default") return [{ index, kind: "shop_price" }]; // the catalog's price: fillFromCatalog only keeps "default" when the shop price applies
    const from = bill.sourceIndex[index]!;
    if (repeated[from] !== items[from]) return [{ index, kind: "repeat" }]; // a copied price was spoken (earlier), so the checks keep it
    return [];
  });
  return { ...bill, filled };
}
