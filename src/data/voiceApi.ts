import type { CatalogEntry } from "@/domain/catalog";
import type { ParsedItem } from "@/domain/grammar";
import { withDeadline } from "@/voice/deadline";

// KB-302: the client side of POST /voice (netlify/functions/voice.mts,
// docs/02-ARCHITECTURE.md section 5). Every failure comes back as a typed
// VoiceApiError - the billing screen turns each kind into an inline message;
// nothing here ever throws anything else at the UI.

export type VoiceErrorKind =
  | "unauthorized" // 401: no live session (offline session, expired token)
  | "rate_limited" // 429: the per-shop quota
  | "bad_request" // 400: our request was malformed
  | "server" // 5xx: transcription/parse failed upstream, or the function is misconfigured
  | "busy" // 503 (KB-319): Groq / Gemini over their own quota
  | "timeout" // 504, or this client's own deadline (KB-319)
  | "network"; // fetch itself failed (offline, DNS)

/** KB-319 (owner, D50): the client's deadline per /voice call - a few seconds
 * over the server's provider deadline (Groq 8 s, Gemini 6 s), so the server's
 * clean error normally arrives first; this is the backstop for the network,
 * a cold function, or auth. */
export const TRANSCRIBE_TIMEOUT_MS = 12_000;
export const PARSE_TIMEOUT_MS = 8_000;

export class VoiceApiError extends Error {
  constructor(
    readonly kind: VoiceErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VoiceApiError";
  }
}

export interface VoiceApiOptions {
  accessToken: string;
  /** "/voice" in the browser (same origin); an absolute URL from scripts. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

function kindFor(status: number): VoiceErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 503) return "busy";
  if (status === 504) return "timeout";
  if (status >= 400 && status < 500) return "bad_request";
  return "server";
}

/** One /voice call with a deadline (KB-319): past `timeoutMs` it rejects as
 * "timeout" and aborts the request - a late answer is never used. */
function postForm(form: FormData, opts: VoiceApiOptions, timeoutMs: number): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return withDeadline(
    timeoutMs,
    async (signal) => {
      let response: Response;
      try {
        response = await fetchImpl(opts.endpoint ?? "/voice", {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.accessToken}` },
          body: form,
          signal,
        });
      } catch (err) {
        throw new VoiceApiError("network", err instanceof Error ? err.message : String(err));
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // non-JSON body (e.g. a proxy error page) - the status still decides the kind
      }
      if (!response.ok) {
        const detail = (body as { error?: string } | null)?.error ?? response.statusText;
        throw new VoiceApiError(kindFor(response.status), detail, response.status);
      }
      return body;
    },
    () => new VoiceApiError("timeout", `No answer from /voice in ${timeoutMs / 1000} s`),
  );
}

export interface TranscribeOptions extends VoiceApiOptions {
  /** Whisper language hint; undefined = auto-detect. The app sends "hi" (docs/07-DECISIONS.md D44). */
  language?: string;
  vocabulary?: readonly string[];
}

/** Step 2 of the one-turn flow (16-APP-FLOW.md section 3): audio in, transcript out. */
export async function transcribeAudio(audio: Blob, opts: TranscribeOptions): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "speech");
  form.append(
    "meta",
    JSON.stringify({ parse: false, language: opts.language, vocabulary: opts.vocabulary ?? [] }),
  );
  const body = (await postForm(form, opts, TRANSCRIBE_TIMEOUT_MS)) as { transcript?: unknown } | null;
  if (typeof body?.transcript !== "string") {
    throw new VoiceApiError("server", "No transcript in the response");
  }
  return body.transcript;
}

export interface ParseTranscriptOptions extends VoiceApiOptions {
  /** The shop's slice (domain/catalogIndex.ts buildCatalogSlice), <= 30 entries. */
  catalogSlice: readonly CatalogEntry[];
}

/** Step 4 (Layer 1 miss, owner Q1): the TRANSCRIPT goes back for a parse -
 * never the audio, so Groq is paid once and the parsed text is exactly the
 * text on screen. Only the four fields the server forwards are sent. */
export async function parseTranscript(transcript: string, opts: ParseTranscriptOptions): Promise<ParsedItem[]> {
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      transcript,
      catalogSlice: opts.catalogSlice.map(({ id, displayName, unit, suggestedPricePaise }) => ({ id, displayName, unit, suggestedPricePaise })),
    }),
  );
  const body = (await postForm(form, opts, PARSE_TIMEOUT_MS)) as { items?: unknown } | null;
  if (!Array.isArray(body?.items)) throw new VoiceApiError("server", "No items in the parse response");
  return body.items as ParsedItem[];
}
