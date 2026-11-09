import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// KB-384a step 3: the /voice-run handler - a Netlify BACKGROUND function (the phone gets 202 at once). It acts as the caller: no
// login or a bad recording id never reaches the database or Gemini; the provider is the V3 one (long answer form, D107 item 6).

const { verifyMock, runMock, providerMock, createClientMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  runMock: vi.fn(async (..._a: unknown[]) => "done"),
  providerMock: vi.fn((..._a: unknown[]) => ({ name: "gemini-3.8-flash", parseAudio: vi.fn() })),
  createClientMock: vi.fn((..._a: unknown[]) => ({ rpc: vi.fn(), storage: { from: vi.fn() } })),
}));
vi.mock("./jwt.js", () => ({ verifyAccessToken: verifyMock }));
vi.mock("./rateLimit.js", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("./voiceRun.js", async (orig) => ({ ...(await orig<typeof import("./voiceRun")>()), runVoiceJob: runMock }));
vi.mock("../../../src/voice/geminiAudioParseProvider.js", () => ({ createGeminiAudioParseProvider: providerMock }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import handler, { config } from "../voice-run.mts";
import { EZY_V3_PROMPT } from "../../../src/voice/audioPrompts";

const REC = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f";
const post = (body: unknown, auth: string | null = "Bearer jwt") =>
  handler(new Request("https://x/voice-run", { method: "POST", headers: auth ? { authorization: auth, "content-type": "application/json" } : {}, body: JSON.stringify(body) }), {} as never);

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://x.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon";
  process.env.GEMINI_API_KEY = "gem";
  verifyMock.mockResolvedValue({ userId: "u1" });
});
afterEach(() => {
  vi.clearAllMocks();
  delete process.env.GEMINI_AUDIO_MODEL;
});

describe("/voice-run (KB-384a step 3)", () => {
  it("is a BACKGROUND function at /voice-run", () => {
    expect(config).toMatchObject({ background: true, path: "/voice-run" });
  });

  it("no valid login: nothing runs", async () => {
    verifyMock.mockResolvedValue(null);
    await post({ recordingId: REC });
    await post({ recordingId: REC }, null);
    expect(runMock).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("a recording id that is not a uuid, or a body that is not JSON: nothing runs", async () => {
    await post({ recordingId: "../../etc" });
    await post({});
    await handler(new Request("https://x/voice-run", { method: "POST", headers: { authorization: "Bearer jwt" }, body: "not json" }), {} as never);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("a valid call runs the job once, AS THE CALLER (their token on the database client), with the V3 provider", async () => {
    await post({ recordingId: REC });
    expect(runMock).toHaveBeenCalledOnce();
    expect(runMock.mock.calls[0]![0]).toBe(REC);
    expect(createClientMock).toHaveBeenCalledWith("https://x.supabase.co", "anon", expect.objectContaining({ global: { headers: { Authorization: "Bearer jwt" } } }));
    expect(providerMock).toHaveBeenCalledWith("gem", { model: "gemini-3.8-flash", thinkingConfig: { thinkingLevel: "low" }, systemPrompt: EZY_V3_PROMPT, timeoutMs: 60_000 });
  });

  it("GEMINI_AUDIO_MODEL changes the model (a pinned name)", async () => {
    process.env.GEMINI_AUDIO_MODEL = "gemini-3.9-flash";
    await post({ recordingId: REC });
    expect(providerMock.mock.calls[0]![1]).toMatchObject({ model: "gemini-3.9-flash" });
  });

  it("a missing server key: nothing runs", async () => {
    delete process.env.GEMINI_API_KEY;
    await post({ recordingId: REC });
    expect(runMock).not.toHaveBeenCalled();
  });
});
