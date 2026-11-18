// KB-321: how often this shop bills each product - the Catalog's order (data/shopCatalog.ts). 18 Nov 2026 (owner): the Whisper
// vocabulary built from it (KB-007's ranked prompt, switched off since KB-321) was deleted with the old voice path; only the signal stays.

export interface UsageSignal {
  /** Tier 1 - strongest signal: how often this product has been billed recently. */
  readonly recentFrequency?: number;
  /** Tier 2: learned/promoted use_count. */
  readonly useCount?: number;
}
