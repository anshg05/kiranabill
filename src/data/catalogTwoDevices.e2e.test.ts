import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullShop, pullShopProducts, resetProbeState, syncNow } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { saveProductDetails, saveProductPrice, setProductActive } from "./catalogEdit";
import { subscribeCatalogPulled } from "./catalogPullStatus";
import { updateShopSettings } from "./shopSettings";

/**
 * KB-350 (BLOCKS THE RELEASE): two phones, one shop. Phone A changes a price; phone B's sync loop (the KB-345 probe cycle)
 * pulls it AND tells the billing screen, so B's billing catalog (parser, Add item, vocabulary) has the new price. Real
 * local stack. Refuses anything but localhost. Run: `npm run test:e2e`.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-350 a catalog change on another phone reaches the billing catalog", () => {
  let client: SupabaseClient;
  let shopId: string;
  const deviceA = "aaaaaaaa-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const deviceB = "bbbbbbbb-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const dbA = new KiranaBillDB(`e2e-350-a-${crypto.randomUUID()}`);
  const dbB = new KiranaBillDB(`e2e-350-b-${crypto.randomUUID()}`);
  let productId: string;
  let noticesB = 0;

  const cycleB = () => syncNow({ client, localDb: dbB, shopId, deviceId: deviceB, pull: "probe" });
  const priceOnB = async () => (await loadShopCatalog(dbB, shopId)).entries.find((e) => e.id === productId)?.suggestedPricePaise;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb350.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-350 e2e", phone: null, catalogMode: "custom_only" })).id;
    productId = crypto.randomUUID();
    const ins = await client.from("shop_products").insert({
      id: productId, shop_id: shopId, display_name: "Chini", unit: "kg", price_paise: 4500, source: "custom", local_id: crypto.randomUUID(), device_id: deviceA,
    });
    expect(ins.error).toBeNull();
    await pullShopProducts(client, dbA, shopId);
    await pullShop(client, dbA, shopId); // phone A has the shop row (settings are edited on a row the phone holds)
    resetProbeState();
    await cycleB(); // B's first cycle: the full pull, the baseline
    subscribeCatalogPulled(dbB.name, () => void noticesB++);
  });
  afterAll(() => {
    dbA.close();
    dbB.close();
  });

  it("1. A changes Chini to ₹60: B's next probe cycle pulls it and tells the billing screen once; B's billing catalog has ₹60", async () => {
    expect(await priceOnB()).toBe(4500);
    expect(await saveProductPrice(client, dbA, shopId, productId, 6000)).toEqual({ ok: true });
    const before = noticesB;
    await cycleB();
    expect(noticesB).toBe(before + 1);
    expect(await priceOnB()).toBe(6000);
  });

  it("2. a rename and an archive on A reach B the same way", async () => {
    await saveProductDetails(client, dbA, shopId, productId, { display_name: "Sugar loose" });
    let before = noticesB;
    await cycleB();
    expect(noticesB).toBe(before + 1);
    expect((await loadShopCatalog(dbB, shopId)).entries.find((e) => e.id === productId)?.displayName).toBe("Sugar loose");
    await setProductActive(client, dbA, shopId, productId, false);
    before = noticesB;
    await cycleB();
    expect(noticesB).toBe(before + 1);
    expect(await priceOnB()).toBeUndefined();
  });

  it("3. shop settings changed on A (name / bill language) land in B's Dexie and tell the screen", async () => {
    await updateShopSettings(dbA, shopId, { name: "Renamed Kirana", billLanguage: "hi" });
    await syncNow({ client, localDb: dbA, shopId, deviceId: deviceA, pull: "none" }); // A pushes
    const before = noticesB;
    await cycleB();
    expect(noticesB).toBe(before + 1);
    expect(await dbB.shops.get(shopId)).toMatchObject({ name: "Renamed Kirana", billLanguage: "hi" });
  });

  it("4. a quiet cycle tells nobody (nothing moved: no reload)", async () => {
    await cycleB(); // takes in A's own just-pushed shop row, if any
    const before = noticesB;
    await cycleB();
    expect(noticesB).toBe(before);
  });
});
