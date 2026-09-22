import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const resolveAuthedRequestMock = vi.fn();
const checkRateLimitMock = vi.fn();
const transcribeMock = vi.fn();
const parseMock = vi.fn();

vi.mock("./auth.js", () => ({
  resolveAuthedRequest: resolveAuthedRequestMock,
}));
vi.mock("./rateLimit.js", () => ({
  checkRateLimit: checkRateLimitMock,
}));
vi.mock("../../../src/voice/groqTranscriptionProvider.js", () => ({
  createGroqTranscriptionProvider: () => ({ transcribe: transcribeMock }),
}));
vi.mock("../../../src/voice/geminiParseProvider.js", () => ({
  createGeminiParseProvider: () => ({ parse: parseMock }),
}));

const handler = (await import("../voice.mts")).default;

function makeRequest(fields: Record<string, string | Blob> | null, method = "POST") {
  if (fields === null) return new Request("https://example.com/voice", { method });
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://example.com/voice", {
    method,
    headers: { Authorization: "Bearer real-jwt" },
    body: form,
  });
}

describe("netlify/functions/voice.mts", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    resolveAuthedRequestMock.mockResolvedValue({
      userId: "user-1",
      shopId: "shop-1",
      client: {},
    });
    checkRateLimitMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await handler(makeRequest(null, "GET"), {} as never);
    expect(res.status).toBe(405);
  });

  it("rejects an unauthenticated request with 401 before touching rate limiting or providers", async () => {
    resolveAuthedRequestMock.mockResolvedValue(null);
    const res = await handler(makeRequest({ audio: new Blob(["x"]), meta: "{}" }), {} as never);
    expect(res.status).toBe(401);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("rejects a request over the per-shop quota with 429", async () => {
    checkRateLimitMock.mockResolvedValue(false);
    const res = await handler(makeRequest({ audio: new Blob(["x"]), meta: "{}" }), {} as never);
    expect(res.status).toBe(429);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("rejects a body missing the audio field with 400", async () => {
    const res = await handler(makeRequest({ meta: JSON.stringify({ parse: false }) }), {} as never);
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON in the meta field with 400", async () => {
    const res = await handler(makeRequest({ audio: new Blob(["x"]), meta: "not json" }), {} as never);
    expect(res.status).toBe(400);
  });

  it("transcribe-only path: returns transcript and latencyMs, never calls the parse provider", async () => {
    transcribeMock.mockResolvedValue({ text: "do kilo chini", latencyMs: 500 });
    const res = await handler(
      makeRequest({ audio: new Blob(["x"]), meta: JSON.stringify({ parse: false }) }),
      {} as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toBe("do kilo chini");
    expect(typeof body.latencyMs).toBe("number");
    expect(body.items).toBeUndefined();
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("rejects parse:true with no catalogSlice with 400", async () => {
    transcribeMock.mockResolvedValue({ text: "chini", latencyMs: 500 });
    const res = await handler(
      makeRequest({ audio: new Blob(["x"]), meta: JSON.stringify({ parse: true }) }),
      {} as never,
    );
    expect(res.status).toBe(400);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("transcribe-then-parse path: returns transcript, items, usage, latencyMs", async () => {
    transcribeMock.mockResolvedValue({ text: "chini", latencyMs: 500 });
    parseMock.mockResolvedValue({
      items: [{ spokenName: "chini", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: null, total: 9000, priceType: "total" }],
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      latencyMs: 1200,
    });
    const meta = { parse: true, catalogSlice: [{ id: "27", displayName: "Chini" }] };
    const res = await handler(
      makeRequest({ audio: new Blob(["x"]), meta: JSON.stringify(meta) }),
      {} as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toBe("chini");
    expect(body.items).toHaveLength(1);
    expect(body.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    expect(typeof body.latencyMs).toBe("number");
  });

  it("returns 502 with the real error detail when transcription fails", async () => {
    transcribeMock.mockRejectedValue(new Error("Groq transcription failed: 500 server error"));
    const res = await handler(
      makeRequest({ audio: new Blob(["x"]), meta: JSON.stringify({ parse: false }) }),
      {} as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.detail).toContain("Groq transcription failed");
  });

  it("returns 502 but still includes the transcript when parsing fails", async () => {
    transcribeMock.mockResolvedValue({ text: "chini", latencyMs: 500 });
    parseMock.mockRejectedValue(new Error("Gemini parse failed: 500 server error"));
    const meta = { parse: true, catalogSlice: [{ id: "27", displayName: "Chini" }] };
    const res = await handler(
      makeRequest({ audio: new Blob(["x"]), meta: JSON.stringify(meta) }),
      {} as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.transcript).toBe("chini");
    expect(body.detail).toContain("Gemini parse failed");
  });
});
