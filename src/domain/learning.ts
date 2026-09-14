/**
 * KB-008 - domain/learning.ts. Pure, stateful-by-value learning rules:
 * every function takes a LearningState and returns a new one (or a result
 * wrapping one) - nothing here mutates, nothing here touches a database.
 * Persisting LearningState (IndexedDB/Supabase) and keeping one instance
 * per shop_id (hard rule 12: learning is per-shop, never global) is the
 * caller's job - Phase 1. This module has no concept of "the current shop"
 * at all; a LearningState value IS one shop's learning, and mixing two
 * shops' states is a caller bug, not something this file can prevent.
 *
 * docs/08-LEARNING-ENGINE.md is mostly a forward DESIGN for this ticket,
 * not an extraction of legacy behavior (checked legacy/learning-store.js
 * directly - it has no confidence score, no suppression, no manual
 * promotion, and no price-suggestion mechanism at all). Where the doc
 * gives a number, it's used verbatim; where it doesn't, the constant below
 * says so and points at docs/07-DECISIONS.md D15, the one decision in this
 * file with no source to check against.
 *
 * L4 (unit learning), L5 (vocabulary rank) and L6 (fast-path coverage) are
 * out of scope here - L4 is "same shape as L3" (section 6) and can reuse
 * this module's pattern later without redesign; L5/L6 are consumed-by
 * relationships on top of L1/L2, not learning.ts behaviors of their own.
 * The learning_events audit log (section 9) is also out of scope - it's a
 * persistence concern needing a database Phase 0 doesn't have, same
 * reasoning as KB-005b's confidence-gate scoping.
 */

import type { Paise } from "./money.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ProvisionalProduct {
  readonly spokenName: string;
  readonly displayName: string;
  readonly unit: string;
  readonly seenCount: number;
  readonly priceObservations: readonly Paise[];
}

export interface LearnedAlias {
  readonly aliasKey: string;
  readonly catalogId: string;
  readonly confidence: number;
  readonly hitCount: number;
}

interface PriceObservationRecord {
  readonly pricePaise: Paise;
  readonly observedAtMs: number;
}

export interface PriceTrackedProduct {
  readonly catalogId: string;
  readonly observations: readonly PriceObservationRecord[];
  readonly ignoredUntilMs: number | null;
}

export interface LearningState {
  readonly provisionalProducts: Readonly<Record<string, ProvisionalProduct>>;
  readonly learnedAliases: Readonly<Record<string, LearnedAlias>>;
  readonly priceObservations: Readonly<Record<string, PriceTrackedProduct>>;
}

export const EMPTY_LEARNING_STATE: LearningState = {
  provisionalProducts: {},
  learnedAliases: {},
  priceObservations: {},
};

function normalizeKey(text: string): string {
  return text.trim().toLowerCase();
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([existingKey]) => existingKey !== key));
}

// ---------------------------------------------------------------------------
// L1 - new product learning (docs/08-LEARNING-ENGINE.md section 3)
// ---------------------------------------------------------------------------

/** legacy/learning-store.js PROVISIONAL_PROMOTION_THRESHOLD - ported verbatim. */
const AUTOMATIC_PROMOTION_SIGHTINGS = 3;

export interface ProductSighting {
  readonly spokenName: string;
  readonly displayName: string;
  readonly unit: string;
  readonly pricePaise: Paise;
}

export interface PromotedCatalogEntry {
  readonly displayName: string;
  readonly unit: string;
  readonly pricePaise: Paise;
}

export interface ProductPromotionResult {
  readonly state: LearningState;
  readonly promoted: boolean;
  readonly promotedCatalogEntry?: PromotedCatalogEntry;
}

/** First-observed price wins ties (docs/07-DECISIONS.md D13-style disclosed
 * tie-break, approved as-is for KB-008). Legacy just overwrites with the
 * latest observation; the doc's "modal observed price" is new design. */
function modalPrice(observations: readonly Paise[]): Paise {
  const counts = new Map<Paise, number>();
  for (const price of observations) {
    counts.set(price, (counts.get(price) ?? 0) + 1);
  }
  let best: { price: Paise; count: number } | null = null;
  for (const price of observations) {
    const count = counts.get(price)!;
    if (!best || count > best.count) {
      best = { price, count };
    }
  }
  return best!.price;
}

