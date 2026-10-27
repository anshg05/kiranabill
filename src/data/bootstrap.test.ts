import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB } from "./db";
import { bootstrapOnStart, readCachedShop } from "./bootstrap";

// KB-315: orchestration only - the real-stack behaviour is bootstrap.e2e.test.ts.

/** A client that fails the test on ANY network use. */
const noNetworkClient = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`network used while offline: client.${String(prop)}`);
    },
  },
) as unknown as SupabaseClient;

describe("bootstrap.ts", () => {
  let db: KiranaBillDB;
  const shopId = "shop-1";
  const deviceId = "device-A";

  beforeEach(async () => {
    db = new KiranaBillDB(`bootstrap-test-${crypto.randomUUID()}`);
    await db.shops.put({
      id: shopId, syncStatus: "synced", name: "Cached Shop", phone: null, address: null, logoUrl: null,
      catalogMode: "base_imported", billLanguage: "hi", receiptPrefix: "KB", updatedAt: "2026-09-27T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.delete();
  });

  it("readCachedShop: null until this database is bound to a shop, then the cached row", async () => {
    expect(await readCachedShop(db)).toBeNull();
    await db.meta.put({ key: "activeShopId", value: shopId });
    expect((await readCachedShop(db))?.name).toBe("Cached Shop");
  });

  it("offline start makes NO network call and returns the cached shop", async () => {
    await db.meta.put({ key: "activeShopId", value: shopId });
    const shop = await bootstrapOnStart(noNetworkClient, db, { shopId, deviceId, online: false });
    expect(shop?.id).toBe(shopId);
  });
});
