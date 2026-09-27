/**
 * KB-005b - the product matcher (Layer 1's real catalog lookup, replacing
 * grammar.ts's exact-match stopgap - not yet wired in, see the ticket
 * handoff). Scope is deliberately the matcher only: category guards,
 * length-scaled thresholds, phonetic variants, KI-20 duplicate handling,
 * and unit rate-basis inference. The broader "Layer 3 confidence gate" in
 * docs/04-VOICE-PIPELINE.md section 5 (11+ review-reason codes,
 * "cannot finalise unacknowledged") is explicitly OUT of scope here - it
 * needs bill/UI state that doesn't exist in Phase 0, and would be pure
 * functions with no caller. See docs/07-DECISIONS.md for that call.
 */

import type { CatalogEntry } from "./catalog.js";
import type { Paise } from "./money.js";
import { lookupCandidates, type CatalogIndex } from "./catalogIndex.js";

/**
 * Length-scaled minimum score, verbatim from docs/14-LEGACY-REFERENCE.md
 * section 6 - a short word is dangerous, a 4-character typo can match
 * almost anything.
 */
function minimumScore(query: string): number {
  const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length > 1) return 0.74;
  const word = tokens[0] ?? "";
  return word.length <= 4 ? 0.98 : 0.85;
}

/**
 * Category-guard keywords, verbatim from docs/14-LEGACY-REFERENCE.md
 * section 5's original CATEGORY_GUARDS. Only 6 of the 16 guardCategory
 * buckets have a documented keyword list (not `hygiene`, not the 8 newer
 * KB-003 buckets) - deliberately not extended with invented keywords; see
 * docs/12-PARKED.md NI-23. Each of these six was "earned from a real
 * mishearing," not authored upfront, and the same discipline applies to
 * the missing ten.
 */
const CATEGORY_GUARD_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  dal: ["dal", "daal", "दाल", "मोगर", "मगर", "mogar", "magar", "lentil", "urad", "moong", "masoor", "chana dal", "arhar", "toor", "tuvar"],
  oil: ["tel", "oil", "तेल", "ghee", "घी", "vanaspati", "dalda", "butter", "makhan", "मक्खन"],
  masala: ["masala", "spice", "मसाला", "ajwain", "अजवाइन", "jeera", "जीरा", "saunf", "सौंफ", "saunth", "सोंठ", "mirch", "मिर्च", "haldi", "हल्दी", "dhaniya", "धनिया"],
  tea: ["chai", "tea", "चाय", "patti", "पत्ती", "leaf", "dust tea"],
  grain: ["chawal", "rice", "चावल", "gehun", "गेहूं", "gehu", "aata", "आटा", "atta", "kanki", "poha", "पोहा", "makka", "मक्का", "jowar", "bajra"],
  soap: ["sabun", "soap", "साबुन", "detergent", "surf", "wheel", "rin", "vim", "bartan bar", "bartan powder"],
};

function inferSpokenGuardCategory(spokenPhrase: string): string | null {
  const lower = spokenPhrase.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_GUARD_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return null;
}

/**
 * Ambiguous-match tie band - two candidates within this of each other, for
 * different products, are reported ambiguous rather than one silently
 * picked. docs/12-PARKED.md NI-22: unvalidated, no real speech data behind
 * it yet. Exists because of KI-20 (28 catalog products share an alias with
 * another product, 22 at a genuinely different price).
 */
const AMBIGUOUS_TIE_BAND = 0.05;

/** Verbatim from legacy/validator.js's getProductLearningBoost() (line
 * 290): 0.01 per recorded use, capped at 0.08. Inert until KB-008 exists -
 * opts.useCountById is always empty/absent until then. */
const LEARNED_BOOST_PER_USE = 0.01;
const LEARNED_BOOST_CAP = 0.08;

export type MatchOutcome =
  | { readonly kind: "matched"; readonly catalogId: string; readonly score: number }
  | { readonly kind: "ambiguous"; readonly candidateIds: readonly string[] }
  | { readonly kind: "none" };

export interface MatchOptions {
  /** Required (KB-302, Q2): the caller names the catalog - no silent seed default. */
  readonly index: CatalogIndex;
  /** KB-008's learning hook - use counts per catalogId. Absent/empty until then. */
  readonly useCountById?: Readonly<Record<string, number>>;
}

/**
 * Matches a spoken product phrase against the catalog. Never guesses past
 * the threshold or a genuine tie - "none" and "ambiguous" are both valid,
 * expected outcomes, not failures the caller needs to work around (hard
 * rule 5: never block on an unknown product - the caller decides what to
 * do with "none", this function just refuses to invent a match).
 */
export function matchProduct(spokenPhrase: string, opts: MatchOptions): MatchOutcome {
  const index = opts.index;
  const trimmed = spokenPhrase.trim();
  if (!trimmed) return { kind: "none" };

  const rawCandidates = lookupCandidates(index, trimmed, 10);
  if (rawCandidates.length === 0) return { kind: "none" };

  const boosted = rawCandidates
    .map((candidate) => {
      const useCount = opts.useCountById?.[candidate.catalogId] ?? 0;
      const boost = Math.min(useCount * LEARNED_BOOST_PER_USE, LEARNED_BOOST_CAP);
      return { ...candidate, score: Math.min(candidate.score + boost, 1) };
    })
    .sort((a, b) => b.score - a.score);

  const threshold = minimumScore(trimmed);
  const spokenCategory = inferSpokenGuardCategory(trimmed);

  const passing = boosted.filter((candidate) => {
    if (candidate.score < threshold) return false;
    if (spokenCategory && candidate.guardCategory !== spokenCategory) return false;
    return true;
  });

  if (passing.length === 0) return { kind: "none" };

  const best = passing[0]!;
  const second = passing[1];
  if (second && second.catalogId !== best.catalogId && best.score - second.score <= AMBIGUOUS_TIE_BAND) {
    return { kind: "ambiguous", candidateIds: [best.catalogId, second.catalogId] };
  }

  return { kind: "matched", catalogId: best.catalogId, score: best.score };
}

/**
 * If a rate is spoken in gm but is >=10x the catalog's actual per-gram
 * price, the speaker almost certainly meant a per-kg rate ("500 gram, 60
 * rupay wala" - 60 is obviously Rs.60/kg, not Rs.60/gm).
 * docs/14-LEGACY-REFERENCE.md section 8. Distinct from grammar.ts's plain
 * SI unit conversion (docs/07-DECISIONS.md D13/D14) - this is about a
 * RATE that looks like the wrong magnitude for its stated unit, not a
 * qty/unit mismatch.
 */
export function inferRateBasis(catalogEntry: CatalogEntry, spokenUnit: string, spokenRatePaise: Paise): Paise {
  if (spokenUnit !== "gm" || catalogEntry.unit !== "kg") return spokenRatePaise;
  const perGramCatalogRate = catalogEntry.suggestedPricePaise / 1000;
  if (perGramCatalogRate <= 0 || spokenRatePaise < perGramCatalogRate * 10) return spokenRatePaise;
  return Math.round(spokenRatePaise / 1000);
}
