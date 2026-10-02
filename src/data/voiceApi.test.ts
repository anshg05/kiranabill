import { afterEach, describe, it, expect, vi } from "vitest";
import { PARSE_TIMEOUT_MS, parseTranscript, TRANSCRIBE_TIMEOUT_MS, transcribeAudio, VoiceApiError } from "./voiceApi";

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
    [503, "busy"], // KB-319: Groq / Gemini over quota
    [504, "timeout"], // KB-319: a provider deadline on the server
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

describe("parseTranscript (Layer 1 miss, text only)", () => {
  const chini = { id: "p-chini", displayName: "Chini", sourceCategory: "SUGAR", guardCategory: "sweet" as const, unit: "kg", suggestedPricePaise: 5200, aliases: ["chini", "cheeni"], isActive: true };

  it("sends the transcript and only the four slice fields - no audio", async () => {
    const fetchImpl = respond(200, { transcript: "do kilo chini", items: [{ spokenName: "chini" }] });
    const items = await parseTranscript("do kilo chini", { accessToken: "jwt", catalogSlice: [chini], fetchImpl });
    expect(items).toEqual([{ spokenName: "chini" }]);
    const form = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as FormData;
    expect(form.get("audio")).toBeNull();
    expect(JSON.parse(form.get("meta") as string)).toEqual({
      transcript: "do kilo chini",
      catalogSlice: [{ id: "p-chini", displayName: "Chini", unit: "kg", suggestedPricePaise: 5200 }],
    });
  });

  it("a response without items -> 'server'; 429 -> 'rate_limited'", async () => {
    expect((await errorOf(parseTranscript("x", { accessToken: "jwt", catalogSlice: [], fetchImpl: respond(200, {}) }))).kind).toBe("server");
    expect((await errorOf(parseTranscript("x", { accessToken: "jwt", catalogSlice: [], fetchImpl: respond(429, {}) }))).kind).toBe("rate_limited");
  });
});

// KB-319 (KI-58, D50): a client deadline on every /voice call. The fake fetch
// never answers and ignores its signal - the deadline must not depend on the abort.
describe("KB-319: client timeouts", () => {
  afterEach(() => vi.useRealTimers());

  function hanging() {
    const calls: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      calls.push(init.signal!);
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("transcribe: 'timeout' at 12 s, the request aborted", async () => {
    vi.useFakeTimers();
    const { fetchImpl, calls } = hanging();
    const result = errorOf(transcribeAudio(audio, { accessToken: "jwt", fetchImpl }));
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS - 1);
    expect(calls[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).kind).toBe("timeout");
    expect(calls[0]!.aborted).toBe(true);
    expect(TRANSCRIBE_TIMEOUT_MS).toBe(12_000);
  });

  it("parse: 'timeout' at 8 s, the request aborted", async () => {
    vi.useFakeTimers();
    const { fetchImpl, calls } = hanging();
    const result = errorOf(parseTranscript("x", { accessToken: "jwt", catalogSlice: [], fetchImpl }));
    await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS);
    expect((await result).kind).toBe("timeout");
    expect(calls[0]!.aborted).toBe(true);
    expect(PARSE_TIMEOUT_MS).toBe(8_000);
  });

  it("a body that stalls after the headers also times out", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) }) as unknown as typeof fetch;
    const result = errorOf(parseTranscript("x", { accessToken: "jwt", catalogSlice: [], fetchImpl }));
    await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS);
    expect((await result).kind).toBe("timeout");
  });

  it("an answer inside the deadline is returned unchanged", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      () => new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify({ items: [] }), { status: 200 })), 3_500)),
    ) as unknown as typeof fetch;
    const result = parseTranscript("x", { accessToken: "jwt", catalogSlice: [], fetchImpl });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(await result).toEqual([]);
  });
});
