import type { KiranaBillDB } from "@/data/db";
import type { FinaliseSnapshot } from "@/data/billMetrics";
import { IDLE_CAP_MS, type UtteranceMetric } from "@/domain/billMetrics";
import { wasEdited, type BillRow } from "./useBillLines";

// KB-404 (docs/07-DECISIONS.md D80): one bill's measurements, accumulated in memory as it is built and kept (like the
// draft, KB-313) in the signed-in user's own database - a reload or Android killing the tab mid-bill loses nothing. Numbers
// and enums only. It is a write-only sink: nothing here is ever read back into a line, a price or a total.

export interface RecorderState {
  billLocalId: string;
  /** First and latest activity (ms since the epoch); null until the first. */
  firstAt: number | null;
  lastAt: number | null;
  /** Active time so far: the gaps between activities, each capped at IDLE_CAP_MS. */
  activeMs: number;
  /** Recordings that reached transcription (success or failure). Retry is not a turn. */
  turns: number;
  utterances: UtteranceMetric[];
  /** "Not added" entries seen (an utterance whose lines never made it, until Retry or dismiss). */
  notAdded: number;
}

export class BillMetricsRecorder {
  state: RecorderState;

  constructor(billLocalId: string, state?: RecorderState) {
    this.state = state ?? { billLocalId, firstAt: null, lastAt: null, activeMs: 0, turns: 0, utterances: [], notAdded: 0 };
  }

  /** Any activity on the bill: a mic tap, a line added / edited / removed, a customer set. */
  touch(now: number = Date.now()): void {
    const s = this.state;
    if (s.lastAt !== null) s.activeMs += Math.min(Math.max(now - s.lastAt, 0), IDLE_CAP_MS);
    if (s.firstAt === null) s.firstAt = now;
    s.lastAt = now;
  }

  /** A recording reached transcription. */
  turn(now: number = Date.now()): void {
    this.touch(now);
    this.state.turns += 1;
  }

  utterance(u: UtteranceMetric, now: number = Date.now()): void {
    this.touch(now);
    this.state.utterances.push({ path: u.path, stopToTranscriptMs: u.stopToTranscriptMs, transcriptToItemsMs: u.transcriptToItemsMs });
  }

  notAddedSeen(): void {
    this.state.notAdded += 1;
  }

  /** Active seconds up to `now` (the Bill Banao tap), the last gap capped too. */
  seconds(now: number): number {
    const s = this.state;
    if (s.lastAt === null) return 0;
    return Math.round((s.activeMs + Math.min(Math.max(now - s.lastAt, 0), IDLE_CAP_MS)) / 1000);
  }
}

const key = (shopId: string) => `billMetricsDraft:${shopId}`;

export async function saveRecorder(db: KiranaBillDB, shopId: string, r: BillMetricsRecorder): Promise<void> {
  await db.meta.put({ key: key(shopId), value: JSON.stringify(r.state) });
}

/** The recorder kept for THIS bill, or a fresh one (another bill's, another shop's, or damaged text is never used). */
export async function loadRecorder(db: KiranaBillDB, shopId: string, billLocalId: string): Promise<BillMetricsRecorder> {
  try {
    const text = (await db.meta.get(key(shopId)))?.value;
    const s = text ? (JSON.parse(text) as Partial<RecorderState>) : null;
    if (s && s.billLocalId === billLocalId && typeof s.activeMs === "number" && typeof s.turns === "number" && Array.isArray(s.utterances) && typeof s.notAdded === "number") {
      return new BillMetricsRecorder(billLocalId, { billLocalId, firstAt: s.firstAt ?? null, lastAt: s.lastAt ?? null, activeMs: s.activeMs, turns: s.turns, utterances: s.utterances, notAdded: s.notAdded });
    }
  } catch {
    /* fall through - a damaged record starts the bill's measurements again */
  }
  return new BillMetricsRecorder(billLocalId);
}

export async function clearRecorder(db: KiranaBillDB, shopId: string): Promise<void> {
  await db.meta.delete(key(shopId));
}

/**
 * What the screen counts at the Bill Banao tap, from the rows as they stand: voice lines (fast path or Layer 2), hand lines,
 * edited VOICE lines (an edit on a hand line is not a voice edit), removed lines, and the flags raised / acknowledged.
 */
export function finaliseSnapshot(rows: readonly BillRow[], flags: readonly { readonly acknowledged: boolean }[], removed: number, notAdded: number): FinaliseSnapshot {
  const voice = rows.filter((r) => r.source !== "manual");
  return {
    voiceLines: voice.length,
    editedLines: voice.filter(wasEdited).length,
    manualLines: rows.length - voice.length,
    removedLines: removed,
    notAdded,
    flagsRaised: flags.length,
    flagsAcknowledged: flags.filter((f) => f.acknowledged).length,
  };
}
