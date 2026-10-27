import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { copyBaseCatalog, createShop } from "./shops";
import { pullShop, pullShopProducts, syncNow } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { finaliseBill } from "./finalise";
import { learnPendingBills } from "./learnBill";
import { cancelBillLocal } from "./cancelBill";
import { deriveShopAliases, removeLearnedAlias } from "./aliasEvidence";
import { pullLearningState } from "./pullLearning";

/**
 * KB-323 (D81) on the real local stack (D21, D32), shipped code: learned aliases are DERIVED from the alias events, so two
 * phones that learn one phrase before pulling each other lose nothing, a phone that joins late computes the same
 * confidence, a cancelled bill's lessons leave on every phone, "Not this" reaches every phone, and the pull is paged and
 * resumable. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PHRASE = "चिनी"; // a learned alias, not an exact alias of the base catalog (KB-326 test 1 relies on the same)

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
}

describe("KB-323 e2e - learned aliases across devices (local Postgres)", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  let parser: ParserCatalog;
  const dbs: KiranaBillDB[] = [];

  async function device(): Promise<{ db: KiranaBillDB; deviceId: string }> {
    const db = new KiranaBillDB(`e2e-alias-${crypto.randomUUID()}`);
    dbs.push(db);
    const deviceId = crypto.randomUUID();
    await pullShop(client, db, shopId);
    await pullShopProducts(client, db, shopId);
    await syncNow({ client, localDb: db, shopId, deviceId }); // opens the learning gate (an empty first pull)
    return { db, deviceId };
  }
  const sync = (d: { db: KiranaBillDB; deviceId: string }) => syncNow({ client, localDb: d.db, shopId, deviceId: d.deviceId });
  const phraseLine = (): FinalLine => {
    const [item] = parseUtterance(`2 kilo ${PHRASE}`, parser)!;
    return { id: "l1", utteranceId: 1, item: item!, original: item!, displayName: parser.byId.get(item!.catalogId!)!.displayName, source: "fastpath" };
  };
  async function learnedBill(d: { db: KiranaBillDB; deviceId: string }): Promise<string> {
    const localId = crypto.randomUUID();
    await finaliseBill(d.db, { localId, shopId, deviceId: d.deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, flags: [], lines: [phraseLine()] });
    await learnPendingBills(d.db, shopId);
    return localId;
  }
  const confidenceOn = async (db: KiranaBillDB) => (await deriveShopAliases(db, shopId)).find((a) => a.aliasKey === PHRASE.toLowerCase())?.confidence ?? null;
  const promotedOn = async (db: KiranaBillDB) => Object.keys((await loadShopCatalog(db, shopId)).learned);
  const aliasEventRows = async () => (await pg.query(`select * from learning_events where shop_id = $1 and event_type like 'alias\\_%' order by updated_at, id`, [shopId])).rows;

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb323.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-323 e2e", phone: null, catalogMode: "base_imported" })).id;
    const first = new KiranaBillDB(`e2e-alias-seed-${crypto.randomUUID()}`);
    dbs.push(first);
    await copyBaseCatalog(client, shopId, crypto.randomUUID());
    await pullShop(client, first, shopId);
    await pullShopProducts(client, first, shopId);
    parser = prepareParserCatalog((await loadShopCatalog(first, shopId)).entries);
  }, 60_000);

  afterAll(async () => {
    await pg?.end();
    dbs.forEach((d) => d.close());
  });

  it("1. two phones learn the same phrase before pulling each other: nothing is lost - both end at 0.9 and the parser reads it on both", async () => {
    const a = await device();
    const b = await device();
    await learnedBill(a);
    await learnedBill(a);
    await learnedBill(b); // B has not seen A's two
    expect(await confidenceOn(a.db)).toBe(0.7); // each phone alone: 0.7 and 0.5 - the old absolute rows would now fight
    expect(await confidenceOn(b.db)).toBe(0.5);
    await sync(a);
    await sync(b);
    await sync(a); // a second cycle each, so both have pulled everything
    expect(await confidenceOn(a.db)).toBe(0.9);
    expect(await confidenceOn(b.db)).toBe(0.9);
    expect(await promotedOn(a.db)).toEqual([PHRASE.toLowerCase()]);
    expect(await promotedOn(b.db)).toEqual([PHRASE.toLowerCase()]);
    expect(await deriveShopAliases(a.db, shopId)).toEqual(await deriveShopAliases(b.db, shopId));
  }, 120_000);

  it("2. a phone that joins late computes exactly the same confidence from the pulled events - and a pulled event knows its bill by the server's id", async () => {
    const late = await device();
    await sync(late);
    expect(await confidenceOn(late.db)).toBe(0.9);
    const pulled = (await late.db.learningEvents.toArray()).filter((e) => e.eventType === "alias_confirmed");
    expect(pulled.length).toBe(3);
    expect(pulled.every((e) => e.billLocalId === "" && !!e.billServerId)).toBe(true);
    expect(pulled.every((e) => e.payload.source_layer === "fastpath")).toBe(true);
  }, 120_000);

  it("3. a bill cancelled on one phone: its lesson leaves every phone once the cancellation arrives (NI-50)", async () => {
    const a = await device();
    const b = await device();
    await sync(a);
    await sync(b);
    expect(await confidenceOn(b.db)).toBe(0.9);
    const fourth = await learnedBill(a); // 4 confirmations -> 1.0 (capped)
    await sync(a);
    await sync(b);
    expect(await confidenceOn(b.db)).toBe(1);
    const res = await cancelBillLocal(a.db, { shopId, billLocalId: fourth, reason: "wrong_item", deviceId: a.deviceId, replacementLocalId: null });
    expect(res.ok).toBe(true);
    await sync(a);
    await sync(b);
    await sync(b);
    expect(await confidenceOn(a.db)).toBe(0.9);
    expect(await confidenceOn(b.db)).toBe(0.9); // B holds the event by server id only, and the cancellation by local id
  }, 180_000);

  it("4. Not this on one phone retires the alias on every phone - and it stays retired", async () => {
    const a = await device();
    const b = await device();
    await sync(a);
    await sync(b);
    const alias = (await deriveShopAliases(a.db, shopId)).find((x) => x.aliasKey === PHRASE.toLowerCase())!;
    await removeLearnedAlias(a.db, shopId, a.deviceId, alias.alias, alias.catalogId);
    await sync(a);
    await sync(b);
    await sync(b);
    expect(await promotedOn(a.db)).toEqual([]);
    expect(await promotedOn(b.db)).toEqual([]);
    const removed = (await aliasEventRows()).filter((r) => r.event_type === "alias_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.bill_id).toBeNull();
    await learnedBill(b); // one more confirmation is not enough to bring it back
    await sync(b);
    await sync(a);
    expect(await promotedOn(a.db)).toEqual([]);
  }, 180_000);

  it("5. the pull is paged and resumable: a pull that stops half way keeps its place, and the rest arrives - the same events as a one-go pull", async () => {
    const whole = await device();
    await sync(whole);
    const total = (await aliasEventRows()).length;
    expect(total).toBeGreaterThan(4);
    const half = new KiranaBillDB(`e2e-alias-half-${crypto.randomUUID()}`);
    dbs.push(half);
    await pullShop(client, half, shopId);
    await pullShopProducts(client, half, shopId);
    let learningRequests = 0;
    const failing = new Proxy(client, {
      get: (target, prop, receiver) =>
        prop === "from"
          ? (table: string) => {
              if (table === "learning_events") learningRequests += 1;
              if (table === "learning_events" && learningRequests === 5) throw new Error("connection lost"); // inside the alias spec, after pages were written
              return target.from(table);
            }
          : Reflect.get(target, prop, receiver),
    }) as SupabaseClient;
    const first = await pullLearningState(failing, half, shopId, { pageSize: 2 });
    expect(first.done).toBe(false);
    const part = await half.learningEvents.count();
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(total);
    expect((await half.syncState.get(`learning:learning_events_alias:${shopId}`))?.lastSyncedAt).toBeTruthy(); // the place is kept per page
    const second = await pullLearningState(client, half, shopId, { pageSize: 2 });
    expect(second.done).toBe(true);
    const ids = (rows: { localId: string }[]) => rows.map((r) => r.localId).sort();
    const aliasOnly = (rows: { localId: string; eventType: string }[]) => rows.filter((r) => r.eventType.startsWith("alias_"));
    expect(ids(aliasOnly(await half.learningEvents.toArray()))).toEqual(ids(aliasOnly(await whole.db.learningEvents.toArray())));
    await sync({ db: half, deviceId: crypto.randomUUID() }); // the bills and their cancellations (the learning pull does not bring those)
    expect(await deriveShopAliases(half, shopId)).toEqual(await deriveShopAliases(whole.db, shopId));
  }, 180_000);

  it("6. volume: what a year of a busy shop's alias events would weigh (printed, not asserted)", async () => {
    const r = (await pg.query(`select count(*)::int n, coalesce(avg(pg_column_size(le.*)),0)::int bytes from learning_events le where shop_id = $1 and event_type like 'alias\\_%'`, [shopId])).rows[0];
    const bills = (await pg.query(`select count(*)::int n from bills where shop_id = $1`, [shopId])).rows[0].n;
    console.info(`[KB-323 volume] ${r.n} alias events over ${bills} bills here; ~${r.bytes} bytes per row`);
    expect(r.n).toBeGreaterThan(0);
  }, 30_000);
});
