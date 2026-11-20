import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createShop } from "./shops";
import { submitRecording } from "./voiceJob";

/**
 * SG-20 (D121, owner 20 Nov 2026) on the REAL local stack:
 *   - 250 voice calls a shop a day (India time), counted INSIDE claim_voice_recording (one atomic step, both Netlify sites): a refused
 *     claim makes NO Gemini call, marks the recording failed "day_limit" (attempts + 1, so the phone sees it) and is safe to retry later;
 *   - finish_voice_recording adds done / failed, the real tokens and the cost (the gemini_price row, frozen at the time of the call);
 *   - sign-ups: allowlist / open (the app_limits row), the shop's created_at from the server clock, existing shops untouched;
 *   - the owner's reports (schema `reports`) - readable by nobody but the dashboard; the TEST shop marked and left out of the totals;
 *   - "Delete my account" removes the shop's voice_usage rows.
 * The real worker runs; only Gemini's HTTP call (and the Netlify Blobs hourly check) is faked. Refuses anything but localhost.
 */

vi.mock("../../netlify/functions/_shared/rateLimit.js", () => ({ checkRateLimit: vi.fn(async () => true) }));
import handler from "../../netlify/functions/voice-run-worker.mts";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TEST_SHOP = "ac8dda60-6c96-446f-a520-35888e1742c2";
const TEST_USER = "77636ea8-8058-44ef-9762-76dfc47e5502";
/** 900 tokens in, 60 out at $0.75 / $3.75 a million, Rs 95.17 a $, 18% GST = 900 micro-$ -> Rs 0.10107054 = 101,071 micro-rupees */
const COST_OF_ONE_CALL = 101_071;

