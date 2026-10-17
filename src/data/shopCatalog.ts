import type { CatalogEntry, GuardCategory } from "@/domain/catalog";
import type { UsageSignal } from "@/domain/vocabulary";
import type { KiranaBillDB, LocalShopProduct } from "@/data/db";
import { aliasKeyOf, promotedAliases, toLearnedMap, type LearnedMap } from "@/domain/aliasEvidence";
import { deriveShopAliases, loadRecentFrequency } from "./aliasEvidence";

// KB-302 (owner, Q2; D4): the catalog Layer 1, the Layer 2 slice, reviewFlags
// and the Whisper vocabulary all use - THIS shop's own products from Dexie,
// at the shop's own prices. Never the base seed. Works offline (Dexie only).

const GUARD_CATEGORIES = new Set<GuardCategory>([
  "dal", "oil", "masala", "tea", "grain", "soap", "hygiene", "dairy", "snack",
  "sweet", "beverage", "condiment", "dryfruit", "household", "medicine", "other",
]);

export interface ShopCatalog {
  entries: CatalogEntry[];
  /** Per shop product id: bills in the last 30 days (KB-321) - the Catalog's order and the vocabulary's ranking signal. */
  usageById: Record<string, UsageSignal>;
  /** KB-323: the learned aliases that were added to `entries` (in memory only) - what the first-use note is about. */
  learned: LearnedMap;
}

function toEntry(p: LocalShopProduct, guardByBaseId: ReadonlyMap<string, string>): CatalogEntry {
  // The category guard (validator.ts) comes from the base product this was
  // copied from; a custom or learned product has none to inherit -> "other".
  const guard = p.baseProductId ? guardByBaseId.get(p.baseProductId) : undefined;
  return {
    id: p.id,
    displayName: p.displayName,
    sourceCategory: p.category ?? "",
    guardCategory: guard && GUARD_CATEGORIES.has(guard as GuardCategory) ? (guard as GuardCategory) : "other",
    unit: p.unit,
    suggestedPricePaise: p.pricePaise, // the SHOP's price, not the seed's
    aliases: p.aliases,
    isActive: p.isActive,
  };
}

export async function loadShopCatalog(db: KiranaBillDB, shopId: string): Promise<ShopCatalog> {
  const products = (await db.shopProducts.where("shopId").equals(shopId).toArray()).filter((p) => p.isActive);
  const baseIds = [...new Set(products.flatMap((p) => (p.baseProductId ? [p.baseProductId] : [])))];
  const bases = baseIds.length ? await db.baseProducts.bulkGet(baseIds) : [];
  const guardByBaseId = new Map(bases.flatMap((b) => (b ? [[b.id, b.guardCategory] as const] : [])));
  const entries = products.map((p) => toEntry(p, guardByBaseId));
  const frequency = await loadRecentFrequency(db, shopId);

  // KB-323 (D81): promoted learned aliases join the PARSER's copy of the catalog, never shop_products.aliases (a server
  // cache; D81 changes 08 section 4 here). A phrase that is already some product's exact name or alias is never taken
  // over (KI-52: a different product billed with no flag), and an archived product's alias is not used.
  const taken = new Set(entries.flatMap((e) => [e.displayName, ...e.aliases].map(aliasKeyOf)));
  const usable = promotedAliases(await deriveShopAliases(db, shopId)).filter((a) => !taken.has(a.aliasKey) && entries.some((e) => e.id === a.catalogId));
  const extra = new Map<string, string[]>();
  for (const a of usable) extra.set(a.catalogId, [...(extra.get(a.catalogId) ?? []), a.alias.trim()]);
  return {
    entries: entries.map((e) => (extra.has(e.id) ? { ...e, aliases: [...e.aliases, ...extra.get(e.id)!] } : e)),
    usageById: Object.fromEntries(products.map((p) => [p.id, { useCount: p.useCount, recentFrequency: frequency[p.id] ?? 0 }])),
    learned: toLearnedMap(usable),
  };
}
