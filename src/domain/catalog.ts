import catalogSeed from "./catalog-seed.json";

/**
 * Mirrors base_products in docs/03-DATA-MODEL.md section 3, trimmed to what
 * Phase 0 needs. Category is two fields (docs/07-DECISIONS.md D12):
 *
 * `sourceCategory` - the literal text of whichever comment header a product
 * sits under in legacy/products.js (e.g. "DALS / PULSES / LEGUMES"), one of
 * 48 values, assigned positionally by scripts/build-catalog-seed.ts. Pure
 * provenance - never used for guard logic.
 *
 * `guardCategory` - fifteen semantic buckets plus "other". The original seven
 * came from legacy CATEGORY_GUARDS (docs/14-LEGACY-REFERENCE.md section 5:
 * "dal", "oil", "masala", "tea", "grain", "soap", plus "hygiene" split out of
 * "soap"). Those six were hand-built for mishearings that had actually
 * happened, not as a taxonomy of a grocery shop, and left 58% of the catalog
 * in "other" - too coarse to guard anything ("biscuit" could match "bulb").
 * Eight more buckets were added to cover the rest of a real kirana's stock:
 * "dairy", "snack", "sweet", "beverage", "condiment", "dryfruit",
 * "household", "medicine". This is what KB-005b's validator reads to reject
 * a mismatched match (a "daal" matching a soap) - precomputed at seed time
 * from an explicit, committed mapping table in scripts/build-catalog-seed.ts,
 * not inferred by keyword matching at runtime. See docs/07-DECISIONS.md D12
 * and docs/12-PARKED.md NI-14 (closed).
 */
export type GuardCategory =
  | "dal"
  | "oil"
  | "masala"
  | "tea"
  | "grain"
  | "soap"
  | "hygiene"
  | "dairy"
  | "snack"
  | "sweet"
  | "beverage"
  | "condiment"
  | "dryfruit"
  | "household"
  | "medicine"
  | "other";

export interface CatalogEntry {
  id: string;
  displayName: string;
  sourceCategory: string;
  guardCategory: GuardCategory;
  unit: string;
  suggestedPricePaise: number;
  aliases: string[];
  isActive: boolean;
}

export const catalog: readonly CatalogEntry[] = catalogSeed as CatalogEntry[];

const byId = new Map(catalog.map((entry) => [entry.id, entry]));

export function getCatalogEntryById(id: string): CatalogEntry | undefined {
  return byId.get(id);
}
