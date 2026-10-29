import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiParseProvider, GEMINI_TIMEOUT_MS } from "./geminiParseProvider";
import { DEFAULT_GEMINI_MODEL } from "./geminiModel";

// KB-360 (owner, 29 Oct 2026): the provider names its model, passes ANY key through untouched, answers a setup problem (a bad key,
// a disabled API, a model this key cannot use) differently from "busy" and "failed", and reports Google's non-secret status / reason.

const ok = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }) };
const googleError = (status: number, body: unknown) => ({ ok: false, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const err = async (status: number, body: unknown) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(googleError(status, body)));
  return createGeminiParseProvider("k")
    .parse("do kilo chini", { catalogSlice: [] })
    .then(
      () => null,
      (e: unknown) => e as { kind: string; status: number; quota?: string; google?: { status?: string; reason?: string } },
    );
};

describe("the model and the key", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the default model is in the URL; a given one replaces it", async () => {
    const f = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal("fetch", f);
    await createGeminiParseProvider("k").parse("x", { catalogSlice: [] });
    expect(String(f.mock.calls[0]![0])).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    await createGeminiParseProvider("k", undefined, { model: "gemini-3.6-flash" }).parse("x", { catalogSlice: [] });
    expect(String(f.mock.calls[1]![0])).toContain("/models/gemini-3.6-flash:generateContent");
  });

  it("any key, whatever its shape, goes to Google exactly as given - in a header, never in the URL", async () => {
    for (const key of ["AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q", "AQ.Ab8RN6Jx_k-QwErTyUiOpAsDfGhJkLzXcVbNm1234567890", "a key with spaces.and.dots", "x"]) {
      const f = vi.fn().mockResolvedValue(ok);
      vi.stubGlobal("fetch", f);
      await createGeminiParseProvider(key).parse("x", { catalogSlice: [] });
      const [url, init] = f.mock.calls[0]!;
      expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": key });
      expect(String(url)).not.toContain(encodeURIComponent(key));
      expect(String(url)).not.toContain("key=");
    }
  });

  it("the deadline is 10 s (a 2.5-6.5 s answer from the new model must fit; D50 was 6 s for the old one)", () => {
    expect(GEMINI_TIMEOUT_MS).toBe(10_000);
  });
});

describe("what Google says is a SETUP problem (no Retry can fix it)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("404 NOT_FOUND - the model is not available to this key's project (the 29 Oct incident)", async () => {
    const e = await err(404, { error: { code: 404, status: "NOT_FOUND", message: "models/x is not found" } });
    expect(e).toMatchObject({ kind: "setup", status: 404, google: { status: "NOT_FOUND" } });
  });
  it("403 PERMISSION_DENIED / SERVICE_DISABLED - the API is not enabled in the key's project", async () => {
    const e = await err(403, { error: { code: 403, status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } });
    expect(e).toMatchObject({ kind: "setup", status: 403, google: { status: "PERMISSION_DENIED", reason: "SERVICE_DISABLED" } });
  });
  it("400 with reason API_KEY_INVALID - the key is wrong", async () => {
    const e = await err(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } });
    expect(e).toMatchObject({ kind: "setup", status: 400, google: { status: "INVALID_ARGUMENT", reason: "API_KEY_INVALID" } });
  });
  it("401 UNAUTHENTICATED", async () => {
    expect(await err(401, { error: { code: 401, status: "UNAUTHENTICATED" } })).toMatchObject({ kind: "setup", status: 401 });
  });
  it("402 RESOURCE_EXHAUSTED - billing / prepaid credit is not in order (the 29 Oct draft-v9 incident: every call 402, shown as a generic failure)", async () => {
    const e = await err(402, { error: { code: 402, status: "RESOURCE_EXHAUSTED", message: "Your prepayment credits are depleted." } });
    expect(e).toMatchObject({ kind: "setup", status: 402, google: { status: "RESOURCE_EXHAUSTED" } });
  });
  it("a 400 that is OUR request's fault is not a setup problem (it must show as a plain failure, never 'tell support')", async () => {
    const e = await err(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid JSON payload received" } });
    expect(e).toMatchObject({ kind: "failed", status: 400, google: { status: "INVALID_ARGUMENT" } });
  });
  it("429 stays busy (with its quota name) and 503 stays busy; a 500 stays failed", async () => {
    expect(await err(429, { error: { status: "RESOURCE_EXHAUSTED" } })).toMatchObject({ kind: "busy", google: { status: "RESOURCE_EXHAUSTED" } });
    expect(await err(503, { error: { status: "UNAVAILABLE" } })).toMatchObject({ kind: "busy", status: 503 });
    expect(await err(500, { error: { status: "INTERNAL" } })).toMatchObject({ kind: "failed", status: 500 });
  });
});

// The shape gemini-3.5-flash-lite really answers (recorded 29 Oct 2026 from a live call): the text part carries a thoughtSignature.
const RECORDED_ANSWER = [{ rate: null }];
const answer = (parts: unknown[]) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts, role: "model" }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }) });

describe("which part of Gemini's answer is read", () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = async (parts: unknown[]) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(parts)));
    return createGeminiParseProvider("k").parse("x", { catalogSlice: [] });
  };

  it("the recorded shape (one text part with a thoughtSignature) reads", async () => {
    const r = await run([{ text: "[]", thoughtSignature: "EmAKXgFp" }]);
    expect(r.items).toEqual([]);
  });
  it("a THOUGHT part before the answer is skipped - the answer is the last non-thought text part", async () => {
    const r = await run([{ text: "Let me think about this...", thought: true }, { text: "[]", thoughtSignature: "EmAKXgFp" }]);
    expect(r.items).toEqual([]);
  });
  it("a THOUGHT part after the answer is skipped too", async () => {
    const r = await run([{ text: "[]" }, { text: "Done thinking.", thought: true }]);
    expect(r.items).toEqual([]);
  });
  it("a signature-only part after the answer is skipped", async () => {
    const r = await run([{ text: "[]" }, { thoughtSignature: "EmAKXgFp" }]);
    expect(r.items).toEqual([]);
  });
  it("no readable part is a plain failure, not a crash", async () => {
    await expect(run([{ thoughtSignature: "x" }])).rejects.toBeDefined();
    expect(RECORDED_ANSWER).toHaveLength(1);
  });
});

describe("only a NAME is ever reported: never the body, the key or a message", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a status or reason that is not an UPPER_SNAKE name is dropped", async () => {
    const e = await err(404, { error: { status: "not found\n[voice] injected", details: [{ reason: "has a space" }] } });
    expect(e).toMatchObject({ kind: "setup" });
    expect(e!.google?.status).toBeUndefined();
    expect(e!.google?.reason).toBeUndefined();
  });
  it("a body that is not JSON names nothing", async () => {
    const e = await err(404, "<html>Not Found</html>");
    expect(e).toMatchObject({ kind: "setup", status: 404 });
    expect(e!.google).toBeUndefined();
  });
});
