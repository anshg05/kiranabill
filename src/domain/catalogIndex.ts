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

import { catalog, type CatalogEntry, type GuardCategory } from "./catalog.js";

/**
 * ph -> f, w -> v (docs/14-LEGACY-REFERENCE.md section 6: "phorchune" and
 * "fortune" both land). Applied to both index keys (at build time) and
 * every query (at lookup time), so a misheard "wim" still reaches an
 * indexed "vim" - see catalogIndex.test.ts.
 */
export function phoneticNormalize(text: string): string {
  return text.toLowerCase().replace(/ph/g, "f").replace(/w/g, "v");
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

export function buildCatalogIndex(products: readonly CatalogEntry[] = catalog): CatalogIndex {
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
