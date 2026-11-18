import { afterEach, describe, expect, it, vi } from "vitest";
import { GIVE_UP_MS, nextSteps, POLL_INTERVAL_MS, submitRecording, type VoiceJobOutcome } from "./voiceJob";
import { submitAppRecording, voiceRunEndpoint } from "./voiceRunEndpoint";

// KB-384a step 4 (owner, 9 Nov 2026; D107): the phone's side of the async voice path. Upload -> row -> /voice-run -> watch the row every
// 1.5 s. Every outcome that is not a bill ends in Retry (the SAME recording) or Add by hand - never a dead end.

const SHOP = "11111111-1111-4111-8111-111111111111";
const REC = "22222222-2222-4222-8222-222222222222";
type Row = { status: string; attempts: number; transcript: string | null; items: unknown[] | null; error: string | null } | null;
const Q: Row = { status: "queued", attempts: 0, transcript: null, items: null, error: null }; // the row as it is before /voice-run starts

function fake(opts: { upload?: { message: string; statusCode?: string } | null; insert?: { code?: string; message: string } | null; rows?: (Row | Error)[]; post?: Response | Error } = {}) {
  const rows = [...(opts.rows ?? [Q, { status: "done", attempts: 1, transcript: "दो किलो चीनी", items: [{ spokenName: "चीनी" }], error: null }])];
  const upload = vi.fn(async (..._a: unknown[]) => ({ error: opts.upload ?? null }));
  const insert = vi.fn(async (..._a: unknown[]) => ({ error: opts.insert ?? null }));
  const read = vi.fn(async () => {
    const next = rows.length > 1 ? rows.shift()! : rows[0]!;
    if (next instanceof Error) throw next;
    return { data: next, error: null };
  });
  const client = {
    storage: { from: vi.fn(() => ({ upload })) },
    from: vi.fn(() => ({ insert, select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: read })) })) })),
  };
  const fetchImpl = vi.fn(async (..._a: unknown[]) => {
    if (opts.post instanceof Error) throw opts.post;
    return opts.post ?? new Response(null, { status: 202 });
  });
  let t = 0;
  const sleep = vi.fn(async (ms: number) => void (t += ms));
  const run = () =>
    submitRecording({ client: client as never, shopId: SHOP, recordingId: REC, audio: new Blob([new Uint8Array([1, 2])], { type: "audio/webm;codecs=opus" }), accessToken: "jwt", fetchImpl: fetchImpl as never, sleep, now: () => t });
  return { run, upload, insert, read, fetchImpl, sleep, client };
}

