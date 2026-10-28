import type { KiranaBillDB } from "./db";
import type { VoiceCallTiming } from "./voiceApi";

// KB-352 (owner, 28 Oct 2026): the split of stop -> transcript for each voice turn, kept ON THIS PHONE ONLY (the device's meta table - never
// synced, no migration). Numbers, an audio type and region names - never a transcript, a name or a URL. A timing can never fail a turn.

export interface VoiceTimingRow {
  readonly at: string;
  readonly audioBytes?: number;
  readonly audioType?: string;
  /** Pressing stop -> the recording is a blob. */
  readonly stopToBlobMs?: number;
  /** Send -> first byte of the answer (upload + function + the way back). */
  readonly requestMs: number;
  readonly bodyMs?: number;
  /** Pressing stop -> the transcript is on screen. */
  readonly totalMs: number;
  readonly server: VoiceCallTiming["server"];
  readonly region: string | null;
  readonly groqRegion: string | null;
}

const KEY = "voiceTimings";
export const VOICE_TIMINGS_KEEP = 40;
const PLAIN = /^[A-Za-z0-9._;=+/-]{1,60}$/;
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

let queue: Promise<unknown> = Promise.resolve();

export async function listVoiceTimings(localDb: KiranaBillDB): Promise<VoiceTimingRow[]> {
  try {
    const parsed: unknown = JSON.parse((await localDb.meta.get(KEY))?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is VoiceTimingRow => typeof r?.at === "string" && typeof r?.requestMs === "number") : [];
  } catch {
    return [];
  }
}

export function recordVoiceTiming(localDb: KiranaBillDB, t: VoiceTimingRow): Promise<void> {
  const write = async (): Promise<void> => {
    try {
      const server: Record<string, number> = {};
      for (const [k, v] of Object.entries(t.server ?? {})) if (whole(v) !== undefined) server[k] = whole(v)!;
      const clean: Record<string, unknown> = { at: String(t.at), requestMs: whole(t.requestMs), totalMs: whole(t.totalMs), server, region: t.region && PLAIN.test(t.region) ? t.region : null, groqRegion: t.groqRegion && PLAIN.test(t.groqRegion) ? t.groqRegion : null };
      for (const [k, v] of [["audioBytes", whole(t.audioBytes)], ["stopToBlobMs", whole(t.stopToBlobMs)], ["bodyMs", whole(t.bodyMs)]] as const) if (v !== undefined) clean[k] = v;
      if (t.audioType && PLAIN.test(t.audioType)) clean.audioType = t.audioType;
      if (clean.requestMs === undefined || clean.totalMs === undefined) return;
      const rows = [...(await listVoiceTimings(localDb)), clean as unknown as VoiceTimingRow].slice(-VOICE_TIMINGS_KEEP);
      await localDb.meta.put({ key: KEY, value: JSON.stringify(rows) });
    } catch (err) {
      console.warn("[voice timings] not recorded:", err instanceof Error ? err.name : "error");
    }
  };
  queue = queue.then(write, write);
  return queue as Promise<void>;
}
