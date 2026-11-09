import { afterEach, describe, expect, it, vi } from "vitest";

// KB-384 time-limit spike (owner, 9 Nov 2026) - TEMPORARY, deleted before the release. It must never be an open Gemini proxy on a public
// draft URL: without KB384_SPIKE_KEY set, or with the wrong key, it does not exist (404) - and it never runs in production code paths.

const parseAudio = vi.fn(async () => ({ transcript: "2 किलो चीनी", items: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, latencyMs: 1234, thoughts: null }));
vi.mock("../../src/voice/geminiAudioParseProvider", () => ({ createGeminiAudioParseProvider: vi.fn(() => ({ parseAudio })) }));

import spike from "./voice-spike.mts";

afterEach(() => {
  delete process.env.KB384_SPIKE_KEY;
  delete process.env.GEMINI_API_KEY;
  parseAudio.mockClear();
});
const call = (key: string | null, url = "https://x/voice-spike", init: RequestInit = { method: "POST", body: new Uint8Array([1, 2, 3]) }) =>
  spike(new Request(url, { ...init, headers: key === null ? {} : { "x-spike-key": key } }));

describe("the KB-384 spike is gated", () => {
  it("404 when KB384_SPIKE_KEY is not set, whatever the request - and no Gemini call", async () => {
    expect((await call("anything")).status).toBe(404);
    expect(parseAudio).not.toHaveBeenCalled();
  });

  it("404 with no key or the wrong key", async () => {
    process.env.KB384_SPIKE_KEY = "right-key-123";
    expect((await call(null)).status).toBe(404);
    expect((await call("wrong-key-123")).status).toBe(404);
    expect(parseAudio).not.toHaveBeenCalled();
  });

  it("with the right key: ?sleep=N measures the platform's limit; a POSTed recording is timed through gemini-3.8-flash", async () => {
    process.env.KB384_SPIKE_KEY = "right-key-123";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const slept = await (await call("right-key-123", "https://x/voice-spike?sleep=0", { method: "GET" })).json();
    expect(slept).toMatchObject({ slept: 0 });
    const timed = await (await call("right-key-123")).json();
    expect(timed).toMatchObject({ bytes: 3, geminiMs: 1234, transcript: "2 किलो चीनी" });
    expect(parseAudio).toHaveBeenCalledOnce();
  });
});
