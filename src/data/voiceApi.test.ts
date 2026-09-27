import { describe, it, expect, vi } from "vitest";
import { transcribeAudio, VoiceApiError } from "./voiceApi";

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
}

const audio = new Blob(["x"], { type: "audio/webm;codecs=opus" });

async function errorOf(p: Promise<unknown>): Promise<VoiceApiError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof VoiceApiError) return err;
    throw new Error(`expected a VoiceApiError, got ${String(err)}`);
  }
  throw new Error("expected a rejection");
}

describe("transcribeAudio", () => {
  it("posts the audio and meta with the session's bearer token, returns the transcript", async () => {
    const fetchImpl = respond(200, { transcript: "do kilo chini", latencyMs: 900 });
    const text = await transcribeAudio(audio, { accessToken: "jwt", language: "hi", vocabulary: ["Chini"], fetchImpl });
    expect(text).toBe("do kilo chini");

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/voice");
    expect(init.headers).toEqual({ Authorization: "Bearer jwt" });
    const form = init.body as FormData;
    expect((form.get("audio") as File).type).toBe("audio/webm;codecs=opus");
    expect(JSON.parse(form.get("meta") as string)).toEqual({ parse: false, language: "hi", vocabulary: ["Chini"] });
  });

  it("auto language: no hint is sent", async () => {
    const fetchImpl = respond(200, { transcript: "" });
    await transcribeAudio(audio, { accessToken: "jwt", fetchImpl });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(JSON.parse((init.body as FormData).get("meta") as string)).toEqual({ parse: false, vocabulary: [] });
  });

  it.each([
    [401, "unauthorized"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [500, "server"],
    [502, "server"],
  ] as const)("HTTP %i -> a typed '%s' error, never an untyped throw", async (status, kind) => {
    const err = await errorOf(transcribeAudio(audio, { accessToken: "jwt", fetchImpl: respond(status, { error: "x" }) }));
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
  });

  it("a network failure -> 'network'", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    expect((await errorOf(transcribeAudio(audio, { accessToken: "jwt", fetchImpl }))).kind).toBe("network");
  });

  it("a 200 without a transcript -> 'server'", async () => {
    expect((await errorOf(transcribeAudio(audio, { accessToken: "jwt", fetchImpl: respond(200, {}) }))).kind).toBe("server");
  });

  it("a non-JSON error page still maps by status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    expect((await errorOf(transcribeAudio(audio, { accessToken: "jwt", fetchImpl }))).kind).toBe("server");
  });
});
