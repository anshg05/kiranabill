import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedItem } from "@/domain/grammar";

// KB-384a step 4 (owner, 9 Nov 2026; D107): the phone's side of the async voice path - one path for every order, short or long.
//   1. upload the recording to the PRIVATE bucket at {shop_id}/{recording_id} (never overwritten)
//   2. add its voice_recordings row
//   3. start /voice-run (a Netlify background function: 202 at once)
//   4. watch the row every 1.5 s until done or failed - or give up after 75 s
// The recording_id is made ONCE per recording: Retry calls this again with the same id and the same audio. A file or row that already
// exists is fine, and a recording that is already done answers at once with no second Gemini call (the server's claim). Every outcome
// that is not a bill maps to Retry or Add by hand (nextSteps) - never a dead end. The bill itself is built from the answer by
// src/domain/aiAnswerBill.ts (the screen, KB-385).

export const POLL_INTERVAL_MS = 1500;
/** Past Gemini's 60 s limit and the 70 s after which a stuck run may be claimed again - so a Retry after this can always run. */
export const GIVE_UP_MS = 75_000;

export type VoiceJobOutcome =
  | { kind: "done"; recordingId: string; transcript: string; items: ParsedItem[] }
  /** reason: "upload" | "start" | the server's kind (rate_limited, download, timeout, busy, failed) */
  | { kind: "failed"; recordingId: string; reason: string }
  | { kind: "gave_up"; recordingId: string };

export type NextStep = "retry" | "add_by_hand";

/** What the screen offers after an outcome: a bill needs nothing; anything else is Retry (the same recording) or Add by hand. */
export function nextSteps(outcome: VoiceJobOutcome): NextStep[] {
  return outcome.kind === "done" ? [] : ["retry", "add_by_hand"];
}

export interface SubmitRecordingOptions {
  client: SupabaseClient;
  shopId: string;
  recordingId: string;
  audio: Blob;
  accessToken: string;
  /** "/voice-run" in the browser (same origin) */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function submitRecording(opts: SubmitRecordingOptions): Promise<VoiceJobOutcome> {
  const { client, shopId, recordingId, audio } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const failed = (reason: string): VoiceJobOutcome => ({ kind: "failed", recordingId, reason });
  // The bucket allows bare audio types ("audio/webm;codecs=opus" -> "audio/webm").
  const mime = audio.type.split(";")[0]!.trim() || "audio/webm";

  const up = await client.storage.from("recordings").upload(`${shopId}/${recordingId}`, audio, { contentType: mime, upsert: false });
  if (up.error && !isAlreadyThere(up.error)) return failed("upload");
  const row = await client.from("voice_recordings").insert({ recording_id: recordingId, shop_id: shopId, mime });
  if (row.error && row.error.code !== "23505") return failed("start");
  // Retry: a recording already done is answered at once (no /voice-run, no Gemini); an earlier FAILED attempt is not this run's
  // answer - only a failure from a newer attempt counts (the worker claims again, attempts + 1).
  let before: RowState | null = null;
  try {
    before = await readRow(client, recordingId);
  } catch {
    // unknown: treat as a fresh recording
  }
  if (before?.status === "done") return { kind: "done", recordingId, transcript: before.transcript ?? "", items: before.items ?? [] };
  const attemptsBefore = before?.attempts ?? 0;
  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.endpoint ?? "/voice-run", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId }),
    });
    if (!res.ok) return failed("start");
  } catch {
    return failed("start");
  }

  const started = now();
  for (;;) {
    try {
      const r = await readRow(client, recordingId);
      if (r?.status === "done") return { kind: "done", recordingId, transcript: r.transcript ?? "", items: r.items ?? [] };
      if (r?.status === "failed" && r.attempts > attemptsBefore) return failed(r.error ?? "failed");
    } catch {
      // a network blip while watching is not the end - keep watching until the limit
    }
    if (now() - started >= GIVE_UP_MS) return { kind: "gave_up", recordingId };
    await sleep(POLL_INTERVAL_MS);
  }
}

interface RowState {
  status: string;
  attempts: number;
  transcript: string | null;
  items: ParsedItem[] | null;
  error: string | null;
}

async function readRow(client: SupabaseClient, recordingId: string): Promise<RowState | null> {
  const { data, error } = await client.from("voice_recordings").select("status, attempts, transcript, items, error").eq("recording_id", recordingId).maybeSingle();
  if (error) throw new Error("read");
  return data as RowState | null;
}

/** The bill was made: the server stamps billed_at once - the recording is then deleted 7 days later (D105, D107). */
export async function markRecordingBilled(client: SupabaseClient, recordingId: string): Promise<boolean> {
  const { error } = await client.from("voice_recordings").update({ billed_at: new Date().toISOString() }).eq("recording_id", recordingId).is("billed_at", null);
  return !error;
}

/** Storage answers 409 / "already exists" for a second upload of the same recording (Retry): it is there, which is what we need. */
function isAlreadyThere(error: { message?: string; statusCode?: string | number }): boolean {
  return String(error.statusCode) === "409" || /already exists|duplicate/i.test(error.message ?? "");
}
