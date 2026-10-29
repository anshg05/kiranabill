import { describe, expect, it, vi } from "vitest";
import { parseTranscript, VoiceApiError } from "./voiceApi";

// KB-358c: the `reason` /voice sends next to a 503 reaches the screen as VoiceApiError.reason.

const failWith = async (status: number, body: unknown) => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  return parseTranscript("do kilo chini", { accessToken: "jwt", catalogSlice: [], fetchImpl }).catch((e: unknown) => e as VoiceApiError);
};

describe("VoiceApiError.reason", () => {
  it("a 503 with a reason carries it; without one it is undefined; an unknown word is dropped", async () => {
    expect(await failWith(503, { error: "Parse busy", reason: "daily_limit" })).toMatchObject({ kind: "busy", reason: "daily_limit" });
    expect(await failWith(503, { error: "Parse busy", reason: "minute_limit" })).toMatchObject({ reason: "minute_limit" });
    expect(((await failWith(503, { error: "Parse busy" })) as VoiceApiError).reason).toBeUndefined();
    expect(((await failWith(503, { error: "x", reason: "<script>" })) as VoiceApiError).reason).toBeUndefined();
    // KB-360: a setup problem is a 502 with reason "setup" (an app that has not updated shows today's generic text)
    expect(await failWith(502, { error: "Parse failed", reason: "setup" })).toMatchObject({ kind: "server", status: 502, reason: "setup" });
  });
});
