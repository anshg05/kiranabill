import type { Config, Context } from "@netlify/functions";
import { createGroqTranscriptionProvider } from "../../src/voice/groqTranscriptionProvider.js";
import { createGeminiParseProvider } from "../../src/voice/geminiParseProvider.js";
import { resolveGeminiModel } from "../../src/voice/geminiModel.js";
import { cachedShop, lookupShop, mayRunUnconfirmed, noteUnconfirmed } from "./_shared/auth.js";
import { verifyAccessToken } from "./_shared/jwt.js";
import { checkRateLimit } from "./_shared/rateLimit.js";
import { serverTimingHeaders } from "./_shared/timing.js";
import { ProviderError } from "../../src/voice/deadline.js";
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

/** KB-319 (KI-58, D50): a provider deadline -> 504, the provider's own 429 ->
 * 503 (never 429 - that is the shop's own limit), anything else -> 502. */
function providerFailure(step: "Transcription" | "Parse", err: unknown, startedAt: number, transcript?: string): Response {
  const kind = err instanceof ProviderError ? err.kind : "failed";
  const status = kind === "timeout" ? 504 : kind === "busy" ? 503 : 502;
  // D59 (KI-66): one production line - never the transcript, the provider's body or a URL.
  const provider = err instanceof ProviderError && err.status !== undefined ? err.status : "-";
  // KB-358c: for a 429 the NAME of the quota it hit (never the body) - per-day or per-minute is the whole difference to the shopkeeper.
  const quota = err instanceof ProviderError ? err.quota : undefined;
  // KB-360: Google's own error NAMES (status, reason - e.g. NOT_FOUND, SERVICE_DISABLED); never a message, the body or the key.
  const google = err instanceof ProviderError ? err.google : undefined;
  console.warn(
    `[voice] ${step} failure kind=${kind} status=${status} provider=${provider} ms=${Math.round(performance.now() - startedAt)}${quota ? ` quota=${quota}` : ""}${google?.status ? ` google=${google.status}` : ""}${google?.reason ? ` reason=${google.reason}` : ""}`,
  );
  const error = kind === "timeout" ? `${step} timed out` : kind === "busy" ? `${step} busy` : `${step} failed`;
  const reason =
    kind === "setup" ? (provider === 402 ? "billing" : "setup") : kind !== "busy" ? undefined : quota && /PerDay/i.test(quota) ? "daily_limit" : quota && /PerMinute/i.test(quota) ? "minute_limit" : "busy";
  return new Response(JSON.stringify({ ...(transcript === undefined ? {} : { transcript }), error, ...(reason ? { reason } : {}), detail: (err as Error).message }), { status });
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const enteredAt = performance.now(); // KB-352: where this function's own time goes (Server-Timing)
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !groqApiKey || !geminiApiKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), { status: 500 });
  }

  // KB-353 (D94): the token is verified HERE (no network). Which shop the caller belongs to is remembered per user; on a miss the
  // question is asked while the audio is read and Groq runs, and the shop's rate-limit counter is only touched AFTER the caller is a
  // confirmed member - otherwise any signed-in account could burn another shop's quota.
  const authStart = performance.now();
  const authHeader = req.headers.get("authorization");
  const caller = await verifyAccessToken(authHeader, supabaseUrl);
  const authMs = performance.now() - authStart;
  if (!caller || !authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let shopId = cachedShop(caller.userId);
  const memberStart = performance.now();
  const memberPromise = shopId === null ? lookupShop(authHeader, supabaseUrl, supabaseAnonKey, caller.userId) : null;
  let memberMs = 0;
  let limitMs = 0;
  let confirmation: Promise<Response | null> | null = null;
  /** null = a confirmed member within the shop's quota; otherwise the response to send. Runs once. */
  const confirm = (): Promise<Response | null> =>
    (confirmation ??= (async () => {
      if (memberPromise) {
        const found = await memberPromise;
        memberMs = performance.now() - memberStart;
        if (!found) {
          noteUnconfirmed(caller.userId);
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        shopId = found;
      }
      const limitStart = performance.now();
      const allowed = await checkRateLimit(shopId!);
      limitMs = performance.now() - limitStart;
      return allowed ? null : new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 });
    })());
  /** A rejection is only shown to a confirmed member: anyone else gets the 401 / 429, never a hint about the request. */
  const reject = async (res: Response): Promise<Response> => (await confirm()) ?? res;

  if (shopId !== null) {
    const denied = await confirm();
    if (denied) return denied;
  }

  let form: FormData;
  const formStart = performance.now();
  try {
    form = await req.formData();
  } catch {
    return reject(new Response(JSON.stringify({ error: "Malformed multipart body" }), { status: 400 }));
  }

  const formMs = performance.now() - formStart;
  const audio = form.get("audio");
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    return reject(badRequest("Expected multipart fields 'audio' (binary) and 'meta' (JSON)"));
  }

  let meta: VoiceRequestMeta;
  try {
    meta = JSON.parse(metaRaw) as VoiceRequestMeta;
  } catch {
    return reject(new Response(JSON.stringify({ error: "'meta' field is not valid JSON" }), { status: 400 }));
  }

  // KB-302 (Q1): a request is EITHER audio (transcribe, optionally parse) OR
  // a transcript (parse only). The slice is validated before any provider is
  // called, so a bad request never costs a Groq or Gemini call.
  const textOnly = meta.transcript !== undefined;
  if (textOnly && audio !== null) return reject(badRequest("Send either 'audio' or 'meta.transcript', not both"));
  if (!textOnly && !(audio instanceof Blob)) {
    return reject(badRequest("Expected multipart fields 'audio' (binary) and 'meta' (JSON)"));
  }
  let slice: SliceEntry[] | null = null;
  if (textOnly || meta.parse) {
    if (meta.catalogSlice === undefined) return reject(badRequest("'parse' requires 'catalogSlice' in meta"));
    slice = sanitizeSlice(meta.catalogSlice);
    if (!slice) return reject(badRequest(`'catalogSlice' must be at most ${SLICE_MAX_ENTRIES} entries with valid, short fields`));
  }

  // KB-317 diagnosis: under `netlify dev` only, log each provider attempt
  // (status, ms) so a slow or failed order can be explained afterwards.
  const dev = process.env.NETLIFY_DEV === "true";
  // KB-360: the model is the GEMINI_MODEL variable (an exact name, never an alias); a value that is refused is said once and the default is used.
  const { model, ignored } = resolveGeminiModel(process.env.GEMINI_MODEL);
  if (ignored) console.warn("[voice] GEMINI_MODEL ignored: not an exact model name (an alias or a malformed value); using the default");
  const gemini = createGeminiParseProvider(
    geminiApiKey,
    dev ? (a) => console.info(`[voice-dev] gemini attempt ${a.attempt}: ${a.status} in ${a.ms} ms`) : undefined,
    { model },
  );
  // The provider reads only id / displayName / unit / suggestedPricePaise.
  const catalogSlice = (slice ?? []) as CatalogEntry[];

  if (textOnly) {
    const denied = await confirm(); // Gemini never runs for an unconfirmed caller
    if (denied) return denied;
    const transcript = typeof meta.transcript === "string" ? meta.transcript.trim() : "";
    if (!transcript || transcript.length > TRANSCRIPT_MAX_CHARS) {
      return badRequest(`'transcript' must be 1-${TRANSCRIPT_MAX_CHARS} characters`);
    }
    const start = performance.now();
    try {
      const parsed = await gemini.parse(transcript, { catalogSlice });
      // KB-360: one line per call - which model, how long, what it cost in tokens (numbers and the model's name only).
      console.info(
        `[voice] parse ok model=${model} ms=${Math.round(performance.now() - start)} in=${parsed.usage.promptTokens} out=${parsed.usage.completionTokens} thoughts=${Math.max(0, parsed.usage.totalTokens - parsed.usage.promptTokens - parsed.usage.completionTokens)}`,
      );
      return new Response(
        JSON.stringify({ transcript, items: parsed.items, usage: parsed.usage, latencyMs: performance.now() - start }),
        { status: 200, headers: serverTimingHeaders({ auth: authMs, member: memberMs, limit: limitMs, form: formMs }, enteredAt, performance.now(), process.env) },
      );
    } catch (err) {
      return providerFailure("Parse", err, start, transcript);
    }
  }
  const audioBlob = audio as Blob;

  const start = performance.now();
  const groq = createGroqTranscriptionProvider(groqApiKey);

  const transcribe = () => groq.transcribe(audioBlob, { language: meta.language, vocabulary: meta.vocabulary });
  // On a miss Groq starts now, while membership is still being asked (at most a few times a minute per user who turns out to be
  // no member). It cannot reject: a failure is held until the caller is confirmed, then reported as usual.
  const early =
    shopId === null && mayRunUnconfirmed(caller.userId)
      ? transcribe().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
      : null;
  const denied = await confirm();
  if (denied) return denied; // a non-member or an over-quota shop: the transcript is dropped

  let transcribeResult;
  try {
    if (early) {
      const settled = await early;
      if ("error" in settled) throw settled.error;
      transcribeResult = settled.value;
    } else {
      transcribeResult = await transcribe();
    }
    if (dev) console.info(`[voice-dev] groq: ok in ${Math.round(transcribeResult.latencyMs)} ms (one attempt, no retry, 8 s deadline)`);
  } catch (err) {
    if (dev) console.info(`[voice-dev] groq: failed after ${Math.round(performance.now() - start)} ms - ${(err as Error).message.slice(0, 120)}`);
    return providerFailure("Transcription", err, start);
  }

  if (!meta.parse) {
    const latencyMs = performance.now() - start;
    return new Response(JSON.stringify({ transcript: transcribeResult.text, latencyMs }), {
      status: 200,
      headers: serverTimingHeaders({ auth: authMs, member: memberMs, limit: limitMs, form: formMs, groq: transcribeResult.latencyMs }, enteredAt, performance.now(), process.env, transcribeResult.region),
    });
  }

  let parseResult;
  try {
    parseResult = await gemini.parse(transcribeResult.text, { catalogSlice });
  } catch (err) {
    return providerFailure("Parse", err, start, transcribeResult.text);
  }

  const latencyMs = performance.now() - start;
  return new Response(
    JSON.stringify({
      transcript: transcribeResult.text,
      items: parseResult.items,
      usage: parseResult.usage,
      latencyMs,
    }),
    { status: 200, headers: serverTimingHeaders({ auth: authMs, member: memberMs, limit: limitMs, form: formMs, groq: transcribeResult.latencyMs }, enteredAt, performance.now(), process.env, transcribeResult.region) },
  );
};

export const config: Config = {
  path: "/voice",
};
