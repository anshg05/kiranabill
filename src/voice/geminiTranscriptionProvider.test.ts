import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiTranscriptionProvider, GEMINI_TRANSCRIBE_MODEL, TRANSCRIBE_VOCABULARY_MAX } from "./geminiTranscriptionProvider";
import { ProviderError } from "./deadline";

// KB-370 (V1): gemini-3.5-transcribe as the "ear" - a bake-off candidate, NOT wired into /voice.

const ok = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 640, candidatesTokenCount: 30, totalTokenCount: 670 } }),
});
const audio = () => new Blob([new Uint8Array([1, 2, 3, 250])], { type: "audio/webm;codecs=opus" });
const sent = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
};

describe("geminiTranscriptionProvider (KB-370 candidate B)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the audio inline to the pinned model, the key in a header and never in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(" दो किलो चीनी "));
    vi.stubGlobal("fetch", fetchMock);
    const r = await createGeminiTranscriptionProvider("secret-key").transcribe(audio(), { language: "hi" });
    const { url, headers, body } = sent(fetchMock);
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIBE_MODEL}:generateContent`);
    expect(url).not.toContain("secret-key");
    expect(headers["x-goog-api-key"]).toBe("secret-key");
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: "audio/webm", data: btoa(String.fromCharCode(1, 2, 3, 250)) });
    expect(body.generationConfig.audioTranscriptionConfig.languageCodes).toEqual(["hi-IN"]);
    expect(body.generationConfig.audioTranscriptionConfig.customVocabulary).toBeUndefined();
    expect(r.text).toBe("दो किलो चीनी");
    expect(r.usage).toEqual({ promptTokens: 640, completionTokens: 30, totalTokens: 670 });
  });

  it("KB-370 fix: reads the words from audioTranscription - Google's own REST example, copied unchanged (no text part, no usageMetadata)", async () => {
    // https://ai.google.dev/gemini-api/docs/generate-content/transcribe ("Parsing transcription output", REST), fetched 1 Nov 2026
    const googleExample = {
      candidates: [
        {
          content: {
            parts: [
              {
                audioTranscription: {
                  speakerLabel: "spk_1",
                  words: [
                    { word: "Hello", startOffset: "0.100s", endOffset: "0.400s" },
                    { word: "world", startOffset: "0.500s", endOffset: "0.800s" },
                  ],
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => googleExample }));
    const r = await createGeminiTranscriptionProvider("k").transcribe(audio(), { language: "hi" });
    expect(r.text).toBe("Hello world");
    expect(r.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("KB-370 fix 2: reads audioTranscription.text - the shape the LIVE model returned to the diagnostic call (1 Nov 2026), not the docs' words[]", () => {
    // field names and counts exactly as the diagnostic printed them (the text value here is a sample, not the owner's recording)
    const live = {
      candidates: [{ content: { parts: [{ audioTranscription: { text: "दो किलो चीनी छप्पन रुपए किलो" } }], role: "model" }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 162, candidatesTokenCount: 15, totalTokenCount: 177, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 161 }, { modality: "TEXT", tokenCount: 1 }], serviceTier: "standard" },
      modelVersion: "gemini-3.5-transcribe",
      responseId: "x",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => live }));
    return createGeminiTranscriptionProvider("k").transcribe(audio(), { language: "hi" }).then((r) => {
      expect(r.text).toBe("दो किलो चीनी छप्पन रुपए किलो");
      expect(r.usage).toEqual({ promptTokens: 162, completionTokens: 15, totalTokens: 177 });
    });
  });

  it("KB-370 fix: a billed thinking token counts as output (totalTokenCount - promptTokenCount), not only candidatesTokenCount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "दो किलो" }] } }], usageMetadata: { promptTokenCount: 640, candidatesTokenCount: 30, thoughtsTokenCount: 200, totalTokenCount: 870 } }),
    }));
    expect((await createGeminiTranscriptionProvider("k").transcribe(audio(), {})).usage).toEqual({ promptTokens: 640, completionTokens: 230, totalTokens: 870 });
  });

  it("sends the vocabulary, capped at the documented best size", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok("x"));
    vi.stubGlobal("fetch", fetchMock);
    const names = Array.from({ length: 150 }, (_, i) => `product ${i}`);
    await createGeminiTranscriptionProvider("k").transcribe(audio(), { language: "hi", vocabulary: names });
    expect(sent(fetchMock).body.generationConfig.audioTranscriptionConfig.customVocabulary).toEqual(names.slice(0, TRANSCRIBE_VOCABULARY_MAX));
  });

  it("refuses a '-latest' alias - a pinned model only", () => {
    expect(() => createGeminiTranscriptionProvider("k", { model: "gemini-transcribe-latest" })).toThrow(/pinned/);
  });

  it("a 429 is busy, a 400 is a failure - both ProviderErrors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "{}" }));
    await expect(createGeminiTranscriptionProvider("k").transcribe(audio(), {})).rejects.toMatchObject({ kind: "busy", status: 429 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "{}" }));
    await expect(createGeminiTranscriptionProvider("k").transcribe(audio(), {})).rejects.toMatchObject({ kind: "failed", status: 400 });
  });

  it("a call past its deadline is a timeout, never a late answer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const p = createGeminiTranscriptionProvider("k", { timeoutMs: 1_000 }).transcribe(audio(), {});
    const assertion = expect(p).rejects.toBeInstanceOf(ProviderError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    await expect(p).rejects.toMatchObject({ kind: "timeout" });
  });
});
