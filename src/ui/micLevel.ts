import { useEffect, useState } from "react";

// KB-413 step 2 (owner, 15 Nov 2026, answer 5): 09-Recording's waveform follows the REAL microphone level - light, no dependency: the
// browser's own AnalyserNode on the stream that is already recording, read every 100 ms. Each bar keeps the design's height and is
// scaled by one recent level (the newest on the right), from the file's .35 (silence) to 1 (loud) - the same range kbBar animates.
// Reduced motion, or no Web Audio: null, and the screen draws the bars still at their full height.

export const BARS = 26;
const SILENT = 0.35;
/** the RMS of a speaking voice into a phone's mic sits around 0.02 - 0.2 of full scale; 0.2 and above is a full bar */
const LOUD_RMS = 0.2;

/** The RMS of one time-domain frame (AnalyserNode bytes: 128 = silence), 0..1. */
export function rmsOf(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) {
    const v = (s - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** One bar's scale for an RMS: .35 (silence) .. 1 (loud). */
export const scaleOf = (rms: number): number => SILENT + (1 - SILENT) * Math.min(1, Math.max(0, rms) / LOUD_RMS);

/** The newest scale on the right; the oldest falls off the left. */
export const pushScale = (scales: readonly number[], next: number): number[] => [...scales.slice(1), next];

export const stillScales = (): number[] => Array<number>(BARS).fill(SILENT);

export function prefersStill(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce") return true;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The bars' scales while `active` (recording, not paused); they hold still while paused. null = draw them still at full height. */
export function useMicLevel(stream: MediaStream | null, active: boolean): number[] | null {
  const [scales, setScales] = useState<number[] | null>(null);
  useEffect(() => {
    if (!stream || !active || prefersStill() || typeof AudioContext === "undefined") return;
    let ctx: AudioContext | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser); // never to ctx.destination: nothing is played back
      const frame = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(frame);
        setScales((s) => pushScale(s ?? stillScales(), scaleOf(rmsOf(frame))));
      }, 100);
    } catch {
      void ctx?.close().catch(() => {});
      return; // no level on this phone: the still bars, the recording itself is untouched
    }
    return () => {
      clearInterval(timer);
      void ctx?.close().catch(() => {});
    };
  }, [stream, active]);
  return scales;
}
