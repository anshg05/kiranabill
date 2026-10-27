import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB, LocalShop } from "@/data/db";
import { copyBaseCatalog } from "@/data/shops";
import { pullBaseProducts, pullShop, pullShopProducts } from "@/data/sync";

// KB-315 (docs/12-PARKED.md KI-32, docs/07-DECISIONS.md D38): the runtime
// wiring that turns a signed-in user into a working, offline-capable device.
// Pure data orchestration - no React; ShopProvider calls it.

const ACTIVE_SHOP_KEY = "activeShopId";

/** The shop this user's local database is bound to, if one was ever set up
 * on this device. Reads Dexie only - works with no network. */
export async function readCachedShop(db: KiranaBillDB): Promise<LocalShop | null> {
  const active = await db.meta.get(ACTIVE_SHOP_KEY);
  if (!active) return null;
  return (await db.shops.get(active.value)) ?? null;
}

/**
 * Right after the shop and its owner membership exist (createShop): copy the
 * ready catalog if chosen - stamped with THIS device's id - pull the shop and
 * its products into Dexie and bind this database to the shop. (KB-351: no receipt block any more - the first bill asks the
 * server's counter, or takes an offline number.)
 */
export async function bootstrapAfterOnboarding(
  client: SupabaseClient,
  db: KiranaBillDB,
  params: { shopId: string; deviceId: string; catalogChoice: "ready" | "empty" },
): Promise<LocalShop | null> {
  const { shopId, deviceId, catalogChoice } = params;
  if (catalogChoice === "ready") await copyBaseCatalog(client, shopId, deviceId);
  await pullShop(client, db, shopId);
  await pullShopProducts(client, db, shopId);
  await pullBaseProducts(client, db);
  await db.meta.put({ key: ACTIVE_SHOP_KEY, value: shopId });
  return readCachedShop(db);
}

/**
 * Every app start. Offline: nothing touches the network - the cached shop and
 * products are all local. Online: refresh the shop and its products.
 */
export async function bootstrapOnStart(
  client: SupabaseClient,
  db: KiranaBillDB,
  params: { shopId: string; deviceId: string; online: boolean },
): Promise<LocalShop | null> {
  const { shopId, online } = params;
  if (online) {
    await pullShop(client, db, shopId);
    await pullShopProducts(client, db, shopId);
    await pullBaseProducts(client, db);
      await db.meta.put({ key: ACTIVE_SHOP_KEY, value: shopId });
  }
  return readCachedShop(db);
}
