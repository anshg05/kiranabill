import { useCallback, useEffect, useRef, useState } from "react";

// KB-302: push-to-talk capture (docs/04-VOICE-PIPELINE.md section 2 - tap to
// start, tap to stop; no length limit). The browser picks its own recording
// format - Chrome audio/webm;codecs=opus, Safari audio/mp4 - and the Blob
// keeps that type; groqTranscriptionProvider maps it to a file extension.
// Every failure becomes a CaptureError the screen shows inline - never a throw.
//
// KB-317 commit 4 - the warm mic (docs/07-DECISIONS.md D45): opening the mic
// cost ~150-800 ms on every tap. After a recording the stream stays open for
// WARM_MIC_MS and the next tap records from it (a NEW MediaRecorder); then it
// is released and the browser's mic indicator goes off. Released at once when
// the tab is hidden, the screen unmounts, or the user signs out (release()).
// A warm track the browser has ended is never recorded from. Never opened
// before a tap - the mic is never on unasked.

export type CapturePhase = "idle" | "requesting" | "listening" | "stopping";

export type CaptureErrorKind = "permission" | "no-mic" | "unsupported" | "failed" | "interrupted";

export interface CaptureError {
  kind: CaptureErrorKind;
  message: string;
}

const MESSAGES: Record<CaptureErrorKind, string> = {
  permission: "Mic permission denied — allow it in the browser's site settings",
  "no-mic": "No microphone found",
  unsupported: "Voice isn't supported in this browser",
  failed: "The microphone didn't start — try again",
  interrupted: "Recording stopped — the app went to the background. Tap to try again",
};

/** D45: how long the mic stays open after a recording ends. */
export const WARM_MIC_MS = 60_000;

function captureError(kind: CaptureErrorKind): CaptureError {
  return { kind, message: MESSAGES[kind] };
}

function kindOf(err: unknown): CaptureErrorKind {
  // getUserMedia rejects with a DOMException; don't rely on it being
  // `instanceof Error` (not true in every runtime) - its `name` is the contract.
  const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") return "no-mic";
  return "failed";
}

/** A stream is only reused while every track is still live - a mic unplugged,
 * a permission revoked or a device that slept ends the track. */
function isLive(stream: MediaStream | null): stream is MediaStream {
  const tracks = stream?.getTracks() ?? [];
  return tracks.length > 0 && tracks.every((t) => t.readyState === "live");
}

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** One tap, split (05-FRONTEND-SPEC.md section 10: cold <= 300 ms, warm < 100 ms). */
export interface CaptureTiming {
  /** "cold": getUserMedia opened the mic; "warm": the open stream was reused. */
  readonly kind: "cold" | "warm";
  readonly tapToListeningMs: number;
  /** 0 on a warm tap. */
  readonly getUserMediaMs: number;
  /** new MediaRecorder -> its start event. */
  readonly recorderStartMs: number;
}

export interface VoiceCapture {
  phase: CapturePhase;
  error: CaptureError | null;
  /** ms since recording started, while listening (drives the mm:ss timer). */
  elapsedMs: number;
  /** The last tap's timing - null until the first recording starts. */
  lastTiming: CaptureTiming | null;
  /** Starts recording; resolves once listening, or with the error. */
  start: () => Promise<void>;
  /** Stops recording; resolves to the audio, or null if nothing was captured. */
  stop: () => Promise<Blob | null>;
  /** Turns the mic off now (sign-out). */
  release: () => void;
}

export function useVoiceCapture(): VoiceCapture {
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [error, setError] = useState<CaptureError | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastTiming, setLastTiming] = useState<CaptureTiming | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;
  }, []);

  const release = useCallback(() => {
    // Turn the mic off (and the browser's recording indicator with it).
    clearReleaseTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [clearReleaseTimer]);

  useEffect(() => release, [release]);

  // Hidden tab/app: the mic goes off at once. A recording in progress is
  // stopped and discarded, and the shopkeeper is told - never recording in
  // the background.
  useEffect(() => {
    const onVisibility = () => {
      if (!isHidden()) return;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
        setError(captureError("interrupted"));
        setPhase("idle");
      }
      release();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [release]);

  useEffect(() => {
    if (phase !== "listening") return;
    const timer = setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const start = useCallback(async () => {
    const tappedAt = performance.now();
    clearReleaseTimer(); // a tap inside the warm window keeps the mic
    setError(null);
    setElapsedMs(0);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(captureError("unsupported"));
      return;
    }
    setPhase("requesting");

    let stream: MediaStream;
    let getUserMediaMs = 0;
    const warm = isLive(streamRef.current);
    if (warm) {
      stream = streamRef.current!;
    } else {
      release(); // a dead warm stream: drop it, open a fresh one
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        setPhase("idle");
        setError(captureError(kindOf(err)));
        return;
      }
      getUserMediaMs = performance.now() - tappedAt;
      if (isHidden()) {
        // The tab went hidden while the mic was opening - never record from it.
        stream.getTracks().forEach((t) => t.stop());
        setPhase("idle");
        return;
      }
      streamRef.current = stream;
    }

    const recorderAt = performance.now();
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      // HARD RULE (D45): listening only once the recorder has ACTUALLY started.
      await new Promise<void>((resolve, reject) => {
        recorder.onstart = () => resolve();
        recorder.onerror = () => reject(new Error("recorder error"));
        recorder.start();
      });
    } catch {
      release();
      setPhase("idle");
      setError(captureError("failed"));
      return;
    }
    startedAtRef.current = performance.now();
    setLastTiming({
      kind: warm ? "warm" : "cold",
      tapToListeningMs: startedAtRef.current - tappedAt,
      getUserMediaMs,
      recorderStartMs: startedAtRef.current - recorderAt,
    });
    setPhase("listening");
  }, [clearReleaseTimer, release]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      release();
      setPhase("idle");
      return null;
    }
    setPhase("stopping");
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    recorderRef.current = null;
    // Keep the stream warm for the next tap, then let it go (D45).
    clearReleaseTimer();
    releaseTimerRef.current = setTimeout(release, WARM_MIC_MS);
    setPhase("idle");
    return blob.size > 0 ? blob : null;
  }, [clearReleaseTimer, release]);

  return { phase, error, elapsedMs, lastTiming, start, stop, release };
}
