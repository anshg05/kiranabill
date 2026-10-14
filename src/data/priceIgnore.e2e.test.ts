import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { editRate } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { copyBaseCatalog, createShop } from "./shops";
import { reserveBlock } from "./receiptNumbers";
import { pullShop, pullShopProducts, syncNow } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { finaliseBill } from "./finalise";
import { learnPendingBills } from "./learnBill";
import { PRICE_IGNORE_EVENT, ignorePriceSuggestionFor, listPendingPriceSuggestions, resetLearning } from "./learningAudit";
import { pullLearningState } from "./pullLearning";

/**
 * KB-329 (D78) - the ignore of a price suggestion is saved and synced like the rest of the learning state: pushed
 * as a `price_suggestion_ignored` learning event, pulled by a new or second phone. Real local stack (D21, D32), shipped
 * code. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DAY = 86_400_000;

describe("KB-329 e2e - the ignore is pushed and pulled (local Postgres)", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  let shop: ParserCatalog;
  const deviceA = crypto.randomUUID();
  const dbA = new KiranaBillDB(`e2e-ignore-a-${crypto.randomUUID()}`);
  const dbs: KiranaBillDB[] = [dbA];
  const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
    if (!r.ok) throw new Error(r.error);
    return r.item;
  };

  async function newDevice() {
    const db = new KiranaBillDB(`e2e-ignore-${crypto.randomUUID()}`);
    dbs.push(db);
    const deviceId = crypto.randomUUID();
    await pullShop(client, db, shopId);
    await pullShopProducts(client, db, shopId);
    await reserveBlock(client, db, shopId, deviceId);
    return { db, deviceId };
  }
  const sync = (db: KiranaBillDB, deviceId: string) => syncNow({ client, localDb: db, shopId, deviceId });
  const line = (n: number, transcript: string, rate: string): FinalLine => {
    const [item] = parseUtterance(transcript, shop)!;
    return { id: `l${n}`, utteranceId: n, item: ok(editRate(item!, rate)), original: item!, displayName: shop.byId.get(item!.catalogId!)!.displayName, source: "fastpath" };
  };
  async function learnedBill(db: KiranaBillDB, deviceId: string, lines: FinalLine[]) {
    const at = new Date();
    await finaliseBill(db, { localId: crypto.randomUUID(), shopId, deviceId, startedAt: at.toISOString(), customer: { name: "Cash", mobile: null }, flags: [], lines, now: at });
    await learnPendingBills(db, shopId);
  }
  const suggestions = async (db: KiranaBillDB) => (await listPendingPriceSuggestions(db, shopId, Date.now())).length;
  const serverIgnores = async () => (await pg.query("select local_id, event_type, payload, bill_id from learning_events where shop_id = $1 and event_type = $2", [shopId, PRICE_IGNORE_EVENT])).rows;
  const besanId = () => [...shop.byId.values()].find((e) => e.displayName === "Besan")!.id;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb329.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-329 e2e", phone: null, catalogMode: "base_imported" })).id;
    await copyBaseCatalog(client, shopId, deviceA);
    await pullShop(client, dbA, shopId);
    await pullShopProducts(client, dbA, shopId);
    await reserveBlock(client, dbA, shopId, deviceA);
    shop = prepareParserCatalog((await loadShopCatalog(dbA, shopId)).entries);
    await sync(dbA, deviceA);
    for (let i = 0; i < 3; i++) await learnedBill(dbA, deviceA, [line(1, "1 kilo besan", "95")]); // a price suggestion for Besan
    await sync(dbA, deviceA);
  }, 90_000);

  afterAll(async () => {
    await pg?.end();
    dbs.forEach((d) => d.close());
  });

  it("1. Ignore on phone A is pushed (type, product, ignoredUntil, no bill) and a NEW phone pulls it: the suggestion stays hidden there", async () => {
    expect(await suggestions(dbA)).toBe(1);
    const c0 = await newDevice();
    await pullLearningState(client, c0.db, shopId);
    expect(await suggestions(c0.db)).toBe(1); // before the ignore, a new phone shows it too

    await ignorePriceSuggestionFor(dbA, shopId, besanId(), deviceA, Date.now());
    expect(await suggestions(dbA)).toBe(0);
    await sync(dbA, deviceA);
    const rows = await serverIgnores();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: PRICE_IGNORE_EVENT, bill_id: null, payload: { shopProductId: besanId() } });
    expect(Date.parse(rows[0].payload.ignoredUntil) - Date.now()).toBeGreaterThan(89 * DAY);

    const c = await newDevice(); // wiped / new
    expect((await pullLearningState(client, c.db, shopId)).done).toBe(true);
    expect(await suggestions(c.db)).toBe(0);
    await pullLearningState(client, c0.db, shopId); // and an existing phone gets it on its next pull
    expect(await suggestions(c0.db)).toBe(0);
  }, 90_000);

  it("2. the pull brings ONLY ignore events - never the bill_learned markers (a pulled marker would stop a bill being learned)", async () => {
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    const types = new Set((await c.db.learningEvents.toArray()).map((e) => e.eventType));
    expect([...types]).toEqual([PRICE_IGNORE_EVENT]);
    expect((await pg.query("select count(*)::int as n from learning_events where shop_id = $1 and event_type = 'bill_learned'", [shopId])).rows[0].n).toBeGreaterThan(0);
  });

  it("3. the pushing phone's own event is not duplicated by a pull (same local id, still synced), and a PENDING one is never overwritten", async () => {
    const before = (await dbA.learningEvents.filter((e) => e.eventType === PRICE_IGNORE_EVENT).toArray());
    await pullLearningState(client, dbA, shopId);
    const after = await dbA.learningEvents.filter((e) => e.eventType === PRICE_IGNORE_EVENT).toArray();
    expect(after.map((e) => e.localId)).toEqual(before.map((e) => e.localId));
    expect(after.every((e) => e.syncStatus === "synced")).toBe(true);

    const pending = { ...after[0]!, syncStatus: "pending" as const, payload: { ...after[0]!.payload, marker: "local-edit" } };
    await dbA.learningEvents.put(pending);
    await pullLearningState(client, dbA, shopId);
    expect((await dbA.learningEvents.get(pending.localId))?.payload).toMatchObject({ marker: "local-edit" });
    await dbA.learningEvents.put(after[0]!); // restore
  });

  it("4. two phones ignoring the same product: both stay hidden everywhere - neither loses or undoes the other", async () => {
    const b = await newDevice();
    await pullLearningState(client, b.db, shopId);
    await ignorePriceSuggestionFor(b.db, shopId, besanId(), b.deviceId, Date.now() + 1000);
    await sync(b.db, b.deviceId);
    expect(await serverIgnores()).toHaveLength(2);
    await pullLearningState(client, dbA, shopId);
    expect(await suggestions(dbA)).toBe(0);
    expect(await suggestions(b.db)).toBe(0);
    const fresh = await newDevice();
    await pullLearningState(client, fresh.db, shopId);
    expect(await suggestions(fresh.db)).toBe(0);
  }, 90_000);

  it("5. an ignore older than the 100-day pull window is not pulled", async () => {
    const old = new Date(Date.now() - 120 * DAY).toISOString();
    await pg.query(
      "insert into learning_events (shop_id, event_type, payload, created_at, local_id, device_id) values ($1, $2, $3, $4, gen_random_uuid(), 'old-phone')",
      [shopId, PRICE_IGNORE_EVENT, JSON.stringify({ shopProductId: besanId(), ignoredUntil: new Date(Date.now() + 5 * DAY).toISOString() }), old],
    );
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    const dates = (await c.db.learningEvents.toArray()).map((e) => e.createdAt);
    expect(dates.every((d) => Date.parse(d) > Date.now() - 100 * DAY)).toBe(true);
  });

  it("6. after a reset, a new phone gets none of the older ignores (the server keeps them) - and does get one made afterwards", async () => {
    await resetLearning(dbA, shopId, Date.now(), deviceA);
    await sync(dbA, deviceA);
    expect((await serverIgnores()).length).toBeGreaterThanOrEqual(3); // the server copies stay (NI-27)
    const c = await newDevice();
    await pullLearningState(client, c.db, shopId);
    expect((await c.db.learningEvents.toArray()).filter((e) => e.eventType === PRICE_IGNORE_EVENT)).toHaveLength(0);

    await ignorePriceSuggestionFor(dbA, shopId, besanId(), deviceA, Date.now());
    await sync(dbA, deviceA);
    await pullLearningState(client, c.db, shopId);
    expect((await c.db.learningEvents.toArray()).filter((e) => e.eventType === PRICE_IGNORE_EVENT)).toHaveLength(1);
  }, 90_000);
});
