// KB-302: the client side of POST /voice (netlify/functions/voice.mts,
// docs/02-ARCHITECTURE.md section 5). Every failure comes back as a typed
// VoiceApiError - the billing screen turns each kind into an inline message;
// nothing here ever throws anything else at the UI.

export type VoiceErrorKind =
  | "unauthorized" // 401: no live session (offline session, expired token)
  | "rate_limited" // 429: the per-shop quota
  | "bad_request" // 400: our request was malformed
  | "server" // 5xx: transcription/parse failed upstream, or the function is misconfigured
  | "network"; // fetch itself failed (offline, DNS, aborted)

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
  if (status >= 400 && status < 500) return "bad_request";
  return "server";
}

async function postForm(form: FormData, opts: VoiceApiOptions): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(opts.endpoint ?? "/voice", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      body: form,
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
}

export interface TranscribeOptions extends VoiceApiOptions {
  /** Whisper language hint; undefined = auto-detect (docs/07-DECISIONS.md D42 pending). */
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
  const body = (await postForm(form, opts)) as { transcript?: unknown } | null;
  if (typeof body?.transcript !== "string") {
    throw new VoiceApiError("server", "No transcript in the response");
  }
  return body.transcript;
}
