import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio, VoiceApiError } from "@/data/voiceApi";
import { useVoiceCapture } from "./useVoiceCapture";

// KB-302: the voice states of 05-FRONTEND-SPEC.md section 2, driven by
// capture (useVoiceCapture) and POST /voice (data/voiceApi.ts). Step 2 of
// 16-APP-FLOW.md section 3: the transcript is shown the moment it lands,
// before any item resolves. No failure is ever a dead end or a throw - the
// mic stays usable (05 section 8 rule 4).

export type VoicePhase =
  | "idle"
  | "requesting" // "Mic permission…" - never a blank pulsing button
  | "listening"
  | "transcribing"
  | "resolving"
  | "done"
  | "failed";

export interface VoiceView {
  phase: VoicePhase;
  /** The latest transcript, shown as soon as it arrives. */
  transcript: string | null;
  /** Inline failure message (phase "failed"). */
  message: string | null;
  /** While listening: ms recorded so far. */
  elapsedMs: number;
  /** Set when the mic must be disabled - the one-line reason (05 section 7). */
  disabledReason: string | null;
}

export const IDLE_VOICE: VoiceView = { phase: "idle", transcript: null, message: null, elapsedMs: 0, disabledReason: null };

export const OFFLINE_REASON = "Offline — voice needs internet";

/** Whisper language hint - "hi" (owner, 28 Sep 2026, docs/07-DECISIONS.md
 * D44): on the owner's real voice, auto-detect wrote Hindi in Urdu script,
 * which Layer 1 and every number check can't read; "hi" gave Devanagari
 * with digits. */
const DEFAULT_LANGUAGE = "hi";

/** DEV ONLY (owner, 27 Sep 2026, Q4): `?lang=hi|en|auto` switches the hint for
 * measurements; "auto" sends no hint. Build-time `false` in production -
 * removed by `npm run build` (VERIFY greps dist/). */
function devLanguage(): string | undefined {
  if (!import.meta.env.DEV) return DEFAULT_LANGUAGE;
  const lang = new URLSearchParams(window.location.search).get("lang");
  if (lang === "auto") return undefined;
  if (lang === "hi" || lang === "en") return lang;
  return DEFAULT_LANGUAGE;
}

/** DEV ONLY (owner, KB-317): `?save=1` sends each recording + its transcript
 * and timings to the dev server, which writes them under eval/real-audio/
 * (gitignored - the owner's voice; vite.config.ts `devSaveRecording`). For the
 * real-transcript fixtures and the Whisper model comparison. Removed from
 * `npm run build` (VERIFY greps dist/). */
function devSaveEnabled(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("save") === "1";
}

async function devSaveRecording(audio: Blob, meta: Record<string, unknown>): Promise<void> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  try {
    const res = await fetch("/__dev/save-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: btoa(binary), mime: audio.type, meta }),
    });
    console.info("[voice] saved recording", await res.json());
  } catch (err) {
    console.warn("[voice] save recording failed (run `npm run dev` or `npx netlify dev`):", err);
  }
}

/** A failure whose message is written for the shopkeeper and shown as-is. */
export class VoiceUserError extends Error {}

function messageFor(err: unknown): string {
  if (err instanceof VoiceUserError) return err.message;
  if (err instanceof VoiceApiError) {
    if (err.kind === "unauthorized") return "Session expired — sign out and sign in again";
    if (err.kind === "rate_limited") return "Too many voice requests — wait a minute and try again";
    if (err.kind === "network") return "No internet — voice needs a connection";
  }
  return "Couldn't hear that — try again";
}

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export interface UseVoiceBillingOptions {
  /** The LIVE session's JWT - null in offline-session mode (KB-315, D38). */
  accessToken: string | null;
  vocabulary?: readonly string[];
  /** Called with each transcript; resolves when its lines are on the bill (commit b). */
  onTranscript?: (transcript: string) => Promise<void>;
  /** Set while voice can't run yet for a non-network reason (the shop's
   * catalog still loading) - shown as the disabled reason. */
  notReadyReason?: string | null;
  /** Injected in tests. */
  endpoint?: string;
}

export interface VoiceBilling {
  view: VoiceView;
  onMicTap: () => void;
  /** DEV measurement only (KB-317, owner): when the press started, to see how
   * much earlier than the click a recording could start. Changes nothing. */
  onMicPointerDown: () => void;
  /** Turns the warm mic off now - the screen calls it before signing out (D45). */
  releaseMic: () => void;
}

