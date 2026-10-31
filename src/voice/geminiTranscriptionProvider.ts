import type { TranscriptionProvider } from "@/voice/transcriptionProvider";
import type { TokenUsage } from "@/voice/parseProvider";
import { ProviderError, withDeadline } from "@/voice/deadline";
import { answerOf, failedAnswer, geminiUrl, inlineAudio, pinnedModel } from "@/voice/geminiAudio";

// KB-370 (V1 bake-off, candidate B): gemini-3.5-transcribe as the "ear" in front of the SAME Layer 1 + Layer 2 + checks.
// NOT wired into /voice. Request shape: https://ai.google.dev/gemini-api/docs/generate-content/transcribe (read 31 Oct 2026):
// generationConfig.audioTranscriptionConfig { languageCodes, customVocabulary (<= 1,000 terms, best at ~100) }; Hindi is hi-IN.

export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
export const TRANSCRIBE_VOCABULARY_MAX = 100;
/** The bake-off's deadline (a long order is up to 90 s of audio); V3 sets the production one from the measured seconds. */
export const TRANSCRIBE_BAKEOFF_TIMEOUT_MS = 30_000;

export interface GeminiTranscriptionProvider extends TranscriptionProvider {
  transcribe(audio: Blob, opts: { vocabulary?: string[]; language?: string }): Promise<{ text: string; latencyMs: number; usage: TokenUsage }>;
}

export function createGeminiTranscriptionProvider(apiKey: string, options: { model?: string; timeoutMs?: number } = {}): GeminiTranscriptionProvider {
  const model = pinnedModel(options.model ?? GEMINI_TRANSCRIBE_MODEL);
  const timeoutMs = options.timeoutMs ?? TRANSCRIBE_BAKEOFF_TIMEOUT_MS;
  return {
    name: model,
    async transcribe(audio, opts) {
      const vocabulary = (opts.vocabulary ?? []).slice(0, TRANSCRIBE_VOCABULARY_MAX);
      const body = {
        contents: [{ role: "user", parts: [{ inlineData: await inlineAudio(audio) }] }],
        generationConfig: {
          audioTranscriptionConfig: {
            ...(opts.language ? { languageCodes: [opts.language === "hi" ? "hi-IN" : opts.language] } : {}),
            ...(vocabulary.length ? { customVocabulary: vocabulary } : {}),
          },
        },
      };
      const start = performance.now();
      return withDeadline(
        timeoutMs,
        async (signal) => {
          // D59: the key in a header, never in the URL an error or log may carry.
          const response = await fetch(geminiUrl(model), { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal });
          if (!response.ok) throw await failedAnswer("Gemini transcription", response);
          const { text, usage } = await answerOf(response);
          return { text: text.trim(), latencyMs: performance.now() - start, usage };
        },
        () => new ProviderError("timeout", `Gemini transcription timed out after ${timeoutMs} ms`),
      );
    },
  };
}
