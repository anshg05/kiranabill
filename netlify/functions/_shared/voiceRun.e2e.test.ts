/// <reference types="vite/client" />
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createShop } from "../../../src/data/shops";

/**
 * KB-384a step 3 (D107) on the REAL local stack: the /voice-run handler verifies the caller's real token, claims, downloads the real
 * uploaded audio and finishes AS THE CALLER through the real RLS, claim and finish functions. Only Gemini's HTTP call is faked
 * (no spend) and the Netlify Blobs rate limit (not available outside Netlify). Refuses anything but localhost.
 */

vi.mock("./rateLimit.js", () => ({ checkRateLimit: vi.fn(async () => true) }));
import handler from "../voice-run.mts";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const AUDIO = new Uint8Array([26, 69, 223, 163, 42, 43, 44]);

type Shop = { client: SupabaseClient; shopId: string; token: string };
async function shopUser(label: string): Promise<Shop> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  // Generated test credentials for the LOCAL stack only - never printed.
  const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb384a-run.local`, password: crypto.randomUUID() });
  if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
  const shopId = (await createShop(client, { ownerUserId: data.user.id, name: `KB-384a run ${label}`, phone: null, catalogMode: "custom_only" })).id;
  return { client, shopId, token: data.session.access_token };
}

describe("KB-384a e2e - the /voice-run worker on the local stack (Gemini faked)", () => {
  let a: Shop;
  let b: Shop;
  let pg: Client;
  const realFetch = globalThis.fetch;
  let geminiCalls: string[] = [];
  let geminiStatus = 200;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Refusing to run: not the local stack");
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    a = await shopUser("A");
    b = await shopUser("B");
    process.env.GEMINI_API_KEY = "fake-gemini-key-for-e2e";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input instanceof Request ? input.url : input);
      if (!target.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      geminiCalls.push(String(init?.body ?? ""));
      if (geminiStatus !== 200) return new Response("{}", { status: geminiStatus });
      const text = JSON.stringify({ transcript: "दो किलो चीनी 45 रुपए किलो", items: [{ spokenName: "चीनी", catalogId: null, qty: 2, unit: "kg", rate: 4500, total: null, priceType: "rate" }] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60, totalTokenCount: 960 } }), { status: 200 });
    });
  }, 60_000);
  afterEach(() => {
    geminiCalls = [];
    geminiStatus = 200;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await pg?.end();
  });

  async function recording(who: Shop): Promise<string> {
    const rec = crypto.randomUUID();
    const up = await who.client.storage.from("recordings").upload(`${who.shopId}/${rec}`, AUDIO, { contentType: "audio/webm" });
    if (up.error) throw new Error(up.error.message);
    const ins = await who.client.from("voice_recordings").insert({ recording_id: rec, shop_id: who.shopId, mime: "audio/webm" });
    if (ins.error) throw new Error(ins.error.message);
    return rec;
  }
  const run = (who: Shop, rec: string) =>
    handler(new Request("http://localhost/voice-run", { method: "POST", headers: { authorization: `Bearer ${who.token}`, "content-type": "application/json" }, body: JSON.stringify({ recordingId: rec }) }), {} as never);
  const rowOf = async (rec: string) => (await pg.query("select status, attempts, transcript, items, model, error from voice_recordings where recording_id = $1", [rec])).rows[0];

  it("1. the caller's recording: ONE Gemini call with the real uploaded audio; the row is done with the raw answer", async () => {
    const rec = await recording(a);
    const res = await run(a, rec);
    expect(res.status).toBe(202);
    expect(geminiCalls).toHaveLength(1);
    expect(geminiCalls[0]).toContain(Buffer.from(AUDIO).toString("base64"));
    expect(geminiCalls[0]).toContain('"mimeType":"audio/webm"');
    const row = await rowOf(rec);
    expect(row).toMatchObject({ status: "done", attempts: 1, transcript: "दो किलो चीनी 45 रुपए किलो", model: "gemini-3.8-flash", error: null });
    expect(row.items).toMatchObject([{ spokenName: "चीनी", qty: 2, unit: "kg", rate: 4500, priceType: "rate" }]);
  }, 60_000);

  it("2. a retry or double tap on a done recording makes NO second Gemini call", async () => {
    const rec = await recording(a);
    await Promise.all([run(a, rec), run(a, rec)]);
    await run(a, rec);
    expect(geminiCalls).toHaveLength(1);
    expect(await rowOf(rec)).toMatchObject({ status: "done", attempts: 1 });
  }, 60_000);

  it("3. shop B calling the worker for shop A's recording: nothing runs, nothing changes", async () => {
    const rec = await recording(a);
    await run(b, rec);
    expect(geminiCalls).toHaveLength(0);
    expect(await rowOf(rec)).toMatchObject({ status: "queued", attempts: 0 });
  }, 60_000);

  it("4. Gemini fails: the row is FAILED (kind only); Retry with the same recording runs again and is done", async () => {
    const rec = await recording(a);
    geminiStatus = 500;
    await run(a, rec);
    expect(await rowOf(rec)).toMatchObject({ status: "failed", attempts: 1, error: "failed", transcript: null });
    geminiStatus = 200;
    await run(a, rec);
    expect(await rowOf(rec)).toMatchObject({ status: "done", attempts: 2, error: null });
    expect(geminiCalls).toHaveLength(2);
  }, 60_000);

  it("5. a forged token runs nothing", async () => {
    const rec = await recording(a);
    const [h, p, s] = a.token.split(".") as [string, string, string];
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: crypto.randomUUID() })).toString("base64url")}.${s}`;
    await handler(new Request("http://localhost/voice-run", { method: "POST", headers: { authorization: `Bearer ${forged}` }, body: JSON.stringify({ recordingId: rec }) }), {} as never);
    expect(geminiCalls).toHaveLength(0);
    expect(await rowOf(rec)).toMatchObject({ status: "queued" });
  }, 60_000);
});