export function useVoiceBilling(opts: UseVoiceBillingOptions): VoiceBilling {
  const capture = useVoiceCapture();
  const pointerDownAtRef = useRef<number | null>(null);
  const pointerDownToTapRef = useRef<number | null>(null);
  const browserOnline = useBrowserOnline();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const disabledReason = !opts.accessToken || !browserOnline ? OFFLINE_REASON : (opts.notReadyReason ?? null);

  // Capture errors (permission denied, no mic, unsupported) surface as "failed".
  useEffect(() => {
    if (capture.error) {
      setPhase("failed");
      setMessage(capture.error.message);
    }
  }, [capture.error]);

  const onMicTap = useCallback(() => {
    void (async () => {
      if (disabledReason || !opts.accessToken) return;
      const pointerDownAt = pointerDownAtRef.current;
      pointerDownAtRef.current = null;

      if (capture.phase === "listening") {
        const stoppedAt = performance.now();
        const audio = await capture.stop();
        if (!audio) {
          setPhase("failed");
          setMessage("Didn't catch anything — try again");
          return;
        }
        setPhase("transcribing");
        const language = devLanguage();
        let text: string;
        try {
          text = (
            await transcribeAudio(audio, {
              accessToken: opts.accessToken,
              language,
              vocabulary: opts.vocabulary,
              endpoint: opts.endpoint,
            })
          ).trim();
        } catch (err) {
          setPhase("failed");
          setMessage(messageFor(err));
          return;
        }
        // KB-317 (a): per-stage timings, dev only. stopToTranscript = recorder
        // stop + upload + Groq; Layer 1 / Gemini are logged by the screen.
        // Commit 4 (D45): the tap split - cold/warm, getUserMedia vs recorder
        // start - and pointerdown -> tap (the owner's pointerdown question).
        const tap = capture.lastTiming;
        const timings = {
          tap: tap?.kind ?? null,
          tapToListeningMs: tap ? Math.round(tap.tapToListeningMs) : null,
          getUserMediaMs: tap ? Math.round(tap.getUserMediaMs) : null,
          recorderStartMs: tap ? Math.round(tap.recorderStartMs) : null,
          pointerDownToTapMs: pointerDownToTapRef.current === null ? null : Math.round(pointerDownToTapRef.current),
          stopToTranscriptMs: Math.round(performance.now() - stoppedAt),
        };
        if (import.meta.env.DEV) {
          console.info("[voice]", { lang: language ?? "auto", ...timings, transcript: text });
        }
        const save = (outcome: string) => {
          if (devSaveEnabled()) {
            void devSaveRecording(audio, {
              transcript: text,
              lang: language ?? "auto",
              ...timings,
              stopToLinesMs: Math.round(performance.now() - stoppedAt),
              outcome,
            });
          }
        };
        if (!text) {
          save("empty transcript");
          setPhase("failed");
          setMessage("Didn't catch anything — try again");
          return;
        }
        setTranscript(text);
        setMessage(null);
        if (!opts.onTranscript) {
          save("transcript only");
          setPhase("done");
          return;
        }
        setPhase("resolving");
        try {
          await opts.onTranscript(text);
          if (import.meta.env.DEV) console.info("[voice] stop → lines", Math.round(performance.now() - stoppedAt), "ms");
          save("lines");
          setPhase("done");
        } catch (err) {
          save(`failed: ${messageFor(err)}`);
          setPhase("failed");
          setMessage(messageFor(err));
        }
        return;
      }

      if (capture.phase === "idle") {
        pointerDownToTapRef.current = pointerDownAt === null ? null : performance.now() - pointerDownAt;
        setMessage(null);
        setTranscript(null);
        setPhase("requesting");
        await capture.start();
      }
    })();
  }, [capture, disabledReason, opts]);

  // Capture's own phase wins while it is active.
  const livePhase: VoicePhase =
    capture.phase === "requesting"
      ? "requesting"
      : capture.phase === "listening"
        ? "listening"
        : capture.phase === "stopping"
          ? "transcribing"
          : phase === "requesting"
            ? "idle"
            : phase;

  const onMicPointerDown = useCallback(() => {
    pointerDownAtRef.current = performance.now();
  }, []);

  return {
    view: { phase: livePhase, transcript, message, elapsedMs: capture.elapsedMs, disabledReason },
    onMicTap,
    onMicPointerDown,
    releaseMic: capture.release,
  };
}
