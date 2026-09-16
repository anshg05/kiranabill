/**
 * KB-007 - shop vocabulary phrase biasing (docs/08-LEARNING-ENGINE.md
 * section 7, L5). Pure ranking/selection/capping only - this file never
 * calls Whisper and never measures a recognition-accuracy effect. Both of
 * those need an actual STT connection, which doesn't exist in Phase 0
 * (domain/ makes no network calls). The doc's own "measurement: re-run the
 * eval before and after" step is explicitly out of scope here, same
 * reasoning as KB-006 scoping WER out - there is nothing to measure an
 * effect against yet.
 *
 * L5's ranking needs two signals - "products billed recently, by
 * frequency" and "learned + promoted products, by use_count" - that don't
 * exist as stored data anywhere in Phase 0. Checked directly, not assumed:
 * domain/learning.ts (KB-008) discards ProvisionalProduct.seenCount the
 * moment a product promotes, and LearnedAlias.hitCount tracks alias
 * confirmations, not a per-catalog-product usage count. "Recent bill
 * frequency" needs a bills table, which doesn't exist until Phase 1. So
 * this function takes both signals as plain caller-supplied data rather
 * than sourcing them itself - Phase 1 computes them from real bill history
 * and learning state; this file only ranks and caps.
 */

import type { CatalogEntry } from "./catalog.js";

export interface UsageSignal {
  /** Tier 1 - strongest signal: how often this product has been billed recently. */
  readonly recentFrequency?: number;
  /** Tier 2: learned/promoted use_count. */
  readonly useCount?: number;
}

export interface VocabularyResult {
  /** Ranked, capped product names, in the order they'd appear in the prompt. */
  readonly names: readonly string[];
  /** names.join(", "), guaranteed <= 600 characters. */
  readonly prompt: string;
}

const MAX_NAMES = 40;
const MAX_PROMPT_CHARS = 600;
const SEPARATOR = ", ";

/** "Multi-word or Latin" (docs/08-LEARNING-ENGINE.md section 7) - Whisper
 * mangles these most. Note: almost every catalog displayName is already
 * Latin-script (गेहूं is one of the few exceptions), so in practice the
 * multi-word half of this check does nearly all the real work today. */
function isBrandLike(displayName: string): boolean {
  return /\s/.test(displayName) || /[a-zA-Z]/.test(displayName);
}

interface RankedEntry {
  readonly displayName: string;
  readonly recentFrequency: number;
  readonly useCount: number;
  readonly brandLike: boolean;
}

function compareRank(a: RankedEntry, b: RankedEntry): number {
  if (a.recentFrequency !== b.recentFrequency) return b.recentFrequency - a.recentFrequency;
  if (a.useCount !== b.useCount) return b.useCount - a.useCount;
  if (a.brandLike !== b.brandLike) return a.brandLike ? -1 : 1;
  return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;
}

/**
 * Builds this shop's ranked, capped vocabulary for Whisper phrase biasing.
 *
 * A shop with no bill history and nothing learned yet - a brand-new shop -
 * gets an EMPTY result here, not a fallback to generic catalog names. This
 * is intentional, not a gap: the whole point (docs/08-LEARNING-ENGINE.md
 * section 7 - "KiranaBill biases toward *this shop's real items*") is
 * biasing toward evidence this specific shop actually generated. A shop
 * with zero signal has no such evidence yet, and guessing at "generic
 * popular items" would bias toward exactly the kind of one-size-fits-all
 * catalog Pilloo already does. Empty is the correct output for a fresh
 * shop, not a bug - see vocabulary.test.ts's dedicated test for this.
 */
export function buildVocabularyPrompt(
  catalog: readonly CatalogEntry[],
  usageById: Readonly<Record<string, UsageSignal>>,
): VocabularyResult {
  const ranked: RankedEntry[] = [];
  for (const entry of catalog) {
    const signal = usageById[entry.id];
    const recentFrequency = signal?.recentFrequency ?? 0;
    const useCount = signal?.useCount ?? 0;
    if (recentFrequency <= 0 && useCount <= 0) continue; // no evidence - not this shop's vocabulary
    ranked.push({ displayName: entry.displayName, recentFrequency, useCount, brandLike: isBrandLike(entry.displayName) });
  }

  ranked.sort(compareRank);

  const names: string[] = [];
  let promptLength = 0;
  for (const entry of ranked) {
    if (names.length >= MAX_NAMES) break;
    const addedLength = names.length === 0 ? entry.displayName.length : SEPARATOR.length + entry.displayName.length;
    if (promptLength + addedLength > MAX_PROMPT_CHARS) break;
    names.push(entry.displayName);
    promptLength += addedLength;
  }

  return { names, prompt: names.join(SEPARATOR) };
}
