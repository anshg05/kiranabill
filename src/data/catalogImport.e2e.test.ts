import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullShopProducts } from "./sync";
import { IMPORT_BATCH, importProducts, type ImportRow } from "./catalogImport";

/**
 * KB-314 (D68): bulk catalog import - written ONLINE in batches of 200 (one atomic insert each), then the ordinary
 * pull brings the products into Dexie. Real local stack (D21, D32): real sign-up, real RLS, real unique index.
 * Refuses anything but localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start` and every migration).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
}

const row = (name: string, over: Partial<ImportRow> = {}): ImportRow => ({ name, pricePaise: 4_500, unit: "kg", category: null, aliases: [], sku: null, barcode: null, ...over });
const many = (n: number, prefix = "Item"): ImportRow[] => Array.from({ length: n }, (_, i) => row(`${prefix} ${i + 1}`, { pricePaise: 100 + i }));

describe("KB-314 bulk catalog import - real local stack", () => {
  let client: SupabaseClient;
  let otherClient: SupabaseClient;
  let pg: Client;
  let shopId: string;
  let otherShopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-import-${crypto.randomUUID()}`);

  const serverCount = async (shop = shopId) => Number((await pg.query("select count(*) from shop_products where shop_id = $1", [shop])).rows[0].count);

  async function signedInShop(label: string) {
    const c = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await c.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb314.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(c, { ownerUserId: data.user.id, name: label, phone: null, catalogMode: "custom_only" });
    return { c, shopId: shop.id };
  }

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    ({ c: client, shopId } = await signedInShop("KB-314 e2e"));
    ({ c: otherClient, shopId: otherShopId } = await signedInShop("KB-314 other"));
    await pullShopProducts(client, localDb, shopId);
  });

  afterAll(async () => {
    await pg?.end();
  });

  let imported: ImportRow[] = [];

  it("1. imports 450 rows in batches of 200 - all on the server, all pulled into Dexie as 'custom' with their price, unit, category, aliases, sku and barcode", async () => {
    const rows = many(450);
    imported = rows;
    rows[0] = row("Chini", { pricePaise: 4_850, unit: "kg", category: "Grocery", aliases: ["cheeni", "चीनी"], sku: "S-1", barcode: "8901234567890" });
    const progress: number[] = [];
    const t0 = Date.now();
    const out = await importProducts(client, localDb, shopId, deviceId, rows, (done) => progress.push(done));
    const ms = Date.now() - t0;
    console.info(`[kb314] 450 rows imported in ${ms} ms`);
    expect(out).toEqual({ added: 450, alreadyThere: 0, failed: [], notSent: 0, stopReason: null });
    expect(IMPORT_BATCH).toBe(200);
    expect(progress).toEqual([200, 400, 450]);
    expect(await serverCount()).toBe(450);
    const local = await localDb.shopProducts.where("shopId").equals(shopId).toArray();
    expect(local).toHaveLength(450);
    const chini = local.find((p) => p.displayName === "Chini")!;
    expect(chini).toMatchObject({ source: "custom", unit: "kg", pricePaise: 4_850, category: "Grocery", aliases: ["cheeni", "चीनी"], sku: "S-1", barcode: "8901234567890", isActive: true, baseProductId: null });
    expect(Number.isInteger(chini.pricePaise)).toBe(true);
    const dev = await pg.query("select distinct device_id from shop_products where shop_id = $1", [shopId]);
    expect(dev.rows.map((r) => r.device_id)).toEqual([deviceId]);
  });

  it("2. running the same import again adds nothing and changes nothing - every row is 'already there', prices included", async () => {
    const before = await pg.query("select id, price_paise, unit, updated_at from shop_products where shop_id = $1 order by id", [shopId]);
    const again = imported.map((r) => ({ ...r, pricePaise: r.pricePaise + 999, unit: "gm" })); // different price AND unit in the file
    const out = await importProducts(client, localDb, shopId, deviceId, again);
    expect(out).toMatchObject({ added: 0, alreadyThere: 450, failed: [], notSent: 0 });
    const after = await pg.query("select id, price_paise, unit, updated_at from shop_products where shop_id = $1 order by id", [shopId]);
    expect(after.rows).toEqual(before.rows); // not a price, a unit or a timestamp moved (hard rule 7)
    expect(await serverCount()).toBe(450);
  });

  it("3. a name the server has but this phone does not (a stale copy) is 'already there' - the rest of its batch still lands", async () => {
    await pg.query(
      "insert into shop_products (shop_id, display_name, unit, price_paise, source, local_id, device_id) values ($1, 'Zeera', 'kg', 30000, 'custom', gen_random_uuid(), 'other-phone')",
      [shopId],
    );
    expect(await localDb.shopProducts.where("shopId").equals(shopId).filter((p) => p.displayName === "Zeera").count()).toBe(0);
    const out = await importProducts(client, localDb, shopId, deviceId, [row("Haldi"), row("Zeera"), row("Mirch")]);
    expect(out).toMatchObject({ added: 2, alreadyThere: 1, failed: [], notSent: 0 });
    const names = (await pg.query("select display_name, price_paise from shop_products where shop_id = $1 and display_name in ('Haldi','Zeera','Mirch') order by display_name", [shopId])).rows;
    expect(names).toEqual([{ display_name: "Haldi", price_paise: "4500" }, { display_name: "Mirch", price_paise: "4500" }, { display_name: "Zeera", price_paise: "30000" }]); // Zeera keeps the server's price
    expect(await localDb.shopProducts.where("shopId").equals(shopId).filter((p) => p.displayName === "Zeera").count()).toBe(1); // pulled in
  });

  it("4. a batch is atomic: a bad row in the second batch leaves the first batch in and the second batch entirely out, and the import stops", async () => {
    const rows = many(250, "Atomic");
    rows[230] = row("Atomic bad", { pricePaise: 0 }); // violates price_paise > 0
    const out = await importProducts(client, localDb, shopId, deviceId, rows);
    expect(out.added).toBe(200);
    expect(out.notSent).toBe(50);
    expect(out.stopReason).toMatch(/23514|price/i);
    const n = Number((await pg.query("select count(*) from shop_products where shop_id = $1 and display_name like 'Atomic %'", [shopId])).rows[0].count);
    expect(n).toBe(200); // none of rows 201-250 - one statement, all or nothing
  });

  it("5. the same names in ANOTHER shop import fine - uniqueness is per shop", async () => {
    const out = await importProducts(otherClient, new KiranaBillDB(`e2e-import-other-${crypto.randomUUID()}`), otherShopId, deviceId, [row("Chini"), row("Haldi")]);
    expect(out).toMatchObject({ added: 2, alreadyThere: 0 });
    expect(await serverCount(otherShopId)).toBe(2);
  });

  it("6. RLS: a user cannot import into a shop they do not belong to - nothing is written, and the import stops at once", async () => {
    const before = await serverCount(otherShopId);
    const out = await importProducts(client, localDb, otherShopId, deviceId, many(300, "Intruder"));
    expect(out.added).toBe(0);
    expect(out.notSent).toBe(300);
    expect(out.stopReason).toMatch(/42501|security|permission/i);
    expect(await serverCount(otherShopId)).toBe(before);
  });

  it("7. every row gets a deterministic local_id from its name - the same name is the same id, in any shop's own namespace", async () => {
    const a = (await pg.query("select local_id from shop_products where shop_id = $1 and display_name = 'Chini'", [shopId])).rows[0].local_id;
    const b = (await pg.query("select local_id from shop_products where shop_id = $1 and display_name = 'Chini'", [otherShopId])).rows[0].local_id;
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b); // the shop is part of the id
  });

  it("8. an empty import is a no-op", async () => {
    expect(await importProducts(client, localDb, shopId, deviceId, [])).toEqual({ added: 0, alreadyThere: 0, failed: [], notSent: 0, stopReason: null });
  });
});
