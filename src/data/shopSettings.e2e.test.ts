import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullShop, pushLearningEvents, pushShop } from "./sync";
import { updateShopSettings } from "./shopSettings";
import { resetLearning } from "./learningAudit";

/**
 * KB-312 (S7) + KI-65, D64: shop edits sync with the SERVER's updated_at as the only clock.
 * Real local stack (D21, D32): a real signUp, real RLS, the real trigger, the real pushShop /
 * pullShop / pushLearningEvents. Two "devices" = two Dexie databases of the same user.
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
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

describe("KB-312 / KI-65 shop settings sync - real local stack", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const dbA = new KiranaBillDB(`e2e-shop-a-${crypto.randomUUID()}`);
  const dbB = new KiranaBillDB(`e2e-shop-b-${crypto.randomUUID()}`);

  /** The server's updated_at exactly as PostgREST returns it (microseconds and all). */
  async function serverUpdatedAt(): Promise<string> {
    const { data, error } = await client.from("shops").select("updated_at").eq("id", shopId).single();
    if (error) throw error;
    return data.updated_at as string;
  }

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb312.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-312 e2e", phone: null, catalogMode: "custom_only" });
    shopId = shop.id;
    await pullShop(client, dbA, shopId);
    await pullShop(client, dbB, shopId);
  });

  afterAll(async () => {
    await pg?.end();
    dbA.close();
    dbB.close();
  });

  it("1. the trigger stamps updated_at on insert and on update; a client-sent value is ignored", async () => {
    const before = await serverUpdatedAt();
    const { error } = await client.from("shops").update({ name: "Trigger Test", updated_at: "2020-01-01T00:00:00Z" }).eq("id", shopId);
    expect(error).toBeNull();
    const after = await serverUpdatedAt();
    expect(new Date(after).getFullYear()).toBeGreaterThan(2020);
    expect(after).not.toBe(before);
    // and a direct SQL edit that doesn't mention updated_at at all moves it too (the Studio case)
    await pg.query("update shops set name = 'Studio Edit' where id = $1", [shopId]);
    expect(await serverUpdatedAt()).not.toBe(after);
  });

  it("2. a Studio-style server edit (updated_at not touched) reaches the device, and a second pull is a no-op", async () => {
    await pg.query("update shops set name = 'Edited In Studio', bill_language = 'hi' where id = $1", [shopId]);
    await pullShop(client, dbA, shopId);
    expect(await dbA.shops.get(shopId)).toMatchObject({ name: "Edited In Studio", billLanguage: "hi", syncStatus: "synced", updatedAt: await serverUpdatedAt() });
    const stored = await dbA.shops.get(shopId);
    await pullShop(client, dbA, shopId);
    expect(await dbA.shops.get(shopId)).toEqual(stored); // verbatim string equal: nothing re-taken
    await pullShop(client, dbB, shopId);
  });

  it("3. an edit made offline is pending, pushes later, and the device then holds the server's updated_at verbatim", async () => {
    const saved = await updateShopSettings(dbA, shopId, { name: "Offline Edit", phone: "9876543210", billLanguage: "both" });
    expect(saved?.syncStatus).toBe("pending");
    expect((await pushShop(client, dbA)).anyTransientFailure).toBe(false);
    const local = await dbA.shops.get(shopId);
    expect(local).toMatchObject({ name: "Offline Edit", phone: "9876543210", billLanguage: "both", syncStatus: "synced" });
    expect(local?.updatedAt).toBe(await serverUpdatedAt());
    const server = await pg.query("select name, phone, bill_language from shops where id = $1", [shopId]);
    expect(server.rows[0]).toEqual({ name: "Offline Edit", phone: "9876543210", bill_language: "both" });
  });

  it("4. clock skew: device B's clock is 5 minutes ahead and edits first; A's LATER edit still wins on B", async () => {
    await pullShop(client, dbB, shopId); // B is current
    const fiveMinutesAhead = Date.now() + 5 * 60_000;
    await updateShopSettings(dbB, shopId, { name: "B Edit (clock +5 min)" }, fiveMinutesAhead);
    expect((await dbB.shops.get(shopId))?.updatedAt).toBe(new Date(fiveMinutesAhead).toISOString()); // B's own, skewed
    await pushShop(client, dbB);
    // B now holds the SERVER's time, not its skewed clock
    expect((await dbB.shops.get(shopId))?.updatedAt).toBe(await serverUpdatedAt());

    await pullShop(client, dbA, shopId);
    expect((await dbA.shops.get(shopId))?.name).toBe("B Edit (clock +5 min)");
    await updateShopSettings(dbA, shopId, { name: "A Later Edit" }); // really later
    await pushShop(client, dbA);

    await pullShop(client, dbB, shopId);
    expect(await dbB.shops.get(shopId)).toMatchObject({ name: "A Later Edit", syncStatus: "synced", updatedAt: await serverUpdatedAt() });
  });

  it("5. a pull never overwrites a pending local edit; the push sends it, and the server has it", async () => {
    await updateShopSettings(dbB, shopId, { name: "B Pending Edit" });
    await pg.query("update shops set name = 'Server Moved On' where id = $1", [shopId]); // server changed meanwhile
    await pullShop(client, dbB, shopId);
    expect(await dbB.shops.get(shopId)).toMatchObject({ name: "B Pending Edit", syncStatus: "pending" }); // untouched
    await pushShop(client, dbB);
    expect((await pg.query("select name from shops where id = $1", [shopId])).rows[0].name).toBe("B Pending Edit"); // the same field on both: the later ARRIVAL wins (D64)
    expect((await dbB.shops.get(shopId))?.syncStatus).toBe("synced");
  });

  it("7. KB-334 / NI-40: A edits the NAME offline while B changes the PHONE - both changes survive, on the server and on both devices", async () => {
    await pg.query("update shops set name = 'Base Name', phone = null, bill_language = 'en' where id = $1", [shopId]);
    await pullShop(client, dbA, shopId);
    await pullShop(client, dbB, shopId);
    await updateShopSettings(dbA, shopId, { name: "A Name (offline)" }); // pending, not pushed: A has no network
    await updateShopSettings(dbB, shopId, { phone: "9000000001" });
    await pushShop(client, dbB);
    // A comes online. A whole-row push (before KB-334) would put the old phone (null) back; now only the name goes.
    await pushShop(client, dbA);
    await pullShop(client, dbA, shopId);
    await pullShop(client, dbB, shopId);
    const server = await pg.query("select name, phone, bill_language from shops where id = $1", [shopId]);
    expect(server.rows[0]).toEqual({ name: "A Name (offline)", phone: "9000000001", bill_language: "en" });
    for (const db of [dbA, dbB]) {
      const local = (await db.shops.get(shopId))!;
      expect(local).toMatchObject({ name: "A Name (offline)", phone: "9000000001", billLanguage: "en", syncStatus: "synced", updatedAt: await serverUpdatedAt() });
      expect(local).not.toHaveProperty("pendingFields");
    }
  });

  it("8. KB-334 / NI-40: edit, reload before the sync, come online - only the changed field is pushed (the phone another device set is not undone)", async () => {
    await pg.query("update shops set name = 'Base Name', phone = null where id = $1", [shopId]);
    const name = `e2e-shop-reload-${crypto.randomUUID()}`;
    let phone = new KiranaBillDB(name);
    await pullShop(client, phone, shopId);
    await updateShopSettings(phone, shopId, { name: "Edited Before The Reload" });
    phone.close(); // the app is killed before it could sync
    await pg.query("update shops set phone = '9000000002' where id = $1", [shopId]); // meanwhile another device sets the phone
    phone = new KiranaBillDB(name); // the app is opened again
    expect(await phone.shops.get(shopId)).toMatchObject({ syncStatus: "pending", pendingFields: ["name"], phone: null }); // a stale phone, but not pending
    expect((await pushShop(client, phone)).anyTransientFailure).toBe(false);
    const server = await pg.query("select name, phone from shops where id = $1", [shopId]);
    expect(server.rows[0]).toEqual({ name: "Edited Before The Reload", phone: "9000000002" });
    expect(await phone.shops.get(shopId)).toMatchObject({ phone: "9000000002", syncStatus: "synced" }); // and this phone now has it
    phone.close();
    await phone.delete();
  });

  it("6. KI-37: a learning reset (an event with no bill) reaches the server with bill_id null, in this shop", async () => {
    const deviceId = crypto.randomUUID();
    await dbA.learnedAliases.add({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", alias: "chini", shopProductId: crypto.randomUUID(), hitCount: 3, confidence: 0.8, source: "correction", updatedAt: new Date().toISOString(), deviceId });
    const result = await resetLearning(dbA, shopId, Date.now(), deviceId);
    expect(result.clearedCounts.learnedAliases).toBe(1);
    expect((await pushLearningEvents(client, dbA)).anyTransientFailure).toBe(false);
    const rows = await pg.query("select shop_id, bill_id, event_type, payload from learning_events where shop_id = $1 and event_type = 'learning_reset'", [shopId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ shop_id: shopId, bill_id: null, event_type: "learning_reset" });
    expect(rows.rows[0].payload.clearedCounts.learnedAliases).toBe(1);
    expect((await dbA.learningEvents.filter((e) => e.eventType === "learning_reset").first())?.syncStatus).toBe("synced");
  });
});
