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
  parse: boolean;
  catalogSlice?: CatalogEntry[];
}

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
  if (!(audio instanceof Blob) || typeof metaRaw !== "string") {
    return new Response(
      JSON.stringify({ error: "Expected multipart fields 'audio' (binary) and 'meta' (JSON)" }),
      { status: 400 },
    );
  }

  let meta: VoiceRequestMeta;
  try {
    meta = JSON.parse(metaRaw) as VoiceRequestMeta;
  } catch {
    return new Response(JSON.stringify({ error: "'meta' field is not valid JSON" }), { status: 400 });
  }

  const start = performance.now();
  const groq = createGroqTranscriptionProvider(groqApiKey);

  let transcribeResult;
  try {
    transcribeResult = await groq.transcribe(audio, {
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

  if (!meta.catalogSlice) {
    return new Response(
      JSON.stringify({ error: "'parse: true' requires 'catalogSlice' in meta" }),
      { status: 400 },
    );
  }

  const gemini = createGeminiParseProvider(geminiApiKey);
  let parseResult;
  try {
    parseResult = await gemini.parse(transcribeResult.text, { catalogSlice: meta.catalogSlice });
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
