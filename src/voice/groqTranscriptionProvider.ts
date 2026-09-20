import type { TranscriptionProvider } from "@/voice/transcriptionProvider";

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

// Whisper's prompt window is ~224 tokens; 04-VOICE-PIPELINE.md section 2
// caps the phrase-biasing vocabulary at 600 characters for this reason.
const VOCABULARY_PROMPT_MAX_CHARS = 600;

function buildVocabularyPrompt(vocabulary: string[] | undefined): string | undefined {
  if (!vocabulary || vocabulary.length === 0) return undefined;
  const joined = vocabulary.join(", ");
  return joined.length > VOCABULARY_PROMPT_MAX_CHARS
    ? joined.slice(0, VOCABULARY_PROMPT_MAX_CHARS)
    : joined;
}

export function createGroqTranscriptionProvider(apiKey: string): TranscriptionProvider {
  return {
    name: "groq-whisper-large-v3",
    async transcribe(audio, opts) {
      const form = new FormData();
      form.set("file", audio, "audio");
      form.set("model", GROQ_MODEL);
      if (opts.language) form.set("language", opts.language);
      const prompt = buildVocabularyPrompt(opts.vocabulary);
      if (prompt) form.set("prompt", prompt);

      const start = performance.now();
      const response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      const latencyMs = performance.now() - start;

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Groq transcription failed: ${response.status} ${body}`);
      }

      const data = (await response.json()) as { text: string };
      return { text: data.text, latencyMs };
    },
  };
}
