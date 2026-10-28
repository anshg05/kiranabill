import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiParseProvider } from "./geminiParseProvider";

// KB-358c (owner, 28 Oct 2026): Google AI Studio showed 22/20 requests per DAY on the free tier - the 429s were the daily limit,
// but nothing we logged could say so. The provider now reads WHICH quota the 429 names (its quotaId - a name, never the
// transcript, the key or the body) so /voice can log it and tell the phone.

const body429 = (quotaId: string) =>
  JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId, quotaDimensions: { model: "gemini-2.5-flash-lite" }, quotaValue: "20" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "28s" },
      ],
    },
  });

const fail = async (status: number, text: string) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, text: async () => text }));
  return createGeminiParseProvider("k")
    .parse("do kilo chini", { catalogSlice: [] })
    .then(
      () => null,
      (e: unknown) => e as { kind: string; status: number; quota?: string },
    );
};

describe("the quota a Gemini 429 names", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the daily free-tier limit: quota = its quotaId", async () => {
    const err = await fail(429, body429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    expect(err).toMatchObject({ kind: "busy", status: 429, quota: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" });
  });
  it("the per-minute limit", async () => {
    const err = await fail(429, body429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"));
    expect(err).toMatchObject({ kind: "busy", quota: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" });
  });
  it("a body that names nothing, is not JSON, or has a hostile id: no quota at all (never a log injection)", async () => {
    expect(await fail(429, "quota exceeded")).toMatchObject({ kind: "busy", quota: undefined });
    expect(await fail(429, "{}")).toMatchObject({ quota: undefined });
    expect(await fail(429, body429("bad id\nwith [voice] newline"))).toMatchObject({ quota: undefined });
    expect(await fail(503, body429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).toMatchObject({ kind: "busy", status: 503, quota: undefined }); // only a 429 is a quota
  });
});
