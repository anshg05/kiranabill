import "fake-indexeddb/auto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { editRate } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { copyBaseCatalog, createShop } from "./shops";
import { reserveBlock } from "./receiptNumbers";
import { pullBills, pullShop, pullShopProducts, pushLearningEvents, syncNow } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { finaliseBill } from "./finalise";
import { learnPendingBills } from "./learnBill";
import { listPendingPriceSuggestions, resetLearning } from "./learningAudit";
import { LEARNING_OBSERVATION_WINDOW_DAYS, isLearningPullDone, pullLearningState } from "./pullLearning";

/**
 * KB-326 (D66) - learning state is pulled, so a wiped or new phone keeps its Catalog suggestions (and, with KB-323,
 * its voice accuracy). Real local stack (D21, D32), shipped code: real learning (finaliseBill -> learnPendingBills ->
 * syncNow), a "wiped phone" = a fresh Dexie database. The cursor and the learning_reset cutoff are the SERVER's
 * updated_at (a trigger - migration 20261011090000), never a device clock. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DAY = 86_400_000;

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
}

describe("KB-326 e2e - pull learning state (local Postgres)", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  let userId: string;
  let shop: ParserCatalog;
  const deviceA = crypto.randomUUID();
  const dbA = new KiranaBillDB(`e2e-learn-a-${crypto.randomUUID()}`);
  const dbs: KiranaBillDB[] = [dbA];
  const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
    if (!r.ok) throw new Error(r.error);
    return r.item;
  };

  async function newDevice(): Promise<{ db: KiranaBillDB; deviceId: string }> {
    const db = new KiranaBillDB(`e2e-learn-${crypto.randomUUID()}`);
    dbs.push(db);
    const deviceId = crypto.randomUUID();
    await pullShop(client, db, shopId);
    await pullShopProducts(client, db, shopId);
    await reserveBlock(client, db, shopId, deviceId);
    return { db, deviceId };
  }

  function line(n: number, transcript: string, rate?: string): FinalLine {
    const [item] = parseUtterance(transcript, shop)!;
    const edited = rate ? ok(editRate(item!, rate)) : item!;
    return { id: `l${n}`, utteranceId: n, item: edited, original: item!, displayName: shop.byId.get(item!.catalogId!)!.displayName, source: "fastpath" };
  }

  /** A final bill on `db`, `daysAgo` days old, then learned from. */
  async function learnedBill(db: KiranaBillDB, deviceId: string, lines: FinalLine[], daysAgo = 0) {
    const at = new Date(Date.now() - daysAgo * DAY);
    await finaliseBill(db, { localId: crypto.randomUUID(), shopId, deviceId, startedAt: at.toISOString(), customer: { name: "Cash", mobile: null }, flags: [], lines, now: at });
    await learnPendingBills(db, shopId);
  }

  const sync = (db: KiranaBillDB, deviceId: string) => syncNow({ client, localDb: db, shopId, deviceId });
  const serverRows = async (table: string) => (await pg.query(`select * from ${table} where shop_id = $1 order by local_id`, [shopId])).rows;
  const strip = <T extends { serverId?: string; updatedAt?: string; syncStatus?: string; deviceId?: string }>(rows: T[]) =>
    rows.map(({ serverId: _s, updatedAt: _u, syncStatus: _y, deviceId: _d, ...rest }) => rest).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb326.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    userId = data.user.id;
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-326 e2e", phone: null, catalogMode: "base_imported" })).id;
    await copyBaseCatalog(client, shopId, deviceA);
    await pullShop(client, dbA, shopId);
    await pullShopProducts(client, dbA, shopId);
    await reserveBlock(client, dbA, shopId, deviceA);
    shop = prepareParserCatalog((await loadShopCatalog(dbA, shopId)).entries);
    await sync(dbA, deviceA); // the first learning pull (empty) opens the learning gate
  }, 60_000);

  afterAll(async () => {
    await pg?.end();
    dbs.forEach((d) => d.close());
  });

  it("1. a wiped phone gets everything back: aliases, provisional products, observations - and the SAME Catalog suggestions - without pushing anything", async () => {
    expect(await isLearningPullDone(dbA, shopId)).toBe(true);
    // chini by an alias (a learned alias), a brand-new item (a provisional product), besan at ₹95 three times (a price suggestion)
    await learnedBill(dbA, deviceA, [line(1, "2 kilo चिनी"), line(2, "1 kilo besan", "95")]);
    await learnedBill(dbA, deviceA, [line(1, "1 kilo besan", "95")]);
    await learnedBill(dbA, deviceA, [line(1, "1 kilo besan", "95")]);
    await sync(dbA, deviceA);
    expect((await serverRows("learned_aliases")).length).toBeGreaterThan(0);
    expect((await serverRows("price_observations")).length).toBe(3);
    const suggestionsA = await listPendingPriceSuggestions(dbA, shopId, Date.now());
    expect(suggestionsA.length).toBe(1);

    const c = await newDevice();
    const updatedBefore = JSON.stringify((await serverRows("learned_aliases")).map((r) => r.updated_at));
    const result = await pullLearningState(client, c.db, shopId);
    expect(result.done).toBe(true);
    expect(strip(await c.db.learnedAliases.toArray())).toEqual(strip(await dbA.learnedAliases.toArray()));
    expect(strip(await c.db.provisionalProducts.toArray())).toEqual(strip(await dbA.provisionalProducts.toArray()));
    expect(strip(await c.db.priceObservations.toArray())).toEqual(strip(await dbA.priceObservations.toArray()));
    expect((await c.db.learnedAliases.toArray()).every((r) => r.syncStatus === "synced" && r.serverId)).toBe(true);
    expect(await listPendingPriceSuggestions(c.db, shopId, Date.now())).toEqual(suggestionsA);

    await sync(c.db, c.deviceId); // pushes nothing: no pending learning rows, the server rows untouched
    expect(JSON.stringify((await serverRows("learned_aliases")).map((r) => r.updated_at))).toBe(updatedBefore);
    expect(await c.db.learnedAliases.where("syncStatus").equals("pending").count()).toBe(0);
  }, 90_000);

  it("2. never double-counted: the wiped phone's pulled bills teach nothing, and one new bill adds exactly 1 to the pulled count", async () => {
    const c = await newDevice();
    await sync(c.db, c.deviceId); // first cycle: bills + learning state pulled, gate opened
    await pullBills(client, c.db, shopId, { awaitBackfill: true });
    const before = (await c.db.learnedAliases.toArray()).find((a) => a.alias === "चिनी")!;
    const serverBefore = (await serverRows("learned_aliases")).find((r) => r.alias === "चिनी")!;
    expect(before.hitCount).toBe(serverBefore.hit_count);
    expect(await learnPendingBills(c.db, shopId)).toBe(0); // every pulled bill carries pulledAt
    expect((await c.db.learnedAliases.toArray()).find((a) => a.alias === "चिनी")!.hitCount).toBe(before.hitCount);

    await learnedBill(c.db, c.deviceId, [line(1, "2 kilo चिनी")]);
    await sync(c.db, c.deviceId);
    expect((await serverRows("learned_aliases")).find((r) => r.alias === "चिनी")!.hit_count).toBe(before.hitCount + 1); // not 1 - never overwritten
  }, 90_000);

  it("3. the learning gate: a brand-new phone learns nothing until its first learning pull; then the waiting bill is learned once, from the pulled count", async () => {
    const e = await newDevice();
    const at = new Date();
    await finaliseBill(e.db, { localId: crypto.randomUUID(), shopId, deviceId: e.deviceId, startedAt: at.toISOString(), customer: { name: "Cash", mobile: null }, flags: [], lines: [line(1, "2 kilo चिनी")], now: at });
    expect(await isLearningPullDone(e.db, shopId)).toBe(false);
    expect(await learnPendingBills(e.db, shopId)).toBe(0); // gated
    expect(await e.db.learnedAliases.count()).toBe(0);
    const serverHits = (await serverRows("learned_aliases")).find((r) => r.alias === "चिनी")!.hit_count as number;

    await sync(e.db, e.deviceId); // pull -> gate opens -> the waiting bill is learned (pending)
    expect(await isLearningPullDone(e.db, shopId)).toBe(true);
    expect((await e.db.learnedAliases.toArray()).find((a) => a.alias === "चिनी")!.hitCount).toBe(serverHits + 1);
    await sync(e.db, e.deviceId); // pushed
    expect((await serverRows("learned_aliases")).find((r) => r.alias === "चिनी")!.hit_count).toBe(serverHits + 1);
  }, 90_000);

  it("4. an alias UPDATED after a phone's first pull reaches it on the next pull (the server stamps updates), and an observation made offline days ago and pushed late still arrives", async () => {
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    const hits = (await c.db.learnedAliases.toArray()).find((a) => a.alias === "चिनी")!.hitCount;

    await sync(dbA, deviceA); // A is the shop's one working phone: it is up to date before it learns (two phones editing at once is out of MVP scope)
    await learnedBill(dbA, deviceA, [line(1, "2 kilo चिनी"), line(2, "1 kilo besan", "88")], 3); // a bill from 3 days ago, learned and pushed NOW
    await sync(dbA, deviceA);
    await pullLearningState(client, c.db, shopId);
    expect((await c.db.learnedAliases.toArray()).find((a) => a.alias === "चिनी")!.hitCount).toBe(hits + 1);
    expect((await c.db.priceObservations.toArray()).some((o) => o.observedPricePaise === 8800)).toBe(true); // old occurred_at, new server stamp
  }, 90_000);

  it("5. observations older than 35 days are not pulled (owner, D66) - the suggestion rule only reads 30", async () => {
    expect(LEARNING_OBSERVATION_WINDOW_DAYS).toBe(35);
    await learnedBill(dbA, deviceA, [line(1, "1 kilo besan", "77")], 40);
    await sync(dbA, deviceA);
    expect((await serverRows("price_observations")).some((o) => Number(o.observed_price_paise) === 7700)).toBe(true);
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    expect((await c.db.priceObservations.toArray()).some((o) => o.observedPricePaise === 7700)).toBe(false);
  }, 90_000);

  it("6. a pending local row is never overwritten by a pull", async () => {
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    const alias = (await c.db.learnedAliases.toArray())[0]!;
    await c.db.learnedAliases.put({ ...alias, hitCount: 99, syncStatus: "pending" });
    // the server row changes meanwhile
    await pg.query("update learned_aliases set hit_count = hit_count + 1 where shop_id = $1 and local_id = $2", [shopId, alias.localId]);
    await pullLearningState(client, c.db, shopId);
    expect(await c.db.learnedAliases.get(alias.localId)).toMatchObject({ hitCount: 99, syncStatus: "pending" });
  }, 60_000);

  it("7. another shop's learning never arrives (RLS, and every query is per shop)", async () => {
    const other = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await other.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb326.local`, password: crypto.randomUUID() });
    const shopB = (await createShop(other, { ownerUserId: data.user!.id, name: "KB-326 other", phone: null, catalogMode: "custom_only" })).id;
    const product = (await pg.query(
      `insert into shop_products (shop_id, display_name, unit, price_paise, source, local_id, device_id) values ($1, 'Doosra Item', 'kg', 100, 'custom', gen_random_uuid(), 'x') returning id`, [shopB])).rows[0].id;
    await pg.query(`insert into learned_aliases (shop_id, alias, shop_product_id, hit_count, confidence, source, local_id, device_id) values ($1, 'doosri dukaan', $2, 5, 0.9, 'correction', gen_random_uuid(), 'x')`, [shopB, product]);
    await pg.query(`insert into price_observations (shop_id, shop_product_id, observed_price_paise, local_id, device_id) values ($1, $2, 100, gen_random_uuid(), 'x')`, [shopB, product]);
    await pg.query(`insert into provisional_products (shop_id, spoken_name, seen_count, local_id, device_id) values ($1, 'doosra naya', 2, gen_random_uuid(), 'x')`, [shopB]);
    // The SAME user is a member of both shops, so RLS no longer separates them: only the per-shop filter does.
    await pg.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [shopB, userId]);
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    const all = [...(await c.db.learnedAliases.toArray()), ...(await c.db.provisionalProducts.toArray()), ...(await c.db.priceObservations.toArray())];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => r.shopId === shopId)).toBe(true);
  }, 60_000);

  it("8. the server stamps cannot be forged: a client-sent updated_at is ignored on all four learning tables, on insert and (aliases, provisional) on update", async () => {
    const product = (await dbA.shopProducts.where("shopId").equals(shopId).first())!.id;
    const old = "2020-01-01T00:00:00Z";
    const probes: Array<[string, Record<string, unknown>]> = [
      ["price_observations", { shop_product_id: product, observed_price_paise: 123 }],
      ["learning_events", { event_type: "probe", payload: {} }],
      ["learned_aliases", { alias: `probe-${crypto.randomUUID()}`, shop_product_id: product, hit_count: 1, confidence: 0.5, source: "confirmation" }],
      ["provisional_products", { spoken_name: `probe-${crypto.randomUUID()}`, seen_count: 1 }],
    ];
    for (const [table, fields] of probes) {
      const { data, error } = await client.from(table).insert({ shop_id: shopId, local_id: crypto.randomUUID(), device_id: "probe", updated_at: old, ...fields }).select("id, updated_at").single();
      expect(error, table).toBeNull();
      expect(new Date(data!.updated_at as string).getFullYear(), table).toBeGreaterThan(2020);
      if (table === "learned_aliases" || table === "provisional_products") {
        const up = await client.from(table).update({ updated_at: old, ...(table === "learned_aliases" ? { hit_count: 2 } : { seen_count: 2 }) }).eq("id", data!.id).select("updated_at").single();
        expect(new Date(up.data!.updated_at as string).getFullYear(), `${table} update`).toBeGreaterThan(2020);
      }
    }
  }, 60_000);

  it("12. a steady-state sync cycle does not learn (the app learns after each save; a cycle must not rescan every bill every 15 s)", async () => {
    const c = await newDevice();
    await sync(c.db, c.deviceId); // opens the gate
    const at = new Date();
    await finaliseBill(c.db, { localId: crypto.randomUUID(), shopId, deviceId: c.deviceId, startedAt: at.toISOString(), customer: { name: "Cash", mobile: null }, flags: [], lines: [line(1, "1 kilo besan", "66")], now: at });
    await sync(c.db, c.deviceId);
    expect(await c.db.priceObservations.filter((o) => o.observedPricePaise === 6600).count()).toBe(0); // not learned by the cycle
    expect(await learnPendingBills(c.db, shopId)).toBe(1); // learned by the app's own call
  }, 60_000);

  describe("learning_reset is honoured (owner, KB-312 Q3) - with a SERVER-time cutoff", () => {
    async function wipedPull() {
      const d = await newDevice();
      await pullLearningState(client, d.db, shopId);
      return d;
    }
    const counts = async (db: KiranaBillDB) => ({
      aliases: await db.learnedAliases.count(),
      provisional: await db.provisionalProducts.count(),
      observations: await db.priceObservations.count(),
    });

    it("9. after a reset, a new phone gets none of the older rows (the server still has them) - and does get what was learned afterwards", async () => {
      const serverBefore = (await serverRows("learned_aliases")).length;
      expect(serverBefore).toBeGreaterThan(0);
      await resetLearning(dbA, shopId, Date.now(), deviceA);
      await sync(dbA, deviceA); // pushes the learning_reset event
      expect((await pg.query("select 1 from learning_events where shop_id = $1 and event_type = 'learning_reset'", [shopId])).rowCount).toBe(1);
      expect((await serverRows("learned_aliases")).length).toBe(serverBefore); // the server copy is NOT deleted (NI-27)

      const d = await wipedPull();
      expect(await counts(d.db)).toEqual({ aliases: 0, provisional: 0, observations: 0 });

      await learnedBill(dbA, deviceA, [line(1, "2 kilo चिनी"), line(2, "1 kilo besan", "91")]); // after the reset
      await sync(dbA, deviceA);
      await pullLearningState(client, d.db, shopId);
      expect((await d.db.learnedAliases.toArray()).map((a) => [a.alias, a.hitCount])).toEqual([["चिनी", 1]]); // fresh count, same row - not 6
      expect((await d.db.priceObservations.toArray()).map((o) => o.observedPricePaise)).toEqual([9100]);
    }, 90_000);

    it("10. a reset that has not reached the server yet blocks the pull - nothing comes back (and it comes right once the event is pushed)", async () => {
      const c = await newDevice();
      await resetLearning(c.db, shopId, Date.now(), c.deviceId); // offline reset: the event is pending
      const result = await pullLearningState(client, c.db, shopId);
      expect(result).toMatchObject({ done: false, skipped: "reset-not-pushed" });
      expect(await counts(c.db)).toEqual({ aliases: 0, provisional: 0, observations: 0 });
      await pushLearningEvents(client, c.db);
      const after = await pullLearningState(client, c.db, shopId);
      expect(after.done).toBe(true);
      // C's reset is the latest on the server, so everything stamped before it stays out - A's earlier learning too
      expect(await counts(c.db)).toEqual({ aliases: 0, provisional: 0, observations: 0 });
      await sync(dbA, deviceA);
      await learnedBill(dbA, deviceA, [line(1, "2 kilo चिनी")]); // learned after C's reset
      await sync(dbA, deviceA);
      await pullLearningState(client, c.db, shopId);
      expect((await c.db.learnedAliases.toArray()).map((a) => a.alias)).toEqual(["चिनी"]);
    }, 90_000);

    it("11. the cutoff is the SERVER's time: a resetting phone whose clock is 5 minutes AHEAD or BEHIND changes nothing", async () => {
      for (const skew of [+5 * 60_000, -5 * 60_000]) {
        await learnedBill(dbA, deviceA, [line(1, "1 kilo besan", String(60 + (skew > 0 ? 1 : 2)))]); // pre-reset learning, stamped just now
        await sync(dbA, deviceA);
        await resetLearning(dbA, shopId, Date.now() + skew, deviceA); // the event's own created_at is 5 min off
        await sync(dbA, deviceA);
        await learnedBill(dbA, deviceA, [line(1, "1 kilo besan", String(70 + (skew > 0 ? 1 : 2)))]); // learned right after the reset, on the real clock
        await sync(dbA, deviceA);
        const d = await wipedPull();
        // exactly the post-reset observation: not the pre-reset one (a +skew cutoff would also drop the post-reset one; a -skew cutoff would keep the pre-reset one)
        expect((await d.db.priceObservations.toArray()).map((o) => o.observedPricePaise)).toEqual([(70 + (skew > 0 ? 1 : 2)) * 100]);
      }
    }, 120_000);
  });
});
