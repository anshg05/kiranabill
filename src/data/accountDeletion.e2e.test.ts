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
import { syncNow } from "./sync";
import { finaliseBill } from "./finalise";
import { cancelBillLocal } from "./cancelBill";
import { requestBillNumber } from "./receiptNumbers";

/**
 * KB-430 (D119) on the REAL local stack: a shop with FINAL and CANCELLED bills (pushed by the shipped sync), a cancellation, metrics,
 * learning rows, a bill-number grant + counter, a number block, and a voice recording (row AND file) - "Delete my account" removes
 * every one of them and the login, nothing (no trigger, no policy) blocks it, the other user's shop is untouched, the recording file
 * is due for the daily clean-up AT ONCE, and the admin deletion (an e-mail request) does the same. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TABLES = [
  "bills", "bill_items", "bill_cancellations", "bill_metrics", "learning_events", "price_observations", "learned_aliases",
  "provisional_products", "voice_recordings", "bill_number_grants", "shop_bill_counters", "receipt_number_blocks", "shop_products", "shop_members",
] as const;

interface Owner {
  client: SupabaseClient;
  userId: string;
  email: string;
  password: string;
  shopId: string;
  recordingPath: string;
}

describe("KB-430 e2e - delete my account (local Postgres + Storage)", () => {
  let pg: Client;
  const dbs: KiranaBillDB[] = [];

  async function owner(tag: string): Promise<Owner> {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const email = `e2e-${crypto.randomUUID()}@kb430-${tag}.local`;
    const password = crypto.randomUUID();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error || !data.user) throw new Error(`local signUp failed: ${error?.message}`);
    const userId = data.user.id;
    const shopId = (await createShop(client, { ownerUserId: userId, name: `KB-430 ${tag}`, phone: null, catalogMode: "custom_only" })).id;

    // two bills through the shipped path - one stays final, one is cancelled - then a server number (grant + counter)
    const db = new KiranaBillDB(`e2e-kb430-${crypto.randomUUID()}`);
    dbs.push(db);
    const deviceId = crypto.randomUUID();
    const bill = async () => {
      const localId = crypto.randomUUID();
      const t = "2 kilo chini 5 wala";
      const items = parseUtterance(t, SEED_PARSER_CATALOG)!;
      const lines: FinalLine[] = items.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item: { ...item, catalogId: null }, original: { ...item, catalogId: null }, displayName: "Chini", source: "fastpath" }));
      const utterances: UtteranceRecord[] = [{ id: 1, lineIds: lines.map((l) => l.id), flags: [...evaluateReviewFlags(t, items, SEED_PARSER_CATALOG.entries)], transcript: t }];
      const flags = billFlags(lines, utterances, SEED_PARSER_CATALOG.entries).map((f) => ({ ...f, acknowledged: true }));
      await finaliseBill(db, { localId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines, flags });
      return localId;
    };
    await bill();
    const cancelled = await bill();
    await cancelBillLocal(db, { shopId, billLocalId: cancelled, reason: "wrong_price", deviceId, replacementLocalId: null });
    await syncNow({ client, localDb: db, shopId, deviceId });
    expect(await requestBillNumber(client, shopId, crypto.randomUUID())).not.toBeNull();

    // the rows the app writes elsewhere (learning, metrics, an old number block) - minimal, as the database's owner
    const billId = (await pg.query<{ id: string }>("select id from bills where shop_id = $1 and status = 'final' limit 1", [shopId])).rows[0]!.id;
    const product = (await pg.query<{ id: string }>("insert into shop_products (shop_id, display_name, unit, price_paise, source, local_id, device_id) values ($1, 'Chini', 'kg', 4500, 'custom', gen_random_uuid(), 'e2e') returning id", [shopId])).rows[0]!.id;
    await pg.query("insert into learned_aliases (shop_id, alias, shop_product_id, confidence, source, local_id, device_id) values ($1, 'cheeni', $2, 0.9, 'correction', gen_random_uuid(), 'e2e')", [shopId, product]);
    await pg.query("insert into provisional_products (shop_id, spoken_name, local_id, device_id) values ($1, 'gud', gen_random_uuid(), 'e2e')", [shopId]);
    await pg.query("insert into price_observations (shop_id, shop_product_id, observed_price_paise, local_id, device_id) values ($1, $2, 4600, gen_random_uuid(), 'e2e')", [shopId, product]);
    await pg.query("insert into learning_events (shop_id, event_type, local_id, device_id) values ($1, 'bill_learned', gen_random_uuid(), 'e2e')", [shopId]);
    await pg.query("insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'e2e', 900, 949, 900)", [shopId]);
    await pg.query(
      `insert into bill_metrics (shop_id, bill_id, bill_local_id, device_id, local_id, receipt_number, total_paise, line_count, turns, seconds_to_bill, voice_lines, edited_lines, manual_lines, removed_lines, not_added, flags_raised, flags_acknowledged, recorded_at)
       select shop_id, id, local_id, 'e2e', gen_random_uuid(), receipt_number, total_paise, 1, 1, 5, 1, 0, 0, 0, 0, 0, 0, now() from bills where id = $1`,
      [billId],
    );

    // a voice recording, as the phone adds it: the file in Storage and its row
    const recordingId = crypto.randomUUID();
    const recordingPath = `${shopId}/${recordingId}`;
    const up = await client.storage.from("recordings").upload(recordingPath, new Blob([new Uint8Array([26, 69, 223, 163])], { type: "audio/webm" }), { contentType: "audio/webm" });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const row = await client.from("voice_recordings").insert({ recording_id: recordingId, shop_id: shopId, mime: "audio/webm" });
    if (row.error) throw new Error(`recording row: ${row.error.message}`);
    return { client, userId, email, password, shopId, recordingPath };
  }

  const counts = async (shopId: string) => {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t] = Number((await pg.query(`select count(*) from ${t} where shop_id = $1`, [shopId])).rows[0].count);
    out.shops = Number((await pg.query("select count(*) from shops where id = $1", [shopId])).rows[0].count);
    out.files = Number((await pg.query("select count(*) from storage.objects where bucket_id = 'recordings' and name like $1", [`${shopId}/%`])).rows[0].count);
    return out;
  };
  const loginExists = async (userId: string) => (await pg.query("select 1 from auth.users where id = $1", [userId])).rowCount === 1;
  const due = async () => (await pg.query<{ path: string }>("select path from voice_cleanup_due()")).rows.map((r) => r.path);

  let a: Owner; // deletes his account in the app
  let b: Owner; // never touched
  let c: Owner; // deleted by the admin function (an e-mail request)

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    a = await owner("a");
    b = await owner("b");
    c = await owner("c");
  }, 120_000);
  afterAll(async () => {
    for (const db of dbs) {
      db.close();
      await db.delete();
    }
    await pg?.end();
  });

  it("before: every table holds the shop's rows - final AND cancelled bills, lines, a cancellation, metrics, learning, numbers, a recording row and file", async () => {
    const before = await counts(a.shopId);
    for (const [t, n] of Object.entries(before)) expect(n, t).toBeGreaterThan(0);
    expect((await pg.query("select status from bills where shop_id = $1 order by status", [a.shopId])).rows.map((r) => r.status)).toEqual(["cancelled", "final"]);
  });

  it("the app's call deletes EVERYTHING of A's shop and A's login - nothing blocks it - and B is untouched", async () => {
    const bBefore = await counts(b.shopId);
    const { data, error } = await a.client.rpc("delete_my_account");
    expect(error).toBeNull();
    expect(data).toMatchObject({ bills: 2, bill_items: 2, bill_cancellations: 1, voice_recordings: 1, shops: 1, auth_users: 1 });
    const after = await counts(a.shopId);
    expect(Object.entries(after).filter(([t, n]) => t !== "files" && n !== 0)).toEqual([]);
    expect(await loginExists(a.userId)).toBe(false);
    expect(await counts(b.shopId)).toEqual(bBefore);
    expect(await loginExists(b.userId)).toBe(true);
  });

  it("A can no longer sign in", async () => {
    const fresh = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await fresh.auth.signInWithPassword({ email: a.email, password: a.password });
    expect(error).not.toBeNull();
  });

  it("A's recording FILE is due for the daily clean-up at once (its shop is gone); B's fresh file is not", async () => {
    const list = await due();
    expect(list).toContain(a.recordingPath);
    expect(list).not.toContain(b.recordingPath);
  });

  it("an e-mail request: the owner runs delete_account_by_admin in the dashboard - C's shop and login go, B is untouched", async () => {
    const bBefore = await counts(b.shopId);
    const r = await pg.query("select delete_account_by_admin($1) as c", [c.userId]);
    expect(r.rows[0].c).toMatchObject({ bills: 2, shops: 1, auth_users: 1 });
    expect(Object.entries(await counts(c.shopId)).filter(([t, n]) => t !== "files" && n !== 0)).toEqual([]);
    expect(await loginExists(c.userId)).toBe(false);
    expect(await counts(b.shopId)).toEqual(bBefore);
  });
});
