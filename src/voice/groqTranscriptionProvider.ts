import type { TranscriptionProvider } from "@/voice/transcriptionProvider";

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

// Whisper's prompt window is ~224 tokens; 04-VOICE-PIPELINE.md section 2
// caps the phrase-biasing vocabulary at 600 characters for this reason.
const VOCABULARY_PROMPT_MAX_CHARS = 600;

// Groq infers audio format from the uploaded FILENAME's extension, not
// just the part's Content-Type - confirmed by a real rejection during
// KB-206's end-to-end verification: a real Blob with a real audio/wav
// type was rejected outright when uploaded under the bare filename
// "audio" (no extension). KB-204's own real-verification script never
// caught this because it built its own request directly against the raw
// Groq endpoint with a hardcoded "audio.wav" filename, rather than
// calling this function - this is what actually running the shipped
// code end-to-end exists to catch. Falls back to "webm" (the most common
// browser MediaRecorder output) when the Blob carries no recognized type.
const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

function audioFilename(audio: Blob): string {
  // KB-302: MediaRecorder types carry codec parameters ("audio/mp4;codecs=
  // mp4a.40.2" on Safari) - look up the bare media type only, or Safari's
  // mp4 audio would upload under the webm fallback.
  const mediaType = audio.type.split(";")[0]!.trim().toLowerCase();
  const extension = MIME_TO_EXTENSION[mediaType] ?? "webm";
  return `audio.${extension}`;
}

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
      form.set("file", audio, audioFilename(audio));
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
