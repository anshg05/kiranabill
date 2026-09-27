import type { Config, Context } from "@netlify/functions";
import { createGroqTranscriptionProvider } from "../../src/voice/groqTranscriptionProvider.js";
import { createGeminiParseProvider } from "../../src/voice/geminiParseProvider.js";
import { resolveAuthedRequest } from "./_shared/auth.js";
import { checkRateLimit } from "./_shared/rateLimit.js";
import type { CatalogEntry } from "../../src/domain/catalog.js";

// docs/02-ARCHITECTURE.md section 5's "one HTTP round trip, not two": this
// function always transcribes (Groq) and only parses (Gemini) if the
// client explicitly asks - the client already ran Layer 1 itself and
// found a miss before requesting this. Layer 1 (domain/grammar.ts) and
// the catalog-slice ranking both stay client-side; this function is a
// thin two-provider gateway, nothing more.
interface VoiceRequestMeta {
  language?: string;
  vocabulary?: string[];
  parse?: boolean;
  catalogSlice?: unknown;
  /** KB-302 (Q1): text-only parse on a Layer 1 miss - no audio in the request. */
  transcript?: unknown;
}

// KB-302 (owner, Q1) guardrails - /voice must never become a free Gemini
// proxy. The transcript cap matches the vocabulary cap (04 section 2); the
// slice cap is 04 section 4's "top 30". Text-only calls pass the same auth
// and per-shop rate limit as audio calls (both run before the body is read).
const TRANSCRIPT_MAX_CHARS = 600;
const SLICE_MAX_ENTRIES = 30;
const MAX_ID_CHARS = 64;
const MAX_NAME_CHARS = 80;
const MAX_UNIT_CHARS = 16;

type SliceEntry = Pick<CatalogEntry, "id" | "displayName"> & Partial<Pick<CatalogEntry, "unit" | "suggestedPricePaise">>;

const isShortString = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Rebuilds the slice from ONLY the four fields the Gemini prompt uses
 * (geminiParseProvider.ts), each capped; null = reject the request. */
function sanitizeSlice(raw: unknown): SliceEntry[] | null {
  if (!Array.isArray(raw) || raw.length > SLICE_MAX_ENTRIES) return null;
  const out: SliceEntry[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) return null;
    const { id, displayName, unit, suggestedPricePaise } = e as Record<string, unknown>;
    if (!isShortString(id, MAX_ID_CHARS) || !isShortString(displayName, MAX_NAME_CHARS)) return null;
    const entry: SliceEntry = { id, displayName };
    if (unit !== undefined) {
      if (typeof unit !== "string" || unit.length > MAX_UNIT_CHARS) return null;
      entry.unit = unit;
    }
    if (suggestedPricePaise !== undefined) {
      if (!Number.isInteger(suggestedPricePaise) || (suggestedPricePaise as number) < 0 || (suggestedPricePaise as number) > 1e9) return null;
      entry.suggestedPricePaise = suggestedPricePaise as number;
    }
    out.push(entry);
  }
  return out;
}

const badRequest = (error: string) => new Response(JSON.stringify({ error }), { status: 400 });

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !groqApiKey || !geminiApiKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), { status: 500 });
  }

  const authed = await resolveAuthedRequest(req, supabaseUrl, supabaseAnonKey);
  if (!authed) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const allowed = await checkRateLimit(authed.shopId);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Malformed multipart body" }), { status: 400 });
  }

  const audio = form.get("audio");
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    return badRequest("Expected multipart fields 'audio' (binary) and 'meta' (JSON)");
  }

  let meta: VoiceRequestMeta;
  try {
    meta = JSON.parse(metaRaw) as VoiceRequestMeta;
  } catch {
    return new Response(JSON.stringify({ error: "'meta' field is not valid JSON" }), { status: 400 });
  }

  // KB-302 (Q1): a request is EITHER audio (transcribe, optionally parse) OR
  // a transcript (parse only). The slice is validated before any provider is
  // called, so a bad request never costs a Groq or Gemini call.
  const textOnly = meta.transcript !== undefined;
  if (textOnly && audio !== null) return badRequest("Send either 'audio' or 'meta.transcript', not both");
  if (!textOnly && !(audio instanceof Blob)) {
    return badRequest("Expected multipart fields 'audio' (binary) and 'meta' (JSON)");
  }
  let slice: SliceEntry[] | null = null;
  if (textOnly || meta.parse) {
    if (meta.catalogSlice === undefined) return badRequest("'parse' requires 'catalogSlice' in meta");
    slice = sanitizeSlice(meta.catalogSlice);
    if (!slice) return badRequest(`'catalogSlice' must be at most ${SLICE_MAX_ENTRIES} entries with valid, short fields`);
  }

  // The provider reads only id / displayName / unit / suggestedPricePaise.
  const gemini = createGeminiParseProvider(geminiApiKey);
  const catalogSlice = (slice ?? []) as CatalogEntry[];

  if (textOnly) {
    const transcript = typeof meta.transcript === "string" ? meta.transcript.trim() : "";
    if (!transcript || transcript.length > TRANSCRIPT_MAX_CHARS) {
      return badRequest(`'transcript' must be 1-${TRANSCRIPT_MAX_CHARS} characters`);
    }
    const start = performance.now();
    try {
      const parsed = await gemini.parse(transcript, { catalogSlice });
      return new Response(
        JSON.stringify({ transcript, items: parsed.items, usage: parsed.usage, latencyMs: performance.now() - start }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ transcript, error: "Parse failed", detail: (err as Error).message }),
        { status: 502 },
      );
    }
  }
  const audioBlob = audio as Blob;

  const start = performance.now();
  const groq = createGroqTranscriptionProvider(groqApiKey);

  let transcribeResult;
  try {
    transcribeResult = await groq.transcribe(audioBlob, {
      language: meta.language,
      vocabulary: meta.vocabulary,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Transcription failed", detail: (err as Error).message }),
      { status: 502 },
    );
  }

  if (!meta.parse) {
    const latencyMs = performance.now() - start;
    return new Response(JSON.stringify({ transcript: transcribeResult.text, latencyMs }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let parseResult;
  try {
    parseResult = await gemini.parse(transcribeResult.text, { catalogSlice });
  } catch (err) {
    return new Response(
      JSON.stringify({
        transcript: transcribeResult.text,
        error: "Parse failed",
        detail: (err as Error).message,
      }),
      { status: 502 },
    );
  }

  const latencyMs = performance.now() - start;
  return new Response(
    JSON.stringify({
      transcript: transcribeResult.text,
      items: parseResult.items,
      usage: parseResult.usage,
      latencyMs,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const config: Config = {
  path: "/voice",
};
