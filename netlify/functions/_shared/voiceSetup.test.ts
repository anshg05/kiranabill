import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const verifyMock = vi.fn();
const cachedShopMock = vi.fn();
const lookupShopMock = vi.fn();
const mayRunUnconfirmedMock = vi.fn();
const noteUnconfirmedMock = vi.fn();
const checkRateLimitMock = vi.fn();
const parseMock = vi.fn();
const createGeminiMock = vi.fn((..._args: unknown[]) => ({ parse: parseMock }));

vi.mock("./jwt.js", () => ({ verifyAccessToken: verifyMock }));
vi.mock("./auth.js", () => ({ cachedShop: cachedShopMock, lookupShop: lookupShopMock, mayRunUnconfirmed: mayRunUnconfirmedMock, noteUnconfirmed: noteUnconfirmedMock }));
vi.mock("./rateLimit.js", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("../../../src/voice/groqTranscriptionProvider.js", () => ({ createGroqTranscriptionProvider: () => ({ transcribe: vi.fn() }) }));
vi.mock("../../../src/voice/geminiParseProvider.js", () => ({ createGeminiParseProvider: createGeminiMock }));

const handler = (await import("../voice.mts")).default;
const { ProviderError } = await import("../../../src/voice/deadline.js");

// KB-360 (owner, 29 Oct 2026): /voice reads GEMINI_MODEL (an exact name, never an alias), logs the model and the cost of every call, says a
// SETUP problem as a setup problem (a bad key, a disabled API, a model this key cannot use), and logs Google's non-secret status / reason.

const textOnly = () => {
  const form = new FormData();
  form.set("meta", JSON.stringify({ transcript: "do kilo chini", catalogSlice: [] }));
  return new Request("https://example.com/voice", { method: "POST", headers: { Authorization: "Bearer real-jwt" }, body: form });
};
const modelOf = (): unknown => (createGeminiMock.mock.calls.at(-1)![2] as { model?: string } | undefined)?.model;

describe("KB-360: the model, the log and the setup answer", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GEMINI_API_KEY", "any-shaped.key_AQ.123");
    vi.stubEnv("GEMINI_MODEL", "");
    verifyMock.mockResolvedValue({ userId: "user-1" });
    cachedShopMock.mockReturnValue("shop-1");
    mayRunUnconfirmedMock.mockReturnValue(true);
    checkRateLimitMock.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("GEMINI_MODEL unset -> the default; set -> that model; the key goes through untouched whatever its shape", async () => {
    parseMock.mockResolvedValue({ items: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    vi.spyOn(console, "info").mockImplementation(() => {});
    await handler(textOnly(), {} as never);
    expect(modelOf()).toBe("gemini-3.5-flash-lite");
    expect(createGeminiMock.mock.calls.at(-1)![0]).toBe("any-shaped.key_AQ.123");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.6-flash");
    await handler(textOnly(), {} as never);
    expect(modelOf()).toBe("gemini-3.6-flash");
  });

  it("a '-latest' alias or a malformed GEMINI_MODEL is ignored with ONE clear warning (and the default is used)", async () => {
    parseMock.mockResolvedValue({ items: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("GEMINI_MODEL", "gemini-flash-latest");
    await handler(textOnly(), {} as never);
    expect(modelOf()).toBe("gemini-3.5-flash-lite");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe("[voice] GEMINI_MODEL ignored: not an exact model name (an alias or a malformed value); using the default");
  });

  it("every successful parse logs the model, the time and the token counts - numbers and the model's name only", async () => {
    parseMock.mockResolvedValue({ items: [], usage: { promptTokens: 2530, completionTokens: 140, totalTokens: 2670 }, latencyMs: 2400 });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await handler(textOnly(), {} as never);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/^\[voice\] parse ok model=gemini-3\.5-flash-lite ms=\d+ in=2530 out=140 thoughts=0$/);
  });

  it("a SETUP failure (a 404 for this key's project) -> 502 with reason 'setup'; the line names Google's status and reason, nothing else", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseMock.mockRejectedValueOnce(new ProviderError("setup", "Gemini parse failed: 404 {...secret body...}", 404, undefined, { status: "NOT_FOUND", reason: "MODEL_NOT_AVAILABLE" }));
    const res = await handler(textOnly(), {} as never);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "Parse failed", reason: "setup" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[voice\] Parse failure kind=setup status=502 provider=404 ms=\d+ google=NOT_FOUND reason=MODEL_NOT_AVAILABLE$/);
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/secret|body|any-shaped/);
  });

  it("the Google status alone (no reason) is logged as it is; a 429 keeps its quota name before it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseMock.mockRejectedValueOnce(new ProviderError("busy", "x", 429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier", { status: "RESOURCE_EXHAUSTED" }));
    await handler(textOnly(), {} as never);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[voice\] Parse failure kind=busy status=503 provider=429 ms=\d+ quota=GenerateRequestsPerDayPerProjectPerModel-FreeTier google=RESOURCE_EXHAUSTED$/);
  });
});