function promoteProvisional(state: LearningState, key: string, product: ProvisionalProduct): ProductPromotionResult {
  return {
    state: { ...state, provisionalProducts: withoutKey(state.provisionalProducts, key) },
    promoted: true,
    promotedCatalogEntry: {
      displayName: product.displayName,
      unit: product.unit,
      pricePaise: modalPrice(product.priceObservations),
    },
  };
}

/** Records one sighting of an item not in the shop catalog. Promotes
 * automatically the moment seenCount reaches 3 - never blocks, never asks
 * (docs/04-VOICE-PIPELINE.md hard rule 5). */
export function recordProductSighting(state: LearningState, sighting: ProductSighting): ProductPromotionResult {
  const key = normalizeKey(sighting.spokenName);
  const existing = state.provisionalProducts[key];
  const product: ProvisionalProduct = {
    spokenName: sighting.spokenName,
    displayName: sighting.displayName,
    unit: sighting.unit,
    seenCount: (existing?.seenCount ?? 0) + 1,
    priceObservations: existing ? [...existing.priceObservations, sighting.pricePaise] : [sighting.pricePaise],
  };

  if (product.seenCount >= AUTOMATIC_PROMOTION_SIGHTINGS) {
    return promoteProvisional(state, key, product);
  }

  return {
    state: { ...state, provisionalProducts: { ...state.provisionalProducts, [key]: product } },
    promoted: false,
  };
}

/** One explicit tap promotes whatever's currently on record for this item,
 * regardless of seenCount - bypasses the automatic threshold entirely
 * (docs/08-LEARNING-ENGINE.md section 3: "instant, for when the shopkeeper
 * knows they'll sell it again"). A no-op if the item was never sighted. */
export function manuallyPromoteProduct(state: LearningState, spokenName: string): ProductPromotionResult {
  const key = normalizeKey(spokenName);
  const existing = state.provisionalProducts[key];
  if (!existing) {
    return { state, promoted: false };
  }
  return promoteProvisional(state, key, existing);
}

// ---------------------------------------------------------------------------
// L2 - alias learning (docs/08-LEARNING-ENGINE.md section 4)
// ---------------------------------------------------------------------------

const ALIAS_INITIAL_CONFIDENCE = 0.5;
const ALIAS_CONFIRMATION_INCREMENT = 0.2;
const ALIAS_PROMOTION_THRESHOLD = 0.8;
/** docs/07-DECISIONS.md D15 - symmetric with the +0.2 confirmation increment. */
const ALIAS_SUPPRESSION_DECREMENT = 0.2;
/** docs/07-DECISIONS.md D15 - confidence-threshold retirement, not a flat
 * suppression count. Symmetric with the 0.5 starting point and the 0.8
 * promotion threshold. */
const ALIAS_RETIREMENT_THRESHOLD = 0.3;

export interface AliasCorrection {
  readonly spokenName: string;
  readonly catalogId: string;
}

export interface AliasConfirmationResult {
  readonly state: LearningState;
  readonly promoted: boolean;
}

/** Records a spoken phrase resolving to a product, whether this is the
 * first time (a correction just happened) or a later confirmation without
 * further editing. Confidence starts at 0.5, +0.2 per call, promoted
 * (treated as an exact alias) at >=0.8. */
export function recordAliasConfirmation(state: LearningState, correction: AliasCorrection): AliasConfirmationResult {
  const key = normalizeKey(correction.spokenName);
  const existing = state.learnedAliases[key];
  const confidence = existing
    ? Math.min(existing.confidence + ALIAS_CONFIRMATION_INCREMENT, 1)
    : ALIAS_INITIAL_CONFIDENCE;
  const alias: LearnedAlias = {
    aliasKey: key,
    catalogId: correction.catalogId,
    confidence,
    hitCount: (existing?.hitCount ?? 0) + 1,
  };

  return {
    state: { ...state, learnedAliases: { ...state.learnedAliases, [key]: alias } },
    promoted: confidence >= ALIAS_PROMOTION_THRESHOLD,
  };
}

