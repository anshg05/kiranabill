import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB, LocalShop } from "@/data/db";
import { copyBaseCatalog } from "@/data/shops";
import { reserveBlock } from "@/data/receiptNumbers";
import { pullBaseProducts, pullReceiptNumberBlocks, pullShop, pullShopProducts } from "@/data/sync";

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
 * A receipt block this device can still number from, or a freshly reserved
 * one. Only THIS device's blocks count (D38). A reservation that fails
 * (offline) is not an error - consumeNextNumber falls back to a device-
 * scoped number, and the next online start reserves again.
 */
export async function ensureReceiptBlock(
  client: SupabaseClient,
  db: KiranaBillDB,
  shopId: string,
  deviceId: string,
): Promise<"existing" | "reserved" | "unavailable"> {
  const usable = async () =>
    (await db.receiptNumberBlocks.where("shopId").equals(shopId).toArray()).some(
      (block) => block.deviceId === deviceId && block.nextNumber <= block.blockEnd,
    );
  if (await usable()) return "existing";
  await reserveBlock(client, db, shopId, deviceId);
  return (await usable()) ? "reserved" : "unavailable";
}

/**
 * Right after the shop and its owner membership exist (createShop): copy the
 * ready catalog if chosen - stamped with THIS device's id - pull the shop and
 * its products into Dexie, reserve the first receipt block (16-APP-FLOW.md
 * §2: "reserved during onboarding, so the very first bill works even if the
 * network drops immediately after"), and bind this database to the shop.
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
  await ensureReceiptBlock(client, db, shopId, deviceId);
  await db.meta.put({ key: ACTIVE_SHOP_KEY, value: shopId });
  return readCachedShop(db);
}

/**
 * Every app start. Offline: nothing touches the network - the cached shop,
 * products and this device's block are all local. Online: refresh the shop,
 * products and this device's blocks, then make sure a usable block exists.
 */
export async function bootstrapOnStart(
  client: SupabaseClient,
  db: KiranaBillDB,
  params: { shopId: string; deviceId: string; online: boolean },
): Promise<LocalShop | null> {
  const { shopId, deviceId, online } = params;
  if (online) {
    await pullShop(client, db, shopId);
    await pullShopProducts(client, db, shopId);
    await pullBaseProducts(client, db);
    await pullReceiptNumberBlocks(client, db, shopId, deviceId);
    await ensureReceiptBlock(client, db, shopId, deviceId);
    await db.meta.put({ key: ACTIVE_SHOP_KEY, value: shopId });
  }
  return readCachedShop(db);
}
