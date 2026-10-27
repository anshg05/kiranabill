import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { billFlags, type UtteranceRecord } from "@/domain/billEdit";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullShopProducts, syncNow } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { finaliseBill, type FinaliseInput } from "./finalise";
import { loadSearchIndex } from "./history";
import { addCustomProduct, saveProductDetails, setProductActive } from "./catalogEdit";

/**
 * KB-330 (D71, D77): the Catalog's rename, aliases edit, archive / restore and "Add product" on the real local stack
 * (D21, D32): a real signUp, real RLS, the real pull. Every write is ONLINE and goes to Postgres first (D62); the pull
 * brings it into Dexie. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("KB-330 catalog manage - real local stack", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-manage-${crypto.randomUUID()}`);

  const serverRow = async (id: string) =>
    (await pg.query<{ display_name: string; aliases: string[]; is_active: boolean; unit: string; price_paise: string; source: string }>(
      "select display_name, aliases, is_active, unit, price_paise, source from shop_products where id = $1",
      [id],
    )).rows[0];
  const local = async (id: string) => (await localDb.shopProducts.get(id))!;

  async function add(name: string, unit = "kg", pricePaise = 5_000) {
    expect(await addCustomProduct(client, localDb, shopId, deviceId, { name, unit, unitKnown: true, pricePaise })).toEqual({ ok: true });
    const row = (await localDb.shopProducts.where("shopId").equals(shopId).toArray()).find((p) => p.displayName === name);
    if (!row) throw new Error(`"${name}" did not arrive in Dexie`);
    return row;
  }

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb330.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-330 e2e", phone: null, catalogMode: "custom_only" })).id;
    await pullShopProducts(client, localDb, shopId);
  });
  afterAll(async () => {
    await pg?.end();
  });

  it("1. Add product: the import's insert path - source 'custom', the typed unit and exact paise, empty aliases; arrives in Dexie and the billing catalog", async () => {
    const row = await add("Jaggery Block", "kg", 12_550);
    expect(row).toMatchObject({ displayName: "Jaggery Block", unit: "kg", pricePaise: 12_550, source: "custom", isActive: true, aliases: [] });
    expect(await serverRow(row.id)).toMatchObject({ source: "custom", unit: "kg", is_active: true });
    expect((await loadShopCatalog(localDb, shopId)).entries.some((e) => e.id === row.id)).toBe(true);
  });

  it("2. adding a name that exists - any case, or ARCHIVED - is 'duplicate'; nothing is written", async () => {
    const row = await add("Ragi Flour");
    const before = await localDb.shopProducts.where("shopId").equals(shopId).count();
    const again = { name: "RAGI FLOUR", unit: "kg", unitKnown: true, pricePaise: 100 };
    expect(await addCustomProduct(client, localDb, shopId, deviceId, again)).toEqual({ ok: false, reason: "duplicate" });
    expect(await setProductActive(client, localDb, shopId, row.id, false)).toEqual({ ok: true });
    expect(await addCustomProduct(client, localDb, shopId, deviceId, again)).toEqual({ ok: false, reason: "duplicate" });
    expect(await localDb.shopProducts.where("shopId").equals(shopId).count()).toBe(before);
  });

  it("3. rename goes to the server, then Dexie and the billing catalog; unit and price are untouched", async () => {
    const row = await add("Moong Whole", "kg", 11_000);
    expect(await saveProductDetails(client, localDb, shopId, row.id, { display_name: "Green Moong" })).toEqual({ ok: true });
    expect(await serverRow(row.id)).toMatchObject({ display_name: "Green Moong", unit: "kg", price_paise: "11000" });
    expect((await local(row.id)).displayName).toBe("Green Moong");
    expect((await loadShopCatalog(localDb, shopId)).entries.find((e) => e.id === row.id)?.displayName).toBe("Green Moong");
  });

  it("4. a rename onto another product's name - archived too - is 'duplicate'; the server row is unchanged", async () => {
    const a = await add("Poha Thick");
    const b = await add("Poha Thin");
    expect(await saveProductDetails(client, localDb, shopId, b.id, { display_name: "poha thick" })).toEqual({ ok: false, reason: "duplicate" });
    expect(await setProductActive(client, localDb, shopId, a.id, false)).toEqual({ ok: true });
    expect(await saveProductDetails(client, localDb, shopId, b.id, { display_name: "Poha Thick" })).toEqual({ ok: false, reason: "duplicate" });
    expect((await serverRow(b.id))!.display_name).toBe("Poha Thin");
    // renaming the ARCHIVED one frees its name for a new product (D71's "archive + add again")
    expect(await saveProductDetails(client, localDb, shopId, a.id, { display_name: "Poha Thick (old)" })).toEqual({ ok: true });
    expect((await add("Poha Thick")).isActive).toBe(true);
  });

  it("5. aliases save: stored as given; a rename on one device and an aliases edit on another both survive (only changed columns are sent)", async () => {
    const row = await add("Suji Fine");
    // two devices both loaded the row as it was; each sends only what it changed
    expect(await saveProductDetails(client, localDb, shopId, row.id, { display_name: "Suji Rava" })).toEqual({ ok: true });
    expect(await saveProductDetails(client, localDb, shopId, row.id, { aliases: ["sooji", "rawa"] })).toEqual({ ok: true });
    expect(await serverRow(row.id)).toMatchObject({ display_name: "Suji Rava", aliases: ["sooji", "rawa"] });
    expect(await local(row.id)).toMatchObject({ displayName: "Suji Rava", aliases: ["sooji", "rawa"] });
  });

  it("6. an empty patch writes nothing and is ok", async () => {
    const row = await add("Sabudana");
    const before = await pg.query<{ updated_at: Date }>("select updated_at from shop_products where id = $1", [row.id]);
    expect(await saveProductDetails(client, localDb, shopId, row.id, {})).toEqual({ ok: true });
    const after = await pg.query<{ updated_at: Date }>("select updated_at from shop_products where id = $1", [row.id]);
    expect(after.rows[0]!.updated_at).toEqual(before.rows[0]!.updated_at);
  });

  it("7. archive keeps the row and its id; the product leaves the billing catalog; restore brings it back", async () => {
    const row = await add("Dalia");
    expect(await setProductActive(client, localDb, shopId, row.id, false)).toEqual({ ok: true });
    expect(await serverRow(row.id)).toMatchObject({ is_active: false, display_name: "Dalia" }); // never a delete
    expect((await local(row.id)).isActive).toBe(false);
    expect((await loadShopCatalog(localDb, shopId)).entries.some((e) => e.id === row.id)).toBe(false);
    expect(await setProductActive(client, localDb, shopId, row.id, true)).toEqual({ ok: true });
    expect((await loadShopCatalog(localDb, shopId)).entries.some((e) => e.id === row.id)).toBe(true);
  });

  it("8. a member's hard DELETE of a product is refused: zero rows, the row stays", async () => {
    const row = await add("Rusk Plain");
    const res = await client.from("shop_products").delete().eq("id", row.id).select("id");
    expect(res.data ?? []).toHaveLength(0);
    expect(await serverRow(row.id)).toBeDefined();
  });

  it("9. another shop's member renaming or archiving this shop's product affects zero rows -> 'failed'", async () => {
    const row = await add("Cornflakes");
    const other = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await other.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb330.local`, password: crypto.randomUUID() })).error).toBeNull();
    expect(await saveProductDetails(other, localDb, shopId, row.id, { display_name: "Hijacked" })).toEqual({ ok: false, reason: "failed" });
    expect(await setProductActive(other, localDb, shopId, row.id, false)).toEqual({ ok: false, reason: "failed" });
    expect(await serverRow(row.id)).toMatchObject({ display_name: "Cornflakes", is_active: true });
  });

  it("10. a failed write (no server) changes NOTHING locally - never local-first", async () => {
    const row = await add("Vermicelli");
    const dead = createClient("http://127.0.0.1:9", anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect(await saveProductDetails(dead, localDb, shopId, row.id, { display_name: "Nope" })).toEqual({ ok: false, reason: "failed" });
    expect(await setProductActive(dead, localDb, shopId, row.id, false)).toEqual({ ok: false, reason: "failed" });
    expect(await addCustomProduct(dead, localDb, shopId, deviceId, { name: "Nowhere", unit: "kg", unitKnown: true, pricePaise: 100 })).toMatchObject({ ok: false });
    expect(await local(row.id)).toMatchObject({ displayName: "Vermicelli", isActive: true });
    expect((await localDb.shopProducts.toArray()).some((p) => p.displayName === "Nowhere")).toBe(false);
  });

  it("11. a FINALISED bill keeps the old name after a rename and an archive - on the server, in Dexie and in History (hard rule 2)", async () => {
    const row = await add("Chakki Atta");
    const billDb = new KiranaBillDB(`e2e-manage-bill-${crypto.randomUUID()}`);
    const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
    const line: FinalLine = {
      id: "l1", utteranceId: 1, item: { ...items[0]!, catalogId: row.id }, original: { ...items[0]!, catalogId: row.id },
      displayName: "Chakki Atta", source: "fastpath",
    };
    const utterances: UtteranceRecord[] = [{ id: 1, lineIds: ["l1"], flags: [...evaluateReviewFlags("2 kilo chini", items, SEED_PARSER_CATALOG.entries)], transcript: "2 kilo chini" }];
    const flags = billFlags([line], utterances, SEED_PARSER_CATALOG.entries).map((f) => ({ ...f, acknowledged: f.severity === "HIGH" }));
    const input: FinaliseInput = { localId: crypto.randomUUID(), shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: [line], flags };
    await finaliseBill(billDb, input);
    await syncNow({ client, localDb: billDb, shopId, deviceId });

    expect(await saveProductDetails(client, localDb, shopId, row.id, { display_name: "Whole Wheat Flour" })).toEqual({ ok: true });
    expect(await setProductActive(client, localDb, shopId, row.id, false)).toEqual({ ok: true });

    const server = await pg.query<{ display_name: string; shop_product_id: string }>(
      "select i.display_name, i.shop_product_id from bill_items i join bills b on b.id = i.bill_id where b.shop_id = $1 and b.local_id = $2",
      [shopId, input.localId],
    );
    expect(server.rows).toEqual([{ display_name: "Chakki Atta", shop_product_id: row.id }]);
    expect((await billDb.billItems.where("billLocalId").equals(input.localId).toArray()).map((i) => i.displayName)).toEqual(["Chakki Atta"]);
    const history = await loadSearchIndex(billDb, shopId, null); // History's search rows carry the names as saved
    const text = JSON.stringify(history).toLowerCase(); // the search rows hold the names folded
    expect(text).toContain("chakki atta");
    expect(text).not.toContain("whole wheat flour");
  });
});