/** The user deleted a line that used this learned alias - a negative
 * signal. Decrements confidence; the alias is removed from state entirely
 * once confidence drops to or below the retirement threshold (D15). A
 * no-op if the alias was never learned. */
export function suppressAlias(state: LearningState, spokenName: string): LearningState {
  const key = normalizeKey(spokenName);
  const existing = state.learnedAliases[key];
  if (!existing) {
    return state;
  }

  const confidence = existing.confidence - ALIAS_SUPPRESSION_DECREMENT;
  if (confidence <= ALIAS_RETIREMENT_THRESHOLD) {
    return { ...state, learnedAliases: withoutKey(state.learnedAliases, key) };
  }
  return { ...state, learnedAliases: { ...state.learnedAliases, [key]: { ...existing, confidence } } };
}

// ---------------------------------------------------------------------------
// L3 - price learning: suggest, never auto-apply (section 5, safety rule 3)
// ---------------------------------------------------------------------------

const PRICE_SUGGESTION_MIN_OBSERVATIONS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_SUGGESTION_WINDOW_MS = 30 * DAY_MS;
const PRICE_SUGGESTION_IGNORE_MS = 90 * DAY_MS;

export interface PriceObservationResult {
  readonly state: LearningState;
}

/** Records one bill line's price if it differs from the shop's current
 * stored price - an exact match to the current price is not drift and
 * isn't tracked. Never touches a "current price" anywhere; there isn't
 * one in this module's state, by design (see learning.test.ts). */
export function recordPriceObservation(
  state: LearningState,
  catalogId: string,
  currentPricePaise: Paise,
  observedPricePaise: Paise,
  nowMs: number,
): PriceObservationResult {
  if (observedPricePaise === currentPricePaise) {
    return { state };
  }

  const existing = state.priceObservations[catalogId];
  const tracked: PriceTrackedProduct = {
    catalogId,
    observations: [...(existing?.observations ?? []), { pricePaise: observedPricePaise, observedAtMs: nowMs }],
    ignoredUntilMs: existing?.ignoredUntilMs ?? null,
  };

  return { state: { ...state, priceObservations: { ...state.priceObservations, [catalogId]: tracked } } };
}

export interface PriceSuggestion {
  readonly catalogId: string;
  readonly suggestedPricePaise: Paise;
  readonly observationCount: number;
}

/** A suggestion for every product with >=3 observations of the SAME
 * alternate price within the last 30 days - never any product with only
 * ignore-suppressed or stale observations. This is the only way a caller
 * learns a price might have changed; accepting it (writing
 * shop_products.price) is the caller's job, not this module's - there is
 * deliberately no accept()/apply() export here. */
export function getPriceSuggestions(state: LearningState, nowMs: number): readonly PriceSuggestion[] {
  const suggestions: PriceSuggestion[] = [];
  const windowStart = nowMs - PRICE_SUGGESTION_WINDOW_MS;

  for (const tracked of Object.values(state.priceObservations)) {
    if (tracked.ignoredUntilMs !== null && nowMs < tracked.ignoredUntilMs) {
      continue;
    }

    const counts = new Map<Paise, number>();
    for (const observation of tracked.observations) {
      if (observation.observedAtMs > windowStart && observation.observedAtMs <= nowMs) {
        counts.set(observation.pricePaise, (counts.get(observation.pricePaise) ?? 0) + 1);
      }
    }

    for (const [pricePaise, observationCount] of counts) {
      if (observationCount >= PRICE_SUGGESTION_MIN_OBSERVATIONS) {
        suggestions.push({ catalogId: tracked.catalogId, suggestedPricePaise: pricePaise, observationCount });
      }
    }
  }

  return suggestions;
}

/** [Ignore] - suppresses suggestions for this product for 90 days. A
 * no-op if nothing is being tracked for it yet. */
export function ignorePriceSuggestion(state: LearningState, catalogId: string, nowMs: number): LearningState {
  const existing = state.priceObservations[catalogId];
  if (!existing) {
    return state;
  }
  return {
    ...state,
    priceObservations: {
      ...state.priceObservations,
      [catalogId]: { ...existing, ignoredUntilMs: nowMs + PRICE_SUGGESTION_IGNORE_MS },
    },
  };
}
