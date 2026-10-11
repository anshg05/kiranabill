import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB, LocalBaseProduct } from "./db";
import type { NewProduct, ProductPatch } from "@/domain/catalogEdit";
import { importProducts } from "./catalogImport";
import { pullShopProducts } from "./sync";

// KB-311 (S4 Catalog): shop_products is a pull-only cache (03 section 0), so a
// catalog edit is written to Postgres ONLINE and then the ordinary pull brings
// it into Dexie - never a local-first write that a later pull could undo or
// that never reaches the server. The caller re-loads the billing catalog after
// an ok: new lines use the new price; lines already on the bill keep theirs.

export type CatalogWriteResult = { ok: true } | { ok: false; reason: "duplicate" | "failed" };

const UNIQUE_VIOLATION = "23505"; // (shop_id, lower(display_name))

/** One UPDATE of one product (RLS: a member of the shop), then the pull. Zero rows is a failure, not ok. */
async function updateProduct(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  productId: string,
  patch: Record<string, unknown>,
  what: string,
): Promise<CatalogWriteResult> {
  try {
    // updated_at is set by the server trigger (KB-311 migration). RLS filters
    // another shop's row to zero rows silently - zero rows is a failure, not ok.
    const { data, error } = await client.from("shop_products").update(patch).eq("id", productId).eq("shop_id", shopId).select("id");
    if (error?.code === UNIQUE_VIOLATION) {
      // A name the server has - archived ones count (the index covers every row); this device may not have it yet.
      await pullShopProducts(client, localDb, shopId);
      return { ok: false, reason: "duplicate" };
    }
    if (error || !data || data.length !== 1) {
      console.warn(`[catalog] ${what} failed: ${error?.message ?? `${data?.length ?? 0} rows`}`);
      return { ok: false, reason: "failed" };
    }
  } catch (err) {
    console.warn(`[catalog] ${what} failed:`, err instanceof Error ? err.message : err);
    return { ok: false, reason: "failed" };
  }
  await pullShopProducts(client, localDb, shopId);
  return { ok: true };
}

export function saveProductPrice(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  productId: string,
  pricePaise: number,
): Promise<CatalogWriteResult> {
  return updateProduct(client, localDb, shopId, productId, { price_paise: pricePaise }, "price save");
}

/**
 * KB-330 (D71): rename and/or aliases - only the changed columns (domain/catalogEdit.ts productPatch), so a rename on one
 * phone and an alias edit on another don't undo each other. A unit or a price can't be in a ProductPatch. Empty = nothing to do.
 */
export async function saveProductDetails(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  productId: string,
  patch: ProductPatch,
): Promise<CatalogWriteResult> {
  if (Object.keys(patch).length === 0) return { ok: true };
  return updateProduct(client, localDb, shopId, productId, { ...patch }, "details save");
}

/** KB-330 (D71): archive (false) or restore (true). Never a delete - bills refer to products. */
export function setProductActive(client: SupabaseClient, localDb: KiranaBillDB, shopId: string, productId: string, active: boolean): Promise<CatalogWriteResult> {
  return updateProduct(client, localDb, shopId, productId, { is_active: active }, active ? "restore" : "archive");
}

/** KB-330 (D77): "Add product" - ONE row through the KB-314 import's insert path (source 'custom'), so the two can never disagree. */
export async function addCustomProduct(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
  product: NewProduct,
): Promise<CatalogWriteResult> {
  const out = await importProducts(client, localDb, shopId, deviceId, [
    { name: product.name, pricePaise: product.pricePaise, unit: product.unit, category: null, aliases: [], sku: null, barcode: null, localId: crypto.randomUUID() },
  ]);
  if (out.added === 1) return { ok: true };
  return { ok: false, reason: out.alreadyThere > 0 ? "duplicate" : "failed" };
}

/** A copy of a ready-catalog (base) product into the shop, at its suggested price - like copy_base_catalog. */
export async function addFromReadyCatalog(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
  base: LocalBaseProduct,
): Promise<CatalogWriteResult> {
  try {
    const { error } = await client.from("shop_products").insert({
      shop_id: shopId,
      base_product_id: base.id,
      display_name: base.displayName,
      category: base.sourceCategory,
      unit: base.defaultUnit,
      price_paise: base.suggestedPricePaise,
      aliases: base.aliases,
      source: "base",
      local_id: crypto.randomUUID(),
      device_id: deviceId,
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        // The server has it and this device doesn't yet (another device added it) - bring it in.
        await pullShopProducts(client, localDb, shopId);
        return { ok: false, reason: "duplicate" };
      }
      console.warn(`[catalog] add failed: ${error.message}`);
      return { ok: false, reason: "failed" };
    }
  } catch (err) {
    console.warn("[catalog] add failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "failed" };
  }
  await pullShopProducts(client, localDb, shopId);
  return { ok: true };
}
