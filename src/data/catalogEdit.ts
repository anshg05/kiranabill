import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB, LocalBaseProduct } from "./db";
import { pullShopProducts } from "./sync";

// KB-311 (S4 Catalog): shop_products is a pull-only cache (03 section 0), so a
// catalog edit is written to Postgres ONLINE and then the ordinary pull brings
// it into Dexie - never a local-first write that a later pull could undo or
// that never reaches the server. The caller re-loads the billing catalog after
// an ok: new lines use the new price; lines already on the bill keep theirs.

export type CatalogWriteResult = { ok: true } | { ok: false; reason: "duplicate" | "failed" };

const UNIQUE_VIOLATION = "23505"; // (shop_id, lower(display_name))

export async function saveProductPrice(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  productId: string,
  pricePaise: number,
): Promise<CatalogWriteResult> {
  try {
    // updated_at is set by the server trigger (KB-311 migration). RLS filters
    // another shop's row to zero rows silently - zero rows is a failure, not ok.
    const { data, error } = await client
      .from("shop_products")
      .update({ price_paise: pricePaise })
      .eq("id", productId)
      .eq("shop_id", shopId)
      .select("id");
    if (error || !data || data.length !== 1) {
      console.warn(`[catalog] price save failed: ${error?.message ?? `${data?.length ?? 0} rows`}`);
      return { ok: false, reason: "failed" };
    }
  } catch (err) {
    console.warn("[catalog] price save failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "failed" };
  }
  await pullShopProducts(client, localDb, shopId);
  return { ok: true };
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
