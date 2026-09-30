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

/**
 * KB-317 commit 5 (owner): Whisper hallucinates words on silence ("झाल",
 * "कर दो") and they became junk lines. Measured on all 47 saved recordings
 * (30 Sep 2026): every speech recording's no_speech_prob <= 0.3022, every
 * silent tap >= 0.6382 - avg_logprob does not separate them, and Whisper's
 * default rule (> 0.6 AND logprob < -1) caught none. The rule is on the WHOLE
 * recording (owner): silence only if EVERY segment is >= 0.5; if any segment
 * is speech, all the text is kept - dropping one segment could silently
 * remove a real item in a noisy shop. A junk tail is left to the
 * no-information line guard (data/voiceBilling.ts). Quiet-room measurement:
 * re-measure with counter noise at the pilot (NI-33).
 */
const NO_SPEECH_THRESHOLD = 0.5;

function isSilence(segments: { no_speech_prob: number }[] | undefined): boolean {
  return segments !== undefined && segments.length > 0 && segments.every((s) => s.no_speech_prob >= NO_SPEECH_THRESHOLD);
}

/** `model` exists for the KB-317 eval's large-v3 vs turbo comparison
 * (eval/real-audio.ts); the app always uses the default (04 section 2). */
export function createGroqTranscriptionProvider(apiKey: string, model: string = GROQ_MODEL): TranscriptionProvider {
  return {
    name: `groq-${model}`,
    async transcribe(audio, opts) {
      const form = new FormData();
      form.set("file", audio, audioFilename(audio));
      form.set("model", model);
      // KB-317 commit 5: per-segment no_speech_prob, for the silence rule below.
      form.set("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
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

      const data = (await response.json()) as { text: string; segments?: { no_speech_prob: number }[] };
      // verbose_json's text starts with a space; trimmed so /voice returns what it always did.
      return { text: isSilence(data.segments) ? "" : data.text.trim(), latencyMs };
    },
  };
}
