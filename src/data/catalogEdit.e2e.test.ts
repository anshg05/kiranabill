import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullBaseProducts, pullShopProducts } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { addFromReadyCatalog, saveProductPrice } from "./catalogEdit";

/**
 * KB-311 (S4 Catalog): catalog edits are written to Postgres ONLINE, then the
 * ordinary pull brings them into Dexie (shop_products is a pull-only cache,
 * 03 section 0). Real local stack (D21, D32): a real signUp, real RLS, the
 * real pull. Refuses anything but localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start` and every migration).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

describe("KB-311 catalog edits - real local stack", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-catalog-${crypto.randomUUID()}`);

  async function local(id: string) {
    const row = await localDb.shopProducts.get(id);
    if (!row) throw new Error(`no local shop product ${id}`);
    return row;
  }

  async function serverUpdatedAt(id: string): Promise<Date> {
    const res = await pg.query<{ updated_at: Date }>("select updated_at from shop_products where id = $1", [id]);
    return res.rows[0]!.updated_at;
  }

  async function addBase(name: string) {
    const base = (await localDb.baseProducts.toArray()).find((b) => b.displayName === name);
    if (!base) throw new Error(`no base product "${name}"`);
    const result = await addFromReadyCatalog(client, localDb, shopId, deviceId, base);
    expect(result).toEqual({ ok: true });
    const row = (await localDb.shopProducts.where("shopId").equals(shopId).toArray()).find((p) => p.baseProductId === base.id);
    if (!row) throw new Error(`"${name}" did not arrive in Dexie`);
    return { base, row };
  }

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({
      email: `e2e-${crypto.randomUUID()}@kb311.local`,
      password: crypto.randomUUID(),
    });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-311 e2e", phone: null, catalogMode: "custom_only" });
    shopId = shop.id;
    await pullBaseProducts(client, localDb);
    await pullShopProducts(client, localDb, shopId);
  });

  afterAll(async () => {
    await pg?.end();
  });

  it("1. the trigger sets updated_at = now() on insert and on update - a client-sent time is ignored", async () => {
    const before = Date.now() - 60_000; // generous for WSL clock skew (20 section 4d)
    const id = crypto.randomUUID();
    const ins = await client.from("shop_products").insert({
      id, shop_id: shopId, display_name: `Trigger ${id}`, unit: "kg", price_paise: 100, source: "custom",
      local_id: crypto.randomUUID(), device_id: deviceId, updated_at: "2020-01-01T00:00:00Z",
    });
    expect(ins.error).toBeNull();
    expect((await serverUpdatedAt(id)).getTime()).toBeGreaterThan(before);

    await pg.query("update shop_products set updated_at = '2020-01-01' where id = $1", [id]);
    expect((await serverUpdatedAt(id)).getFullYear()).toBeGreaterThan(2020); // the trigger wins even here
    const upd = await client.from("shop_products").update({ price_paise: 200, updated_at: "2020-01-01T00:00:00Z" }).eq("id", id);
    expect(upd.error).toBeNull();
    expect((await serverUpdatedAt(id)).getTime()).toBeGreaterThan(before);
  });

  it("2. Add from ready catalog copies the base product (name, unit, suggested price, aliases, source 'base') and re-pulls it into Dexie and the billing catalog", async () => {
    const { base, row } = await addBase("Chakki Aata");
    expect(row).toMatchObject({
      displayName: base.displayName, unit: base.defaultUnit, pricePaise: base.suggestedPricePaise,
      aliases: base.aliases, source: "base", isActive: true, category: base.sourceCategory,
    });
    const { entries } = await loadShopCatalog(localDb, shopId);
    expect(entries.find((e) => e.id === row.id)?.suggestedPricePaise).toBe(base.suggestedPricePaise);
  });

  it("3. adding the same name again is 'duplicate' - nothing written, nothing changed locally", async () => {
    const base = (await localDb.baseProducts.toArray()).find((b) => b.displayName === "Chakki Aata")!;
    const before = await localDb.shopProducts.where("shopId").equals(shopId).count();
    expect(await addFromReadyCatalog(client, localDb, shopId, deviceId, base)).toEqual({ ok: false, reason: "duplicate" });
    expect(await localDb.shopProducts.where("shopId").equals(shopId).count()).toBe(before);
  });

  it("4. a price save goes to the server, then the pull brings it to Dexie and the billing catalog", async () => {
    const { row } = await addBase("Desi Shakkar");
    expect(await saveProductPrice(client, localDb, shopId, row.id, 5_250)).toEqual({ ok: true });
    const server = await pg.query<{ price_paise: string }>("select price_paise from shop_products where id = $1", [row.id]);
    expect(Number(server.rows[0]!.price_paise)).toBe(5_250);
    expect((await local(row.id)).pricePaise).toBe(5_250);
    const { entries } = await loadShopCatalog(localDb, shopId);
    expect(entries.find((e) => e.id === row.id)?.suggestedPricePaise).toBe(5_250);
  });

  it("5. a failed save (no server) changes NOTHING locally - never a local-first price", async () => {
    const { row } = await addBase("Toor Daal");
    const dead = createClient("http://127.0.0.1:9", anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect(await saveProductPrice(dead, localDb, shopId, row.id, 9_999)).toEqual({ ok: false, reason: "failed" });
    expect((await local(row.id)).pricePaise).toBe(row.pricePaise);
  });

  it("6. a save that RLS filters to zero rows (another shop's product) is 'failed', not ok", async () => {
    const other = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await other.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb311.local`, password: crypto.randomUUID() });
    expect(error).toBeNull();
    const row = (await localDb.shopProducts.where("shopId").equals(shopId).first())!;
    expect(await saveProductPrice(other, localDb, shopId, row.id, 1)).toEqual({ ok: false, reason: "failed" });
    const server = await pg.query<{ price_paise: string }>("select price_paise from shop_products where id = $1", [row.id]);
    expect(Number(server.rows[0]!.price_paise)).toBe(row.pricePaise);
  });

  it("7. pull overlap: a row whose transaction COMMITS after the cursor passed its updated_at is still pulled", async () => {
    const { row: slow } = await addBase("Bath Sabun");
    const { row: fast } = await addBase("Sabun");
    // Device 1's transaction starts first (its now() is earlier) but commits last.
    await pg.query("begin");
    await pg.query("update shop_products set price_paise = 4321 where id = $1", [slow.id]);
    await new Promise((r) => setTimeout(r, 300));
    // Device 2 saves and pulls meanwhile: the cursor moves past the slow row's updated_at.
    expect(await saveProductPrice(client, localDb, shopId, fast.id, 1_234)).toEqual({ ok: true });
    const cursor = (await localDb.syncState.get(`shopProducts:${shopId}`))!.lastSyncedAt!;
    await pg.query("commit");
    expect((await serverUpdatedAt(slow.id)).getTime()).toBeLessThan(new Date(cursor).getTime()); // the race really happened

    await pullShopProducts(client, localDb, shopId);
    expect((await local(slow.id)).pricePaise).toBe(4_321);
    expect((await local(fast.id)).pricePaise).toBe(1_234);
  });
});
