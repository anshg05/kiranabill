import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const verifyMock = vi.fn();
const cachedShopMock = vi.fn();
const lookupShopMock = vi.fn();
const mayRunUnconfirmedMock = vi.fn();
const noteUnconfirmedMock = vi.fn();
const checkRateLimitMock = vi.fn();
const parseMock = vi.fn();

vi.mock("./jwt.js", () => ({ verifyAccessToken: verifyMock }));
vi.mock("./auth.js", () => ({ cachedShop: cachedShopMock, lookupShop: lookupShopMock, mayRunUnconfirmed: mayRunUnconfirmedMock, noteUnconfirmed: noteUnconfirmedMock }));
vi.mock("./rateLimit.js", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("../../../src/voice/groqTranscriptionProvider.js", () => ({ createGroqTranscriptionProvider: () => ({ transcribe: vi.fn() }) }));
vi.mock("../../../src/voice/geminiParseProvider.js", () => ({ createGeminiParseProvider: () => ({ parse: parseMock }) }));

const handler = (await import("../voice.mts")).default;
const { ProviderError } = await import("../../../src/voice/deadline.js");

// KB-358c (owner, 28 Oct 2026): /voice says WHICH quota a Gemini 429 hit - in the log (the quota's name only) and to the phone
// (`reason`, next to the unchanged 503, so an app that has not updated still works).

const textOnly = () => {
  const form = new FormData();
  form.set("meta", JSON.stringify({ transcript: "do kilo chini", catalogSlice: [] }));
  return new Request("https://example.com/voice", { method: "POST", headers: { Authorization: "Bearer real-jwt" }, body: form });
};

describe("KB-358c: the quota in the log and in the answer", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
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

  it("the DAILY limit: 503 with reason daily_limit; ONE warn line that ends with the quota's name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseMock.mockRejectedValueOnce(new ProviderError("busy", "Gemini parse failed: 429 {...}", 429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    const res = await handler(textOnly(), {} as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "Parse busy", reason: "daily_limit" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.map(String).join(" ")).toMatch(/^\[voice\] Parse failure kind=busy status=503 provider=429 ms=\d+ quota=GenerateRequestsPerDayPerProjectPerModel-FreeTier$/);
  });
  it("the per-minute limit -> reason minute_limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    parseMock.mockRejectedValueOnce(new ProviderError("busy", "x", 429, "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"));
    expect(await (await handler(textOnly(), {} as never)).json()).toMatchObject({ reason: "minute_limit" });
  });
  it("busy with no quota named (a 503 overload): reason busy, and no quota= in the line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseMock.mockRejectedValueOnce(new ProviderError("busy", "x", 503));
    expect(await (await handler(textOnly(), {} as never)).json()).toMatchObject({ error: "Parse busy", reason: "busy" });
    expect(warn.mock.calls[0]!.map(String).join(" ")).not.toContain("quota=");
  });
  it("a timeout carries no reason", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    parseMock.mockRejectedValueOnce(new ProviderError("timeout", "x"));
    expect((await (await handler(textOnly(), {} as never)).json()).reason).toBeUndefined();
  });
});
