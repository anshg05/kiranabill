import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { aiAnswerBill } from "@/domain/aiAnswerBill";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { createShop } from "./shops";
import { markRecordingBilled, nextSteps, submitRecording } from "./voiceJob";

/**
 * KB-384a step 4 (D107) on the REAL local stack, end to end: the phone's submitRecording (real upload, real row, real reads of the row)
 * against the real /voice-run handler (real token, claim, download, finish) - started in the background as Netlify does, 202 at once.
 * Only Gemini's HTTP call is faked (no spend) and the Netlify Blobs rate limit. Then the bill is built by src/domain/aiAnswerBill.
 */

vi.mock("../../netlify/functions/_shared/rateLimit.js", () => ({ checkRateLimit: vi.fn(async () => true) }));
import handler from "../../netlify/functions/voice-run.mts";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("KB-384a e2e - the phone's async voice path on the local stack (Gemini faked)", () => {
  let client: SupabaseClient;
  let shopId: string;
  let token: string;
  let pg: Client;
  const realFetch = globalThis.fetch;
  let geminiCalls = 0;
  let geminiStatus = 200;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Refusing to run: not the local stack");
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    process.env.GEMINI_API_KEY = "fake-gemini-key-for-e2e";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input instanceof Request ? input.url : input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      geminiCalls++;
      if (geminiStatus !== 200) return new Response("{}", { status: geminiStatus });
      const text = JSON.stringify({ transcript: "दो किलो चीनी 45 रुपए किलो", items: [{ spokenName: "चीनी", catalogId: null, qty: 2, unit: "kg", rate: 4500, total: null, priceType: "rate" }] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60, totalTokenCount: 960 } }), { status: 200 });
    });
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb384a-phone.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    token = data.session.access_token;
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-384a phone e2e", phone: null, catalogMode: "custom_only" })).id;
  }, 60_000);
  afterEach(() => {
    geminiCalls = 0;
    geminiStatus = 200;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await pg?.end();
  });

  /** /voice-run as Netlify runs a background function: the caller gets 202 at once, the job goes on. */
  const backgroundRun: typeof fetch = async (_endpoint, init) => {
    void handler(new Request("http://localhost/voice-run", init), {} as never);
    return new Response(null, { status: 202 });
  };
  const audio = new Blob([new Uint8Array([26, 69, 223, 163, 9, 9])], { type: "audio/webm;codecs=opus" });
  const submit = (recordingId: string) => submitRecording({ client, shopId, recordingId, audio, accessToken: token, fetchImpl: backgroundRun, sleep: (ms) => new Promise((r) => setTimeout(r, ms / 10)) });

  it("1. record -> upload -> /voice-run -> watched until done; the domain builds the bill from the answer", async () => {
    const rec = crypto.randomUUID();
    const out = await submit(rec);
    expect(out).toMatchObject({ kind: "done", recordingId: rec, transcript: "दो किलो चीनी 45 रुपए किलो" });
    expect(geminiCalls).toBe(1);
    expect(nextSteps(out)).toEqual([]);
    if (out.kind !== "done") throw new Error("not done");
    const bill = aiAnswerBill(out.transcript, out.items, SEED_PARSER_CATALOG);
    expect(bill.lines.map((l) => [l.item.qty, l.item.unit, l.item.rate, l.item.total])).toEqual([[2, "kg", 4500, 9000]]);
  }, 60_000);

  it("2. Retry (or a double tap) on a done recording: done at once, NO second Gemini call", async () => {
    const rec = crypto.randomUUID();
    await submit(rec);
    const [a, b] = await Promise.all([submit(rec), submit(rec)]);
    expect([a.kind, b.kind]).toEqual(["done", "done"]);
    expect(geminiCalls).toBe(1);
  }, 60_000);

  it("3. Gemini fails: failed -> Retry or Add by hand; Retry with the same recording is done (attempt 2)", async () => {
    const rec = crypto.randomUUID();
    geminiStatus = 500;
    const first = await submit(rec);
    expect(first).toEqual({ kind: "failed", recordingId: rec, reason: "failed" });
    expect(nextSteps(first)).toEqual(["retry", "add_by_hand"]);
    geminiStatus = 200;
    expect((await submit(rec)).kind).toBe("done");
    expect((await pg.query("select attempts from voice_recordings where recording_id = $1", [rec])).rows[0].attempts).toBe(2);
  }, 60_000);

  it("4. the bill is made: billed_at is stamped once by the server (the 7-day clock); a second call changes nothing", async () => {
    const rec = crypto.randomUUID();
    await submit(rec);
    expect(await markRecordingBilled(client, rec)).toBe(true);
    const first = (await pg.query("select billed_at from voice_recordings where recording_id = $1", [rec])).rows[0].billed_at as Date;
    expect(Math.abs(first.getTime() - Date.now())).toBeLessThan(60_000);
    await markRecordingBilled(client, rec);
    expect(((await pg.query("select billed_at from voice_recordings where recording_id = $1", [rec])).rows[0].billed_at as Date).getTime()).toBe(first.getTime());
  }, 60_000);
});