describe("SG-20 e2e - voice limits, usage, sign-ups and the owner's reports (local stack, Gemini faked)", () => {
  let client: SupabaseClient;
  let shopId: string;
  let userId: string;
  let token: string;
  let pg: Client;
  const realFetch = globalThis.fetch;
  let geminiCalls = 0;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Refusing to run: not the local stack");
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    process.env.GEMINI_API_KEY = "fake-gemini-key-for-e2e";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input instanceof Request ? input.url : input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      geminiCalls++;
      const text = JSON.stringify({ transcript: "दो किलो चीनी", items: [] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60, totalTokenCount: 960 } }), { status: 200 });
    });
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@sg20.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    token = data.session.access_token;
    userId = data.user.id;
    shopId = (await createShop(client, { ownerUserId: userId, name: "SG-20 e2e", phone: null, catalogMode: "custom_only" })).id;
  }, 60_000);
  afterEach(() => {
    geminiCalls = 0;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await pg?.end();
  });

  const backgroundRun: typeof fetch = async (_endpoint, init) => {
    void handler(new Request("http://localhost/voice-run", init), {} as never);
    return new Response(null, { status: 202 });
  };
  const audio = new Blob([new Uint8Array([26, 69, 223, 163, 9, 9])], { type: "audio/webm;codecs=opus" });
  const submit = (recordingId: string) => submitRecording({ client, shopId, recordingId, audio, accessToken: token, fetchImpl: backgroundRun, sleep: (ms) => new Promise((r) => setTimeout(r, ms / 10)) });
  const today = async () => (await pg.query(`select (now() at time zone 'Asia/Kolkata')::date::text as d`)).rows[0].d as string;
  const usage = async (day?: string) =>
    (await pg.query(`select calls, done, failed, refused, input_tokens, output_tokens, cost_micro_inr from voice_usage where shop_id = $1 and day = $2::date`, [shopId, day ?? (await today())])).rows[0] as
      | { calls: number; done: number; failed: number; refused: number; input_tokens: string; output_tokens: string; cost_micro_inr: string }
      | undefined;
  const setCalls = (n: number) => pg.query(`insert into voice_usage (day, shop_id, calls) values ((now() at time zone 'Asia/Kolkata')::date, $1, $2) on conflict (day, shop_id) do update set calls = excluded.calls`, [shopId, n]);

  it("the limits row: 250 calls a shop a day, sign-ups by allowlist; the price row: gemini-3.8-flash at $0.75 / $3.75, Rs 95.17, 18% GST", async () => {
    const limits = (await pg.query(`select shop_calls_per_day, signup_mode from app_limits`)).rows;
    expect(limits).toEqual([{ shop_calls_per_day: 250, signup_mode: expect.stringMatching(/^(allowlist|open)$/) }]);
    // the migration's value (the e2e setup opens sign-ups on the LOCAL stack only - every other e2e file signs up .local users)
    expect((await pg.query(`select column_default from information_schema.columns where table_name = 'app_limits' and column_name = 'signup_mode'`)).rows[0].column_default).toContain("allowlist");
    expect((await pg.query(`select model, input_micro_usd_per_million, output_micro_usd_per_million, inr_paise_per_usd, gst_percent from gemini_price`)).rows).toEqual([
      { model: "gemini-3.8-flash", input_micro_usd_per_million: 750_000, output_micro_usd_per_million: 3_750_000, inr_paise_per_usd: 9517, gst_percent: 18 },
    ]);
  });

  it("1. under the limit: the call runs, counted on TODAY's India-time row, with its real tokens and cost", async () => {
    const out = await submit(crypto.randomUUID());
    expect(out.kind).toBe("done");
    expect(geminiCalls).toBe(1);
    expect(await usage()).toEqual({ calls: 1, done: 1, failed: 0, refused: 0, input_tokens: "900", output_tokens: "60", cost_micro_inr: String(COST_OF_ONE_CALL) });
  }, 60_000);

  it("2. at 250: refused with NO Gemini call - the phone sees day_limit (Retry / Add by hand), the recording stays, the count stays 250", async () => {
    await setCalls(250);
    const rec = crypto.randomUUID();
    const out = await submit(rec);
    expect(out).toMatchObject({ kind: "failed", recordingId: rec, reason: "day_limit" });
    expect(geminiCalls).toBe(0);
    const row = (await pg.query(`select status, attempts, error from voice_recordings where recording_id = $1`, [rec])).rows[0];
    expect(row).toEqual({ status: "failed", attempts: 1, error: "day_limit" });
    expect(await usage()).toMatchObject({ calls: 250, refused: 1 });
    expect((await client.storage.from("recordings").download(`${shopId}/${rec}`)).error).toBeNull(); // the recording is safe

    // 3. Retry while still at the limit: refused again, still no call
    expect(await submit(rec)).toMatchObject({ kind: "failed", reason: "day_limit" });
    expect(geminiCalls).toBe(0);
    expect(await usage()).toMatchObject({ calls: 250, refused: 2 });

    // 4. the owner raises the limit in the dashboard -> the same recording's Retry runs (one call)
    await pg.query(`update app_limits set shop_calls_per_day = 251`);
    try {
      expect(await submit(rec)).toMatchObject({ kind: "done" });
      expect(geminiCalls).toBe(1);
      expect(await usage()).toMatchObject({ calls: 251, refused: 2, done: 2 });
    } finally {
      await pg.query(`update app_limits set shop_calls_per_day = 250`);
    }
  }, 60_000);

  it("5. a new day starts at 0: yesterday's 250 does not block today", async () => {
    await pg.query(`delete from voice_usage where shop_id = $1`, [shopId]);
    await pg.query(`insert into voice_usage (day, shop_id, calls) values ((now() at time zone 'Asia/Kolkata')::date - 1, $1, 250)`, [shopId]);
    expect((await submit(crypto.randomUUID())).kind).toBe("done");
    expect((await usage())?.calls).toBe(1);
  }, 60_000);

  it("6. a limit of 0 stops voice for every shop; a double claim of one recording counts ONE call", async () => {
    await pg.query(`delete from voice_usage where shop_id = $1`, [shopId]);
    const rec = crypto.randomUUID();
    await client.storage.from("recordings").upload(`${shopId}/${rec}`, audio, { contentType: "audio/webm" });
    await client.from("voice_recordings").insert({ recording_id: rec, shop_id: shopId, mime: "audio/webm" });
    const [a, b] = await Promise.all([client.rpc("claim_voice_recording", { p_recording_id: rec }), client.rpc("claim_voice_recording", { p_recording_id: rec })]);
    expect([a.data, b.data].map((d) => (d as unknown[]).length).sort()).toEqual([0, 1]);
    expect(await usage()).toMatchObject({ calls: 1, refused: 0 });

    await pg.query(`update app_limits set shop_calls_per_day = 0`);
    try {
      const rec2 = crypto.randomUUID();
      await client.from("voice_recordings").insert({ recording_id: rec2, shop_id: shopId, mime: "audio/webm" });
      expect((await client.rpc("claim_voice_recording", { p_recording_id: rec2 })).data).toEqual([]);
      expect((await pg.query(`select status, error from voice_recordings where recording_id = $1`, [rec2])).rows[0]).toEqual({ status: "failed", error: "day_limit" });
    } finally {
      await pg.query(`update app_limits set shop_calls_per_day = 250`);
    }
  }, 60_000);

  it("7. a failed finish counts as failed with no cost; a phone cannot write voice_usage, the limits or the price", async () => {
    await pg.query(`delete from voice_usage where shop_id = $1`, [shopId]);
    const rec = crypto.randomUUID();
    await client.from("voice_recordings").insert({ recording_id: rec, shop_id: shopId, mime: "audio/webm" });
    await client.rpc("claim_voice_recording", { p_recording_id: rec });
    const f = await client.rpc("finish_voice_recording", { p_recording_id: rec, p_attempt: 1, p_status: "failed", p_transcript: null, p_items: null, p_usage: null, p_model: "m", p_error: "timeout" });
    expect(f.data).toBe(true);
    expect(await usage()).toMatchObject({ calls: 1, done: 0, failed: 1, cost_micro_inr: "0" });
    // junk usage never breaks the finish (a text where a number belongs = 0 tokens)
    const rec2 = crypto.randomUUID();
    await client.from("voice_recordings").insert({ recording_id: rec2, shop_id: shopId, mime: "audio/webm" });
    await client.rpc("claim_voice_recording", { p_recording_id: rec2 });
    const g = await client.rpc("finish_voice_recording", { p_recording_id: rec2, p_attempt: 1, p_status: "done", p_transcript: "x", p_items: [], p_usage: { promptTokens: "lots", completionTokens: -5 }, p_model: "m", p_error: null });
    expect(g.data).toBe(true);
    expect(await usage()).toMatchObject({ calls: 2, done: 1, failed: 1, input_tokens: "0", output_tokens: "0", cost_micro_inr: "0" });

    for (const [table, write] of [
      ["voice_usage", () => client.from("voice_usage").update({ calls: 0 }).eq("shop_id", shopId).select()],
      ["app_limits", () => client.from("app_limits").update({ shop_calls_per_day: 99999 }).eq("id", 1).select()],
      ["gemini_price", () => client.from("gemini_price").update({ gst_percent: 0 }).eq("id", 1).select()],
      ["signup_allowlist", () => client.from("signup_allowlist").insert({ email: "me@example.com" }).select()],
    ] as const) {
      const r = await write();
      expect(r.error ?? (r.data as unknown[]).length === 0, table).toBeTruthy();
    }
    expect(await usage()).toMatchObject({ calls: 2 });
    expect((await pg.query(`select shop_calls_per_day from app_limits`)).rows[0].shop_calls_per_day).toBe(250);
  }, 60_000);

  it("8. the reports are closed to the public key and to a signed-in user (PostgREST); the reports schema is not served", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const c of [anon, client]) {
      for (const view of ["daily", "shops"]) {
        const r = await c.schema("reports").from(view).select("*");
        expect(r.error, view).not.toBeNull();
        expect(r.data).toBeNull();
      }
      for (const table of ["voice_usage", "app_limits", "gemini_price", "signup_allowlist"]) {
        const r = await c.from(table).select("*");
        expect(r.error ?? (r.data as unknown[]).length === 0, table).toBeTruthy();
      }
    }
  });

  describe("in one rolled-back transaction (pg, impersonating the user)", () => {
    const asUser = async (id: string) => {
      await pg.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [id]);
      await pg.query(`set local role authenticated`);
    };
    const inTx = async (fn: () => Promise<void>) => {
      await pg.query("begin");
      try {
        await fn();
      } finally {
        await pg.query("rollback");
      }
    };
    const newUser = async (email: string) => {
      const id = crypto.randomUUID();
      await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
      return id;
    };
    const tryShop = async (owner: string, createdAt?: string) => {
      await pg.query("savepoint s");
      try {
        const r = await pg.query(`insert into shops (owner_user_id, name, catalog_mode${createdAt ? ", created_at" : ""}) values ($1, 'SG-20 tx', 'custom_only'${createdAt ? ", $2" : ""}) returning id, created_at`, createdAt ? [owner, createdAt] : [owner]);
        await pg.query("release savepoint s");
        return { ok: true as const, id: r.rows[0].id as string, createdAt: r.rows[0].created_at as Date };
      } catch (err) {
        await pg.query("rollback to savepoint s");
        return { ok: false as const, error: err as Error & { code?: string; hint?: string } };
      }
    };

    it("9. allowlist: a user not on the list is refused (signup_closed); on the list (any letter case) gets a shop", () =>
      inTx(async () => {
        await pg.query(`update app_limits set signup_mode = 'allowlist'`);
        const out = await newUser("stranger@sg20.local");
        const ins = await newUser("Invited.Person@SG20.local");
        await pg.query(`insert into signup_allowlist (email, note) values ('invited.person@sg20.LOCAL', 'e2e')`);
        await asUser(out);
        const refused = await tryShop(out);
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect([refused.error.code, refused.error.message, refused.error.hint]).toEqual(["P0001", "signup_closed", "signup_closed"]);
        await pg.query("reset role");
        await asUser(ins);
        expect((await tryShop(ins)).ok).toBe(true);
      }));

    it("10. open: anyone gets a shop; the shop's created_at is the server's clock, never the phone's", () =>
      inTx(async () => {
        await pg.query(`update app_limits set signup_mode = 'open'`);
        const u = await newUser("anyone@sg20.local");
        await asUser(u);
        const made = await tryShop(u, "2020-01-01T00:00:00Z");
        expect(made.ok).toBe(true);
        if (made.ok) expect(Math.abs(made.createdAt.getTime() - Date.now())).toBeLessThan(5 * 60_000);
      }));

    it("11. allowlist mode does not touch existing shops (update works) or the dashboard (postgres inserts any shop)", () =>
      inTx(async () => {
        await pg.query(`update app_limits set signup_mode = 'allowlist'`);
        await asUser(userId);
        const upd = await pg.query(`update shops set name = 'SG-20 renamed' where id = $1`, [shopId]);
        expect(upd.rowCount).toBe(1);
        await pg.query("reset role");
        const u = await newUser("dashboard-made@sg20.local");
        expect((await tryShop(u)).ok).toBe(true);
      }));

    it("12. the reports: per day and per shop, the TEST shop marked and left out of the totals", () =>
      inTx(async () => {
        await pg.query(`delete from voice_usage`); // other e2e shops' calls today (rolled back with the rest)
        await pg.query(`insert into auth.users (id, email) values ($1, 'test@sg20.local') on conflict (id) do nothing`, [TEST_USER]);
        await pg.query(`insert into shops (id, owner_user_id, name, catalog_mode) values ($1, $2, 'TEST', 'custom_only') on conflict (id) do nothing`, [TEST_SHOP, TEST_USER]);
        const d = await today();
        await pg.query(`insert into voice_usage (day, shop_id, calls, done, failed, refused, input_tokens, output_tokens, cost_micro_inr) values ($1::date, $2, 4, 3, 1, 2, 3600, 240, 404284), ($1::date, $3, 50, 50, 0, 0, 1, 1, 9000000)`, [d, shopId, TEST_SHOP]);
        const day = (await pg.query(`select * from reports.daily where day = $1::date`, [d])).rows[0];
        expect(day).toMatchObject({ voice_calls: "4", voice_done: "3", voice_failed: "1", voice_refused_by_limit: "2", gemini_cost_rs: "0.40" });
        // a final TEST bill made today is left out of the day's bills (loaded as a restore does - triggers off, in this rolled-back transaction)
        const billsBefore = Number((await pg.query(`select bills from reports.daily where day = $1::date`, [d])).rows[0].bills);
        await pg.query(`set local session_replication_role = replica`);
        await pg.query(`insert into bills (shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id) values ($1, gen_random_uuid(), 'T-1', 100, 100, 'final', 1, 'test-phone')`, [TEST_SHOP]);
        await pg.query(`set local session_replication_role = origin`);
        expect(Number((await pg.query(`select bills from reports.daily where day = $1::date`, [d])).rows[0].bills)).toBe(billsBefore);
        const total = (await pg.query(`select sum(new_shops)::int n from reports.daily`)).rows[0].n as number;
        const realShops = (await pg.query(`select count(*)::int n from shops where id <> $1`, [TEST_SHOP])).rows[0].n as number;
        expect(total).toBe(realShops);
        const mine = (await pg.query(`select * from reports.shops where shop_id = $1`, [shopId])).rows[0];
        expect(mine).toMatchObject({ is_test: false, voice_calls_today: "4", voice_calls_total: "4", gemini_cost_today_rs: "0.40", gemini_cost_total_rs: "0.40" });
        expect(mine.owner_email).toMatch(/@sg20\.local$/);
        expect((await pg.query(`select is_test from reports.shops where shop_id = $1`, [TEST_SHOP])).rows[0].is_test).toBe(true);
        for (const col of ["shop_name", "owner_email", "signed_up", "shop_created", "last_active", "phones", "bills_today", "bills_total", "voice_calls_today", "voice_calls_total", "gemini_cost_today_rs", "gemini_cost_total_rs", "avg_cost_per_bill_rs"]) expect(mine, col).toHaveProperty(col);
        for (const col of ["day", "new_users", "new_shops", "bills", "voice_calls", "voice_done", "voice_failed", "voice_refused_by_limit", "gemini_cost_rs"]) expect(day, col).toHaveProperty(col);
      }));

    it("13. the reports are refused to the app's roles inside Postgres too (42501)", () =>
      inTx(async () => {
        for (const role of ["anon", "authenticated"]) {
          for (const view of ["reports.daily", "reports.shops"]) {
            await pg.query("savepoint s");
            await pg.query(`set local role ${role}`);
            await expect(pg.query(`select * from ${view}`)).rejects.toMatchObject({ code: "42501" });
            await pg.query("rollback to savepoint s");
          }
        }
      }));

    it("14. Delete my account removes the shop's voice_usage rows", () =>
      inTx(async () => {
        const u = await newUser("leaver@sg20.local");
        const s = (await pg.query(`insert into shops (owner_user_id, name, catalog_mode) values ($1, 'leaver', 'custom_only') returning id`, [u])).rows[0].id as string;
        await pg.query(`insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')`, [s, u]);
        await pg.query(`insert into voice_usage (day, shop_id, calls) values (current_date, $1, 3)`, [s]);
        await asUser(u);
        const out = (await pg.query(`select delete_my_account() as c`)).rows[0].c as Record<string, number>;
        expect(out.voice_usage).toBe(1);
        await pg.query("reset role");
        expect((await pg.query(`select count(*)::int n from voice_usage where shop_id = $1`, [s])).rows[0].n).toBe(0);
      }));
  });
});
