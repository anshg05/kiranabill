import { useCallback, useEffect, useRef, useState } from "react";

// KB-302: push-to-talk capture (docs/04-VOICE-PIPELINE.md section 2 - tap to
// start, tap to stop; no length limit). The browser picks its own recording
// format - Chrome audio/webm;codecs=opus, Safari audio/mp4 - and the Blob
// keeps that type; groqTranscriptionProvider maps it to a file extension.
// Every failure becomes a CaptureError the screen shows inline - never a throw.

export type CapturePhase = "idle" | "requesting" | "listening" | "stopping";

export type CaptureErrorKind = "permission" | "no-mic" | "unsupported" | "failed";

export interface CaptureError {
  kind: CaptureErrorKind;
  message: string;
}

const MESSAGES: Record<CaptureErrorKind, string> = {
  permission: "Mic permission denied — allow it in the browser's site settings",
  "no-mic": "No microphone found",
  unsupported: "Voice isn't supported in this browser",
  failed: "The microphone didn't start — try again",
};

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

export interface VoiceCapture {
  phase: CapturePhase;
  error: CaptureError | null;
  /** ms since recording started, while listening (drives the mm:ss timer). */
  elapsedMs: number;
  /** 05-FRONTEND-SPEC.md section 10: tap -> listening (< 100 ms budget). */
  lastTapToListeningMs: number | null;
  /** Starts recording; resolves once listening, or with the error. */
  start: () => Promise<void>;
  /** Stops recording; resolves to the audio, or null if nothing was captured. */
  stop: () => Promise<Blob | null>;
}

export function useVoiceCapture(): VoiceCapture {
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [error, setError] = useState<CaptureError | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastTapToListeningMs, setLastTap] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const release = useCallback(() => {
    // Turn the mic off (and the browser's recording indicator with it).
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  useEffect(() => {
    if (phase !== "listening") return;
    const timer = setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const start = useCallback(async () => {
    const tappedAt = performance.now();
    setError(null);
    setElapsedMs(0);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(captureError("unsupported"));
      return;
    }
    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setPhase("idle");
      setError(captureError(kindOf(err)));
      return;
    }
    streamRef.current = stream;
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
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
    setLastTap(startedAtRef.current - tappedAt);
    setPhase("listening");
  }, [release]);

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
    release();
    setPhase("idle");
    return blob.size > 0 ? blob : null;
  }, [release]);

  return { phase, error, elapsedMs, lastTapToListeningMs, start, stop };
}
