/**
 * KB-005b - fast candidate lookup over the catalog, replacing the O(n) scan
 * docs/12-PARKED.md KI-11 already called out (~106ms/keystroke at 5,000
 * products on a budget phone). A trigram index plus phonetic normalization,
 * built once at module load from every catalog displayName/alias.
 * validator.ts scores candidates this returns - it never scans the raw
 * catalog array itself.
 *
 * Contract proof line (docs/18-AGENT-CONTRACT.md section 8): "Index under
 * 16 ms at 10,000 products." See catalogIndex.test.ts for the synthetic
 * scale-up benchmark - the real catalog is 482 products.
 */

import type { CatalogEntry, GuardCategory } from "./catalog.js";

/**
 * ph -> f, w -> v (docs/14-LEGACY-REFERENCE.md section 6: "phorchune" and
 * "fortune" both land). Applied to both index keys (at build time) and
 * every query (at lookup time), so a misheard "wim" still reaches an
 * indexed "vim" - see catalogIndex.test.ts.
 */
export function phoneticNormalize(text: string): string {
  return foldDevanagariSpelling(normalizeDevanagari(text.toLowerCase())).replace(/ph/g, "f").replace(/w/g, "v");
}

/**
 * KB-317 (owner: general normalisation, not one alias per misspelling):
 * spelling differences Whisper makes on the same word, folded on index keys
 * and queries alike - vowel length (साबून/साबुन, मुंग/मूंग), ै/े and ौ/ो,
 * श/ष -> स (बेशन/बेसन, देशी/देसी), व -> ब (बरवटी/बरबटी). Measured on every real
 * Whisper spelling seen (RT01-RT33) and every alias of every catalog product:
 * no wrong match, no new false match, no alias that stops landing on its own
 * product. NOT folded (measured unsafe): ा/none - ताज़ा and तज became ties.
 * Matching only: grammar's number and marker words keep their exact spelling.
 */
const SPELLING_FOLDS: readonly (readonly [RegExp, string])[] = [
  [/\u0942/g, "\u0941"], // ू -> ु
  [/\u0940/g, "\u093F"], // ी -> ि
  [/\u090A/g, "\u0909"], // ऊ -> उ
  [/\u0908/g, "\u0907"], // ई -> इ
  [/\u0948/g, "\u0947"], // ै -> े
  [/\u094C/g, "\u094B"], // ौ -> ो
  [/\u0910/g, "\u090F"], // ऐ -> ए
  [/\u0914/g, "\u0913"], // औ -> ओ
  [/[\u0936\u0937]/g, "\u0938"], // श, ष -> स
  [/\u0935/g, "\u092C"], // व -> ब
];

function foldDevanagariSpelling(text: string): string {
  return SPELLING_FOLDS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), text);
}

/**
 * KB-317: Whisper and the catalog spell the same Devanagari word two ways -
 * with or without a nukta (फुटाना / फ़ुटाना, precomposed or combining) and with
 * a chandrabindu or an anusvara (पाँच / पांच). Both fold to the plain form, on
 * index keys and on every query alike. ड and ढ stay different letters: nukta
 * folding turns ड़ into ड and ढ़ into ढ, never one into the other.
 */
export function normalizeDevanagari(text: string): string {
  return text.normalize("NFD").replace(/़/g, "").replace(/ँ/g, "ं");
}

function normalizeForIndex(text: string): string {
  return phoneticNormalize(text.trim()).replace(/\s+/g, " ");
}

/** Trigrams of a normalized string, padded so short words still produce
 * at least one. */
function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

interface IndexEntry {
  readonly catalogId: string;
  readonly alias: string; // original, unnormalized - for display/debugging
  readonly guardCategory: GuardCategory;
  readonly trigramSet: ReadonlySet<string>;
}

export interface CatalogIndex {
  readonly entries: readonly IndexEntry[];
  readonly trigramMap: ReadonlyMap<string, readonly number[]>;
}

export function buildCatalogIndex(products: readonly CatalogEntry[]): CatalogIndex {
  const entries: IndexEntry[] = [];
  for (const product of products) {
    for (const raw of [product.displayName, ...product.aliases]) {
      const normalized = normalizeForIndex(raw);
      if (!normalized) continue;
      entries.push({ catalogId: product.id, alias: raw, guardCategory: product.guardCategory, trigramSet: trigrams(normalized) });
    }
  }

  const trigramMap = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    for (const gram of entry.trigramSet) {
      const bucket = trigramMap.get(gram);
      if (bucket) bucket.push(index);
      else trigramMap.set(gram, [index]);
    }
  });

  return { entries, trigramMap };
}

/**
 * KB-302 (owner, Q2): everything Layer 1 needs from ONE catalog - the shop's
 * own (data/shopCatalog.ts) in the app; the seed (seedCatalog.ts) only in
 * tests, eval and scripts. Every function that parses takes one of these as
 * a REQUIRED argument: a silent default to the seed is how Layer 1 came to
 * price every shop from the base catalog instead of its own (D4).
 */
