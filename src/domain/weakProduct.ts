/**
 * KB-368 (owner, 30 Oct 2026): a product chosen from a name that nothing about the product explains is never silent.
 * A27 "हारपी केक" became Cake (he said Harpic); A35 "फॉल्चून" became Tel Pouch (he said Fortune). One general rule, no product list:
 * a content word of the heard name that NO word of the chosen product's name or aliases is close to is "unexplained". It is
 * a read of the shop's own catalog, the same for Layer 1 and Layer 2 - never a similarity score (it cannot tell a right Layer 2 match
 * from a wrong one) and never a change to the line (hard rule 7: the app only asks).
 *
 *  - the price was SPOKEN (rate / total)  -> MEDIUM, a "Check this item" badge that does not block the bill;
 *  - the price came from the CATALOG      -> HIGH, one "Theek hai" (a wrong product would bring a wrong price with it).
 *
 * A correction with the pencil teaches the alias at finalise (KB-336), after which the word is explained and the repeat is silent.
 * Measured on the owner's 41 + 7 acceptance orders and the real transcripts (docs/23): it must stay rare.
 */
import type { CatalogEntry } from "./catalog.js";
import { normalizeDevanagari } from "./catalogIndex.js";
import { canonicalUnit, extractSpokenNumbers, type ParsedItem } from "./grammar.js";
import type { ReviewFlag } from "./reviewFlags.js";

/** A heard word is "close" to a product word at this similarity (1 - edit distance / longer length); 0.5 and 0.4 measured the same. */
const CLOSE = 0.5;
/** Words that say nothing about WHICH product: kinds of pack and filler. */
const GENERIC = new Set(["सेट", "साबुन", "वाश", "वॉश", "पैकेट", "पाउडर", "मसाला", "एक", "दो", "तीन", "बड़ा", "बडा", "छोटा", "वाला", "वाली", "set", "soap", "wash", "packet", "powder"]);
const GLUED_KILO = /(किलो|कीलो|kilo)$/;

const norm = (word: string): string => normalizeDevanagari(word.toLowerCase());

function edits(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}

const close = (heard: string, product: string): boolean =>
  product.includes(heard) || heard.includes(product) || 1 - edits(heard, product) / Math.max(heard.length, product.length) >= CLOSE;

/** The words of the heard name that nothing about this product explains. */
function unexplained(spokenName: string, entry: CatalogEntry): string[] {
  const own = [entry.displayName, ...entry.aliases].flatMap((name) => norm(name).split(/\s+/)).filter(Boolean);
  return spokenName
    .split(/\s+/)
    .map(norm)
    .filter((w) => w && !GENERIC.has(w) && !GLUED_KILO.test(w) && !/^\d/.test(w) && canonicalUnit(w) === null && extractSpokenNumbers(w).length === 0 && !own.some((p) => close(w, p)));
}

/** itemIndex is relative to `items`. Lines with no catalog product (custom) have nothing to doubt. */
export function flagWeakProducts(items: readonly ParsedItem[], catalog: readonly CatalogEntry[]): ReviewFlag[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  return items.flatMap((item, index): ReviewFlag[] => {
    const entry = item.catalogId === null ? undefined : byId.get(item.catalogId);
    if (!entry || unexplained(item.spokenName, entry).length === 0) return [];
    return [
      {
        id: `item-${index}-weak_product`,
        code: "weak_product",
        severity: item.priceType === "default" ? "HIGH" : "MEDIUM",
        message: `Check this item — heard "${item.spokenName}", chose "${entry.displayName}".`,
        itemIndex: index,
      },
    ];
  });
}
