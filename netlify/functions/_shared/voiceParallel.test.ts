import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyMock = vi.fn();
const cachedShopMock = vi.fn();
const lookupShopMock = vi.fn();
const mayRunUnconfirmedMock = vi.fn();
const noteUnconfirmedMock = vi.fn();
const checkRateLimitMock = vi.fn();
const transcribeMock = vi.fn();
const parseMock = vi.fn();

vi.mock("./jwt.js", () => ({ verifyAccessToken: verifyMock }));
vi.mock("./auth.js", () => ({ cachedShop: cachedShopMock, lookupShop: lookupShopMock, mayRunUnconfirmed: mayRunUnconfirmedMock, noteUnconfirmed: noteUnconfirmedMock }));
vi.mock("./rateLimit.js", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("../../../src/voice/groqTranscriptionProvider.js", () => ({ createGroqTranscriptionProvider: () => ({ transcribe: transcribeMock }) }));
vi.mock("../../../src/voice/geminiParseProvider.js", () => ({ createGeminiParseProvider: () => ({ parse: parseMock }) }));

const handler = (await import("../voice.mts")).default;
const { ProviderError } = await import("../../../src/voice/deadline.js");

// KB-353 (owner, 28 Oct 2026): the shop-membership answer used to be waited for before anything else (786 ms). A token that
// verified locally and whose shop is remembered goes straight on; otherwise Groq may start WHILE membership is asked. The
// owner's rule: the shop's rate-limit counter is only touched AFTER membership is confirmed (a cache hit may check at once),
// or any signed-in Google account could burn another shop's 300/hour. A "no" discards the transcript.

function makeRequest(fields: Record<string, string | Blob>, method = "POST") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://example.com/voice", { method, headers: { Authorization: "Bearer real-jwt" }, body: form });
}
const audioReq = () => makeRequest({ audio: new Blob(["x"]), meta: JSON.stringify({ parse: false }) });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("GROQ_API_KEY", "groq-key");
  vi.stubEnv("GEMINI_API_KEY", "gemini-key");
  verifyMock.mockResolvedValue({ userId: "user-1" });
  cachedShopMock.mockReturnValue(null); // a MISS unless a test says otherwise
  mayRunUnconfirmedMock.mockReturnValue(true);
  checkRateLimitMock.mockResolvedValue(true);
  transcribeMock.mockResolvedValue({ text: "do kilo chini", latencyMs: 300 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("KB-353: membership in parallel with Groq", () => {
  it("a remembered shop: no membership query at all; the limit is checked at once", async () => {
    cachedShopMock.mockReturnValue("shop-1");
    const res = await handler(audioReq(), {} as never);
    expect(res.status).toBe(200);
    expect(lookupShopMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).toHaveBeenCalledWith("shop-1");
  });

  it("a miss: Groq STARTS while membership is still unanswered, and the shop's counter has NOT been touched yet", async () => {
    const m = deferred<string | null>();
    lookupShopMock.mockReturnValue(m.promise);
    const pending = handler(audioReq(), {} as never);
    await tick();
    await tick();
    expect(transcribeMock).toHaveBeenCalledTimes(1); // in parallel
    expect(checkRateLimitMock).not.toHaveBeenCalled(); // the owner's rule
    m.resolve("shop-1");
    const res = await pending;
    expect(res.status).toBe(200);
    expect((await res.json()).transcript).toBe("do kilo chini");
    expect(checkRateLimitMock).toHaveBeenCalledWith("shop-1"); // only after the confirmation
  });

  it("a non-member leaves every shop's counter untouched, gets 401 and NO transcript", async () => {
    lookupShopMock.mockResolvedValue(null);
    const res = await handler(audioReq(), {} as never);
    expect(res.status).toBe(401);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain("chini");
    expect(noteUnconfirmedMock).toHaveBeenCalledWith("user-1");
  });

  it("a member over the shop's quota: 429, and the transcript is discarded", async () => {
    lookupShopMock.mockResolvedValue("shop-1");
    checkRateLimitMock.mockResolvedValue(false);
    const res = await handler(audioReq(), {} as never);
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).not.toContain("chini");
  });

  it("over the per-user cap on unconfirmed work: membership is waited for BEFORE Groq, so a non-member costs no Groq call", async () => {
    mayRunUnconfirmedMock.mockReturnValue(false);
    lookupShopMock.mockResolvedValue(null);
    const res = await handler(audioReq(), {} as never);
    expect(res.status).toBe(401);
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("over the cap but a real member: still served, Groq only after the confirmation", async () => {
    mayRunUnconfirmedMock.mockReturnValue(false);
    const m = deferred<string | null>();
    lookupShopMock.mockReturnValue(m.promise);
    const pending = handler(audioReq(), {} as never);
    await tick();
    await tick();
    expect(transcribeMock).not.toHaveBeenCalled();
    m.resolve("shop-1");
    expect((await pending).status).toBe(200);
  });

  it("a non-member whose Groq call FAILS still gets 401 (not a 502 that says something), with no unhandled rejection", async () => {
    transcribeMock.mockRejectedValue(new ProviderError("failed", "boom", 500));
    lookupShopMock.mockResolvedValue(null);
    const res = await handler(audioReq(), {} as never);
    expect(res.status).toBe(401);
    await tick();
  });

  it("a member whose Groq call fails: the usual 502, after the confirmation", async () => {
    transcribeMock.mockRejectedValue(new ProviderError("failed", "boom", 500));
    lookupShopMock.mockResolvedValue("shop-1");
    expect((await handler(audioReq(), {} as never)).status).toBe(502);
    expect(checkRateLimitMock).toHaveBeenCalledWith("shop-1");
  });

  it("a malformed request from a non-member is a 401, not a 400 (nothing is told to someone who is not a member)", async () => {
    lookupShopMock.mockResolvedValue(null);
    const res = await handler(makeRequest({ meta: "{}" }), {} as never);
    expect(res.status).toBe(401);
  });

  it("a text-only (Gemini) request waits for the confirmation first - it never runs unconfirmed", async () => {
    const m = deferred<string | null>();
    lookupShopMock.mockReturnValue(m.promise);
    parseMock.mockResolvedValue({ items: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, latencyMs: 5 });
    const entry = { id: "27", displayName: "Chini" };
    const pending = handler(makeRequest({ meta: JSON.stringify({ transcript: "do kilo chini", catalogSlice: [entry] }) }), {} as never);
    await tick();
    await tick();
    expect(parseMock).not.toHaveBeenCalled();
    m.resolve(null);
    expect((await pending).status).toBe(401);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("Server-Timing says how long membership took, and 0 when the shop was remembered", async () => {
    lookupShopMock.mockResolvedValue("shop-1");
    const miss = await handler(audioReq(), {} as never);
    expect(miss.headers.get("Server-Timing")).toMatch(/member;dur=\d+/);
    cachedShopMock.mockReturnValue("shop-1");
    const hitRes = await handler(audioReq(), {} as never);
    expect(hitRes.headers.get("Server-Timing")).toMatch(/member;dur=0/);
  });

  it("a warm-up GET is answered 405 with no sign-in, no limit and no provider (nothing is charged)", async () => {
    const res = await handler(new Request("https://example.com/voice", { method: "GET" }), {} as never);
    expect(res.status).toBe(405);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});
