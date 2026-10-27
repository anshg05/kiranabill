import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB } from "./db";
import { createShop, findOwnShop } from "./shops";
import { bootstrapAfterOnboarding } from "./bootstrap";
import { requestBillNumber } from "./receiptNumbers";

/**
 * KB-348 (owner, 20 Oct 2026; D90): self sign-up - any Google account can sign up and create a shop. The new-user path on
 * the real local stack, for TWO brand-new users: sign-up -> set-up -> Ready catalog -> a receipt block -> numbered bills,
 * each shop apart from the other; one shop per owner (a unique index, and a double tap on set-up cannot make a second).
 * Google itself cannot run locally (the dev e-mail sign-up stands in for it - the same auth.users row and JWT).
 * Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function newUser(label: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email: `e2e-${label}-${crypto.randomUUID()}@kb348.local`, password: crypto.randomUUID() });
  if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
  return { client, userId: data.user.id };
}

describe("KB-348 the new-user path - two brand-new users, real local stack", () => {
  let a: { client: SupabaseClient; userId: string };
  let b: { client: SupabaseClient; userId: string };
  const dbA = new KiranaBillDB(`e2e-signup-a-${crypto.randomUUID()}`);
  const dbB = new KiranaBillDB(`e2e-signup-b-${crypto.randomUUID()}`);
  const deviceA = "aaaaaaaa-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const deviceB = "bbbbbbbb-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
    a = await newUser("a");
    b = await newUser("b");
  });
  afterAll(() => {
    dbA.close();
    dbB.close();
  });

  it("1. set-up with the Ready catalog: the shop, its owner membership and the whole catalog (no receipt block any more - KB-351)", async () => {
    const shop = await createShop(a.client, { ownerUserId: a.userId, name: "Sharma Kirana", phone: null, catalogMode: "base_imported" });
    await bootstrapAfterOnboarding(a.client, dbA, { shopId: shop.id, deviceId: deviceA, catalogChoice: "ready" });
    const products = await a.client.from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", shop.id);
    expect(products.count ?? 0).toBeGreaterThan(400);
    const blocks = await a.client.from("receipt_number_blocks").select("block_start, block_end").eq("shop_id", shop.id);
    expect(blocks.data).toEqual([]);
    const first = await requestBillNumber(a.client, shop.id, crypto.randomUUID());
    expect(first).toMatchObject({ receiptNumber: "1", source: "counter" }); // a new shop starts at bill 1
  });

  it("2. a second new user gets their OWN shop, catalog and numbers from 1 - and cannot see the first user's", async () => {
    const shopA = (await findOwnShop(a.client, a.userId))!;
    const shopB = await createShop(b.client, { ownerUserId: b.userId, name: "Verma Store", phone: null, catalogMode: "custom_only" });
    await bootstrapAfterOnboarding(b.client, dbB, { shopId: shopB.id, deviceId: deviceB, catalogChoice: "empty" });
    expect(shopB.id).not.toBe(shopA.id);
    expect((await requestBillNumber(b.client, shopB.id, crypto.randomUUID()))?.receiptNumber).toBe("1");
    const peek = await b.client.from("shops").select("id").eq("id", shopA.id);
    expect(peek.data).toEqual([]);
    const peekProducts = await b.client.from("shop_products").select("id").eq("shop_id", shopA.id).limit(1);
    expect(peekProducts.data).toEqual([]);
    const empty = await b.client.from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", shopB.id);
    expect(empty.count).toBe(0); // "Start empty" means empty
  });

  it("3. one shop per owner: a second insert through the API is refused by the database (23505)", async () => {
    const second = await a.client.from("shops").insert({ owner_user_id: a.userId, name: "Another shop", phone: null, catalog_mode: "custom_only" });
    expect(second.error?.code).toBe("23505");
    expect((await a.client.from("shops").select("id").eq("owner_user_id", a.userId)).data).toHaveLength(1);
  });

  it("4. a double tap on set-up (two createShop calls at once for a brand-new user) ends with ONE shop and both calls succeed", async () => {
    const c = await newUser("c");
    const [one, two] = await Promise.all([
      createShop(c.client, { ownerUserId: c.userId, name: "Double Tap Store", phone: null, catalogMode: "custom_only" }),
      createShop(c.client, { ownerUserId: c.userId, name: "Double Tap Store", phone: null, catalogMode: "custom_only" }),
    ]);
    expect(one.id).toBe(two.id);
    expect((await c.client.from("shops").select("id").eq("owner_user_id", c.userId)).data).toHaveLength(1);
    expect((await c.client.from("shop_members").select("user_id").eq("shop_id", one.id)).data).toHaveLength(1);
    // and the next start still finds it (findOwnShop reads with maybeSingle, which errors on two rows)
    expect((await findOwnShop(c.client, c.userId))?.id).toBe(one.id);
  });
});
