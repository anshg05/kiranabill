import type { CatalogEntry, GuardCategory } from "@/domain/catalog";
import type { UsageSignal } from "@/domain/vocabulary";
import type { KiranaBillDB, LocalShopProduct } from "@/data/db";

// KB-302 (owner, Q2; D4): the catalog Layer 1, the Layer 2 slice, reviewFlags
// and the Whisper vocabulary all use - THIS shop's own products from Dexie,
// at the shop's own prices. Never the base seed. Works offline (Dexie only).

const GUARD_CATEGORIES = new Set<GuardCategory>([
  "dal", "oil", "masala", "tea", "grain", "soap", "hygiene", "dairy", "snack",
  "sweet", "beverage", "condiment", "dryfruit", "household", "medicine", "other",
]);

export interface ShopCatalog {
  entries: CatalogEntry[];
  /** use_count per shop product id - the vocabulary ranking signal (vocabulary.ts). */
  usageById: Record<string, UsageSignal>;
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
  return {
    entries: products.map((p) => toEntry(p, guardByBaseId)),
    usageById: Object.fromEntries(products.map((p) => [p.id, { useCount: p.useCount }])),
  };
}
