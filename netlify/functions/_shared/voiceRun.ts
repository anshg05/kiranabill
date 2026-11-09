import { ProviderError } from "../../../src/voice/deadline.js";

// KB-384a step 3 (owner, 9 Nov 2026; D107): the background worker's job for ONE recording. The claim (a database function, one
// statement) decides who runs it - a done, running or other shop's recording claims nothing, so a retry or a double tap never makes a
// second Gemini call. Every failure ends as a FAILED row (the phone shows Retry / Add by hand), and the job never throws: Netlify
// retries a background function that throws, and that would be a second Gemini call.

/** V3's model (D104). GEMINI_AUDIO_MODEL may name another pinned model. */
export const V3_AUDIO_MODEL = "gemini-3.8-flash";
/** Under the 70 s after which a stuck run may be claimed again (claim_voice_recording) - A63, 3 min 22 s, took 26 s. */
export const V3_GEMINI_TIMEOUT_MS = 60_000;

export interface ClaimedRecording {
  shopId: string;
  path: string;
  mime: string;
  attempts: number;
}

export interface VoiceAnswer {
  transcript: string;
  items: unknown[];
  usage: unknown;
}

export interface FinishInput {
  recordingId: string;
  attempt: number;
  status: "done" | "failed";
  transcript: string | null;
  items: unknown[] | null;
  usage: unknown;
  error: string | null;
}

export interface VoiceJobDeps {
  claim(recordingId: string): Promise<ClaimedRecording | null>;
  /** the shop's rate limit (touched only after the claim proved the caller a member) */
  allowed(shopId: string): Promise<boolean>;
  download(path: string): Promise<Blob>;
  parse(audio: Blob): Promise<VoiceAnswer>;
  /** false = refused (not the running attempt any more) */
  finish(input: FinishInput): Promise<boolean>;
  log(line: string): void;
}

export type VoiceJobOutcome = "done" | "failed" | "skipped";

const failure = (err: unknown): string => (err instanceof ProviderError && (err.kind === "timeout" || err.kind === "busy") ? err.kind : "failed");

export async function runVoiceJob(recordingId: string, deps: VoiceJobDeps): Promise<VoiceJobOutcome> {
  const started = performance.now();
  // D59: one line, never the transcript, a provider body or a URL.
  const say = (what: string) => deps.log(`[voice-run] ${what} ms=${Math.round(performance.now() - started)}`);
  let row: ClaimedRecording | null;
  try {
    row = await deps.claim(recordingId);
  } catch {
    say("claim error");
    return "skipped";
  }
  if (!row) {
    say("nothing to claim");
    return "skipped";
  }
  const claimed = row;
  const fail = async (error: string): Promise<VoiceJobOutcome> => {
    try {
      await deps.finish({ recordingId, attempt: claimed.attempts, status: "failed", transcript: null, items: null, usage: null, error });
    } catch {
      say("finish error");
    }
    say(`failed ${error}`);
    return "failed";
  };

  try {
    if (!(await deps.allowed(claimed.shopId))) return fail("rate_limited");
  } catch {
    return fail("rate_limit_error");
  }
  let audio: Blob;
  try {
    const raw = await deps.download(claimed.path);
    audio = new Blob([raw], { type: claimed.mime });
  } catch {
    return fail("download");
  }
  let answer: VoiceAnswer;
  try {
    answer = await deps.parse(audio);
  } catch (err) {
    return fail(failure(err));
  }
  try {
    const ok = await deps.finish({ recordingId, attempt: claimed.attempts, status: "done", transcript: answer.transcript, items: answer.items, usage: answer.usage, error: null });
    say(ok ? `done items=${answer.items.length}` : "finish refused (claimed again meanwhile)");
    return ok ? "done" : "skipped";
  } catch {
    say("finish error");
    return "skipped";
  }
}