describe("submitRecording (KB-384a step 4)", () => {
  it("the settings: every 1.5 s; give up after 75 s - past Gemini's 60 s and the 70 s after which a stuck run is claimed again", () => {
    expect(POLL_INTERVAL_MS).toBe(1500);
    expect(GIVE_UP_MS).toBe(75_000);
  });

  it("uploads {shop}/{recording} as the BARE audio type (no overwrite), adds the row, starts /voice-run with the token, and returns the done answer", async () => {
    const f = fake({ rows: [Q, Q, { status: "running", attempts: 1, transcript: null, items: null, error: null }, { status: "done", attempts: 1, transcript: "दो किलो चीनी", items: [{ spokenName: "चीनी" }], error: null }] });
    const out = await f.run();
    expect(f.upload).toHaveBeenCalledWith(`${SHOP}/${REC}`, expect.any(Blob), { contentType: "audio/webm", upsert: false });
    expect(f.insert).toHaveBeenCalledWith({ recording_id: REC, shop_id: SHOP, mime: "audio/webm" });
    const [endpoint, init] = f.fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(endpoint).toBe("/voice-run");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: REC }) });
    expect(out).toEqual({ kind: "done", recordingId: REC, transcript: "दो किलो चीनी", items: [{ spokenName: "चीनी" }] });
    expect(f.sleep).toHaveBeenCalledWith(1500);
    expect(f.read).toHaveBeenCalledTimes(4); // the check before starting + 3 while watching
    expect(nextSteps(out)).toEqual([]);
  });

  describe("where /voice-run is (option (b) step 3, owner 18 Nov 2026)", () => {
    afterEach(() => vi.unstubAllEnvs());
    // the billing screen's own call (BillingScreen.tsx: submitAppRecording), with fake storage, rows and network
    const startedAt = async () => {
      const f = fake({ rows: [Q, { status: "done", attempts: 1, transcript: "x", items: [], error: null }] });
      await submitAppRecording({ client: f.client as never, shopId: SHOP, recordingId: REC, audio: new Blob([new Uint8Array([1])], { type: "audio/webm" }), accessToken: "jwt", fetchImpl: f.fetchImpl as never, sleep: f.sleep, now: () => 0 });
      return (f.fetchImpl.mock.calls[0]! as [string])[0];
    };
    it("the WEBSITE build (VITE_VOICE_RUN_URL unset or empty): /voice-run on its own site, exactly as before", async () => {
      vi.stubEnv("VITE_VOICE_RUN_URL", undefined as never);
      expect(voiceRunEndpoint()).toBe("/voice-run");
      expect(await startedAt()).toBe("/voice-run");
      vi.stubEnv("VITE_VOICE_RUN_URL", "");
      expect(await startedAt()).toBe("/voice-run");
    });
    it("the APP build: the functions site's full address", async () => {
      vi.stubEnv("VITE_VOICE_RUN_URL", "https://kvb-api.netlify.app/voice-run");
      expect(await startedAt()).toBe("https://kvb-api.netlify.app/voice-run");
    });
  });

  it("a FAILED row: failed with its reason -> Retry or Add by hand", async () => {
    const out = await fake({ rows: [Q, { status: "failed", attempts: 1, transcript: null, items: null, error: "timeout" }] }).run();
    expect(out).toEqual({ kind: "failed", recordingId: REC, reason: "timeout" });
    expect(nextSteps(out)).toEqual(["retry", "add_by_hand"]);
  });

  it("no answer in 75 s: gave up -> Retry or Add by hand (about 50 checks, none after the limit)", async () => {
    const f = fake({ rows: [Q, { status: "running", attempts: 1, transcript: null, items: null, error: null }] });
    const out = await f.run();
    expect(out).toEqual({ kind: "gave_up", recordingId: REC });
    expect(nextSteps(out)).toEqual(["retry", "add_by_hand"]);
    expect(f.read.mock.calls.length).toBeGreaterThanOrEqual(50);
    expect(f.read.mock.calls.length).toBeLessThanOrEqual(52);
  });

  it("Retry with the SAME recording: an upload or a row that already exists is not an error", async () => {
    const f = fake({ upload: { message: "The resource already exists", statusCode: "409" }, insert: { code: "23505", message: "duplicate key" } });
    expect((await f.run()).kind).toBe("done");
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it("KB-385: the upload is REFUSED for the login (expired session, 401 / 403): failed 'session' - the screen asks to sign in, the recording is kept", async () => {
    for (const upload of [{ message: "Unauthorized", statusCode: "401" }, { message: "new row violates row-level security policy", statusCode: "403" }, { message: "jwt expired", statusCode: "400" }]) {
      const f = fake({ upload });
      expect(await f.run()).toEqual({ kind: "failed", recordingId: REC, reason: "session" });
      expect(f.insert).not.toHaveBeenCalled();
    }
  });

  it("the upload fails (offline, too big): failed 'upload' - nothing started, Retry or Add by hand", async () => {
    const f = fake({ upload: { message: "Failed to fetch" } });
    const out = await f.run();
    expect(out).toEqual({ kind: "failed", recordingId: REC, reason: "upload" });
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(nextSteps(out)).toEqual(["retry", "add_by_hand"]);
  });

  it("the row cannot be added: failed 'start', /voice-run not called", async () => {
    const f = fake({ insert: { code: "42501", message: "rls" } });
    expect(await f.run()).toEqual({ kind: "failed", recordingId: REC, reason: "start" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("/voice-run cannot be reached or refuses: failed 'start', nothing watched", async () => {
    for (const post of [new Error("offline"), new Response(null, { status: 500 })]) {
      const f = fake({ post });
      expect(await f.run()).toEqual({ kind: "failed", recordingId: REC, reason: "start" });
      expect(f.read).toHaveBeenCalledOnce(); // only the check before starting - nothing watched
    }
  });

  it("KB-414 bug A: a failure because fetch itself failed (no network) is marked network - as Storage, PostgREST and fetch report it", async () => {
    const offline = new TypeError("Failed to fetch");
    // Storage wraps it (StorageUnknownError.originalError); PostgREST flattens it into its message; /voice-run's fetch throws it
    expect(await fake({ upload: { message: "Failed to fetch", originalError: offline } as never }).run()).toEqual({ kind: "failed", recordingId: REC, reason: "upload", network: true });
    expect(await fake({ insert: { code: "", message: "TypeError: Failed to fetch" } }).run()).toEqual({ kind: "failed", recordingId: REC, reason: "start", network: true });
    expect(await fake({ post: offline }).run()).toEqual({ kind: "failed", recordingId: REC, reason: "start", network: true });
    // the server answered (an error status, a refusal): not a network failure
    expect(await fake({ upload: { message: "Payload too large", statusCode: "413" } }).run()).toEqual({ kind: "failed", recordingId: REC, reason: "upload" });
    expect(await fake({ post: new Response(null, { status: 500 }) }).run()).toEqual({ kind: "failed", recordingId: REC, reason: "start" });
  });

  it("a check that fails on the way (a network blip) is not the end: it keeps watching", async () => {
    const f = fake({ rows: [Q, new Error("Failed to fetch"), { status: "done", attempts: 1, transcript: "x", items: [], error: null }] });
    expect((await f.run()).kind).toBe("done");
  });

  it("Retry after a FAILED attempt: the old failure is not the answer - it waits for the NEW attempt (found by the e2e)", async () => {
    const old = { status: "failed", attempts: 1, transcript: null, items: null, error: "failed" };
    const f = fake({ rows: [old, old, old, { status: "running", attempts: 2, transcript: null, items: null, error: null }, { status: "done", attempts: 2, transcript: "x", items: [], error: null }] });
    expect((await f.run()).kind).toBe("done");
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it("Retry on a recording that is ALREADY done: answered at once - /voice-run is not even called", async () => {
    const f = fake({ rows: [{ status: "done", attempts: 1, transcript: "x", items: [], error: null }] });
    expect(await f.run()).toEqual({ kind: "done", recordingId: REC, transcript: "x", items: [] });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("every outcome kind maps to a next step - never a dead end", () => {
    const outcomes: VoiceJobOutcome[] = [{ kind: "failed", recordingId: REC, reason: "x" }, { kind: "gave_up", recordingId: REC }];
    for (const o of outcomes) expect(nextSteps(o)).toEqual(["retry", "add_by_hand"]);
  });
});

describe("the three time limits stay in order across the code (KB-384a)", () => {
  it("Gemini's limit (worker) < the reclaim of a stuck run (SQL) < the phone giving up", async () => {
    const { readFileSync } = await import("node:fs");
    const { V3_GEMINI_TIMEOUT_MS } = await import("../../netlify/functions/_shared/voiceRun");
    const sql = readFileSync(new URL("../../supabase/migrations/20261109110000_kb384a_voice_recordings.sql", import.meta.url), "utf8");
    const reclaimMs = Number(/started_at < now\(\) - interval '(\d+) seconds'/.exec(sql)![1]) * 1000;
    expect(V3_GEMINI_TIMEOUT_MS).toBeLessThan(reclaimMs);
    expect(reclaimMs).toBeLessThan(GIVE_UP_MS);
  });
});
