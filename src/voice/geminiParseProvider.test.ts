import { describe, it, expect, vi, afterEach } from "vitest";
import { createGeminiParseProvider } from "./geminiParseProvider";
import type { CatalogEntry } from "@/domain/catalog";

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "27",
    displayName: "Chini",
    sourceCategory: "sugar",
    guardCategory: "other",
    unit: "kg",
    suggestedPricePaise: 4500,
    aliases: ["chini", "sugar"],
    isActive: true,
    ...overrides,
  };
}

function mockGeminiSuccess(items: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, totalTokenCount: 540 },
    }),
  };
}

describe("geminiParseProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("conforms to the ParseProvider interface shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGeminiSuccess([
        { spokenName: "chini", catalogId: "27", qty: 2, unit: "kg", rate: null, total: 9000, priceType: "total" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("test-key");
    expect(provider.name).toBe("gemini-flash-lite");

    const result = await provider.parse("do kilo chini 90 rupay", {
      catalogSlice: [makeCatalogEntry()],
    });

    expect(result.items).toEqual([
      {
        spokenName: "chini",
        catalogId: "27",
        isCustom: false,
        matchStatus: "matched",
        qty: 2,
        unit: "kg",
        rate: null,
        rateUnit: null,
        total: 9000,
        priceType: "total",
      },
    ]);
    expect(result.usage).toEqual({ promptTokens: 500, completionTokens: 40, totalTokens: 540 });
    expect(typeof result.latencyMs).toBe("number");
  });

  it("sends the cached grammar block, temperature 0.1, and the catalog slice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockGeminiSuccess([]));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("real-key");
    await provider.parse("chini", { catalogSlice: [makeCatalogEntry()] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const [url, init] = call;
    expect(url).toContain("gemini-2.5-flash-lite:generateContent");
    expect(url).toContain("key=real-key");

    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toContain("RULE 1");
    expect(body.generationConfig.temperature).toBe(0.1);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts[0].text).toContain("Chini");
    expect(body.contents[0].parts[0].text).toContain("chini");
  });

  it("KB-005f: a Gemini rate is mapped with rateUnit = Gemini's own unit - its claim, not verified (Layer 2 totals are untrusted, see 12-PARKED Layer 2 KI)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGeminiSuccess([
        { spokenName: "chawal", catalogId: "27", qty: 5, unit: "kg", rate: 5000, total: 25000, priceType: "rate" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("test-key");
    const result = await provider.parse("chawal 5 kilo 50 wala", { catalogSlice: [makeCatalogEntry()] });

    expect(result.items[0]).toMatchObject({ rate: 5000, rateUnit: "kg" });
  });

  it("maps a null/unmatched catalogId to isCustom:true, matchStatus:none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGeminiSuccess([
        { spokenName: "kaju katli", catalogId: null, qty: null, unit: "", rate: null, total: 0, priceType: "unknown" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("test-key");
    const result = await provider.parse("kaju katli", { catalogSlice: [makeCatalogEntry()] });

    expect(result.items[0]).toMatchObject({
      catalogId: null,
      isCustom: true,
      matchStatus: "none",
    });
  });

  it("distrusts a catalogId Gemini invents outside the given slice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGeminiSuccess([
        { spokenName: "chini", catalogId: "999-not-in-slice", qty: 1, unit: "kg", rate: null, total: 4500, priceType: "total" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("test-key");
    const result = await provider.parse("chini", { catalogSlice: [makeCatalogEntry()] });

    expect(result.items[0]).toMatchObject({ catalogId: null, isCustom: true, matchStatus: "none" });
  });

  // KB-317 (owner-approved plan; 12-PARKED.md KI-50): a 429 is a quota - on the
  // free tier a DAILY one - and won't clear in seconds. It used to be retried 3x
  // (0.5 + 1 + 2 s) before failing: ~3.7 s of waiting for a guaranteed error.
  it("does not retry a 429 (quota) - fails at once, one call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "quota exceeded" });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("test-key");
    await expect(provider.parse("chini", { catalogSlice: [makeCatalogEntry()] })).rejects.toThrow(/429.*quota exceeded/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retries on a persistent 500", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("test-key");
    const resultPromise = provider.parse("chini", { catalogSlice: [makeCatalogEntry()] });
    const assertion = expect(resultPromise).rejects.toThrow(/500.*server error/);

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable 400 (Gemini's real auth-failure shape, not 401)", async () => {
    // Real Gemini API behavior, confirmed against the live endpoint during
    // KB-205's verification: a bad key returns 400 INVALID_ARGUMENT with
    // reason API_KEY_INVALID, not a 401 - unlike Groq's KB-204 provider.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiParseProvider("bad-key");
    await expect(provider.parse("chini", { catalogSlice: [makeCatalogEntry()] })).rejects.toThrow(
      /400.*API key not valid/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