export interface ParserCatalog {
  readonly entries: readonly CatalogEntry[];
  readonly index: CatalogIndex;
  readonly byId: ReadonlyMap<string, CatalogEntry>;
}

/** Build once per catalog (and again when it changes) - not per utterance. */
export function prepareParserCatalog(entries: readonly CatalogEntry[]): ParserCatalog {
  return { entries, index: buildCatalogIndex(entries), byId: new Map(entries.map((e) => [e.id, e])) };
}

export interface Candidate {
  readonly catalogId: string;
  readonly alias: string;
  readonly guardCategory: GuardCategory;
  readonly score: number;
}

/** Dice coefficient over trigrams: 2*|intersection| / (|A|+|B|). 1.0 for an
 * exact (post-normalization) match, 0 when nothing overlaps. */
function diceScore(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) shared += 1;
  }
  return (2 * shared) / (a.size + b.size);
}

/**
 * Returns the best-scoring candidate per catalogId, highest score first,
 * capped at `limit`. Only aliases sharing at least one trigram with the
 * query are ever scored - this index lookup, not a full scan, is what
 * keeps this under the 16ms budget at scale.
 */
export function lookupCandidates(index: CatalogIndex, query: string, limit = 10): Candidate[] {
  const normalizedQuery = normalizeForIndex(query);
  if (!normalizedQuery) return [];
  const queryGrams = trigrams(normalizedQuery);

  const considered = new Set<number>();
  for (const gram of queryGrams) {
    const bucket = index.trigramMap.get(gram);
    if (!bucket) continue;
    for (const i of bucket) considered.add(i);
  }

  const bestByProduct = new Map<string, Candidate>();
  for (const i of considered) {
    const entry = index.entries[i]!;
    const score = diceScore(queryGrams, entry.trigramSet);
    const existing = bestByProduct.get(entry.catalogId);
    if (!existing || score > existing.score) {
      bestByProduct.set(entry.catalogId, { catalogId: entry.catalogId, alias: entry.alias, guardCategory: entry.guardCategory, score });
    }
  }

  return [...bestByProduct.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * KB-302: the Layer 2 catalog slice (docs/04-VOICE-PIPELINE.md section 4:
 * "top 30 relevant products"). A whole multi-item transcript is a poor single
 * query - it dilutes every product's score - so each word and each adjacent
 * word pair is looked up on its own; a product keeps its best score. Pure;
 * the server caps the slice again (netlify/functions/voice.mts).
 */
export function buildCatalogSlice(pc: ParserCatalog, transcript: string, limit = 30): CatalogEntry[] {
  const words = transcript.split(/[\s,.;:!?।]+/).filter((w) => w.length > 0);
  const queries = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  const best = new Map<string, number>();
  for (const q of queries) {
    for (const c of lookupCandidates(pc.index, q, 5)) {
      if (c.score > (best.get(c.catalogId) ?? 0)) best.set(c.catalogId, c.score);
    }
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .flatMap(([id]) => {
      const entry = pc.byId.get(id);
      return entry ? [entry] : [];
    });
}

/** KB-305: one type-ahead result - the product, and the alias that matched
 * (shown when it isn't the product's name: "Poha · chiwda"). */
export interface SearchResult {
  readonly entry: CatalogEntry;
  readonly alias: string;
}

/** Fewer than 2 characters is noise ("c" ranked Dahi and Cake first);
 * "ची" (च + ी) is already 2. */
const SEARCH_MIN_CHARS = 2;
/** lookupCandidates' own cap, before the tie-break - wide enough that a
 * product on an equal score is never cut before it's compared. */
const SEARCH_POOL = 40;

/**
 * KB-305: the add-item type-ahead (05 S3a, §10: < 16 ms per keystroke) over
 * the SHOP's catalog. Best score first; an equal score goes to the product
 * this shop sells more (use count), then by name. An inactive product never
 * appears, whatever catalog it's given. At most `limit` results.
 */
export function searchCatalog(
  pc: ParserCatalog,
  query: string,
  usage: Readonly<Record<string, { readonly useCount?: number }>> = {},
  limit = 8,
): SearchResult[] {
  if ([...query.trim()].length < SEARCH_MIN_CHARS) return [];
  return lookupCandidates(pc.index, query, SEARCH_POOL)
    .flatMap((c) => {
      const entry = pc.byId.get(c.catalogId);
      return entry?.isActive ? [{ entry, alias: c.alias, score: c.score }] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (usage[b.entry.id]?.useCount ?? 0) - (usage[a.entry.id]?.useCount ?? 0) ||
        a.entry.displayName.localeCompare(b.entry.displayName),
    )
    .slice(0, limit)
    .map(({ entry, alias }) => ({ entry, alias }));
}
