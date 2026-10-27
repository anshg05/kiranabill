// KB-404 (docs/07-DECISIONS.md D80): the pilot measurements behind the release gate (01 S1-S7, 06 "Release gate"), as pure
// functions. A metrics row is NUMBERS AND ENUMS ONLY - no customer name or mobile, no transcript, no item name - and
// nothing here is ever read back into a bill: a metric never changes a price, a quantity or a total.

/** Utterance outcome: the path that produced the lines, or 'failed' (nothing reached the bill). */
export type UtterancePath = "fastpath" | "voice" | "failed";

export interface UtteranceMetric {
  readonly path: UtterancePath;
  /** Recorder stop -> transcript string. */
  readonly stopToTranscriptMs: number | null;
  /** Transcript received -> the lines painted on screen (null when nothing was added). */
  readonly transcriptToItemsMs: number | null;
}

/** One finalised bill's measurements (bill_metrics). */
export interface BillMetricsRow {
  readonly billLocalId: string;
  readonly deviceId: string;
  /** What the device saw at Bill Banao - the reconciliation reads these against the server's bill. */
  readonly receiptNumber: string;
  readonly totalPaise: number;
  readonly lineCount: number;
  /** A turn = a recording that reached transcription (success or failure). Retry (text only) is not a turn. */
  readonly turns: number;
  /** First activity -> Bill Banao, any idle gap capped at 60 s. */
  readonly secondsToBill: number;
  readonly utterances: readonly UtteranceMetric[];
  readonly finaliseToReceiptMs: number | null;
  /** KB-351: the server round trip for the bill number (null: no attempt, or an offline number). */
  readonly numberMs: number | null;
  readonly voiceLines: number;
  readonly editedLines: number;
  readonly manualLines: number;
  readonly removedLines: number;
  /** Utterances that stayed "Not added" at some point. */
  readonly notAdded: number;
  readonly flagsRaised: number;
  readonly flagsAcknowledged: number;
  readonly recordedAt: string;
}

export const IDLE_CAP_MS = 60_000;
export const WINDOW_BILLS = 20;
/** A comparison "voice vs typing" needs at least this many of each. */
export const MIN_TYPED_BASELINE = 10;

/** Seconds from the first activity to the last, each gap capped at IDLE_CAP_MS (a draft left open an hour is not an hour). */
export function activeSeconds(timestampsMs: readonly number[]): number {
  let ms = 0;
  for (let i = 1; i < timestampsMs.length; i++) ms += Math.min(Math.max(timestampsMs[i]! - timestampsMs[i - 1]!, 0), IDLE_CAP_MS);
  return Math.round(ms / 1000);
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Nearest-rank percentile. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export interface GateInput {
  readonly metrics: BillMetricsRow;
  readonly status: "final" | "cancelled";
  /** The bill's finalised time (ISO) - the order of "consecutive". */
  readonly finalizedAt: string;
  /** This bill is the replacement of a cancelled one (a bill_cancellations row points at it). */
  readonly isReissue: boolean;
}

export interface CancellationInput {
  readonly reason: string;
  readonly billFinalizedAt: string;
}

export interface Spread {
  readonly median: number | null;
  readonly p95: number | null;
  readonly n: number;
}

const spread = (xs: readonly number[]): Spread => ({ median: median(xs), p95: percentile(xs, 95), n: xs.length });
const pct = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 100));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ERROR_REASONS = new Set(["wrong_item", "wrong_price", "wrong_quantity"]);

export interface GateReport {
  readonly voice: { readonly n: number; readonly from: string | null; readonly to: string | null };
  readonly turns: { readonly median: number | null };
  readonly seconds: {
    readonly voice: { readonly median: number | null; readonly n: number };
    readonly typed: { readonly median: number | null; readonly n: number };
    readonly verdict: string;
  };
  readonly coverage: { readonly fastpath: number; readonly llm: number; readonly failed: number; readonly pct: number | null };
  readonly zeroEdit: { readonly zero: number; readonly of: number; readonly pct: number | null; readonly needingHands: number };
  readonly latency: { readonly stopToTranscript: Spread; readonly fastpathToItems: Spread; readonly llmToItems: Spread };
  readonly finaliseToReceipt: Spread;
  /** KB-351: the bill-number round trip, bills that got a server number only. */
  readonly number: Spread;
  /** Bills later cancelled for a wrong item / price / quantity - an error that reached a finalised bill (all of them until the window is full). */
  readonly escapedErrors: number;
}

/**
 * The gate lines over the last WINDOW_BILLS ELIGIBLE voice bills (by finalised time, across every device of the shop).
 * Eligible = not cancelled and not a reissue replacement. A voice bill has at least one turn; a hand-only bill (no turns,
 * hand-added lines) is the typing baseline, timed by the SAME seconds-to-bill rule. Hand lines are out of the fast-path
 * and zero-edit counts - a bill that has any is shown on its own line, not dropped.
 */
export function gateReport(inputs: readonly GateInput[], cancellations: readonly CancellationInput[]): GateReport {
  const eligible = inputs.filter((i) => i.status === "final" && !i.isReissue).sort((a, b) => (a.finalizedAt < b.finalizedAt ? 1 : a.finalizedAt > b.finalizedAt ? -1 : 0));
  const win = eligible.filter((i) => i.metrics.turns >= 1).slice(0, WINDOW_BILLS);
  const typed = eligible.filter((i) => i.metrics.turns === 0 && i.metrics.manualLines > 0 && i.metrics.voiceLines === 0).slice(0, WINDOW_BILLS);

  const utterances = win.flatMap((i) => i.metrics.utterances);
  const fastpath = utterances.filter((u) => u.path === "fastpath").length;
  const llm = utterances.filter((u) => u.path === "voice").length;
  const failed = utterances.filter((u) => u.path === "failed").length;

  const withoutHands = win.filter((i) => i.metrics.manualLines === 0);
  const zero = withoutHands.filter((i) => i.metrics.editedLines === 0 && i.metrics.removedLines === 0 && i.metrics.notAdded === 0).length;

  const num = (xs: readonly (number | null)[]) => xs.filter((x): x is number => x !== null);
  const voiceSeconds = median(win.map((i) => i.metrics.secondsToBill));
  const typedSeconds = median(typed.map((i) => i.metrics.secondsToBill));
  let verdict: string;
  if (typed.length < MIN_TYPED_BASELINE) verdict = `Only ${plural(typed.length, "hand-only bill", "hand-only bills")} so far (${MIN_TYPED_BASELINE} needed) - type a baseline set during the pilot`;
  else if (win.length < MIN_TYPED_BASELINE) verdict = `Only ${plural(win.length, "voice bill", "voice bills")} so far (${MIN_TYPED_BASELINE} needed)`;
  else verdict = voiceSeconds! < typedSeconds! ? `Voice is faster: ${voiceSeconds} s against ${typedSeconds} s typing` : `Voice is NOT faster: ${voiceSeconds} s against ${typedSeconds} s typing`;

  const from = win.length > 0 ? win[win.length - 1]!.finalizedAt : null;
  // Until the window holds its 20 bills every error cancellation counts (the pilot has just begun); a full window counts those since its first bill.
  const escapedFrom = win.length < WINDOW_BILLS ? null : from;
  return {
    voice: { n: win.length, from, to: win.length > 0 ? win[0]!.finalizedAt : null },
    turns: { median: median(win.map((i) => i.metrics.turns)) },
    seconds: { voice: { median: voiceSeconds, n: win.length }, typed: { median: typedSeconds, n: typed.length }, verdict },
    coverage: { fastpath, llm, failed, pct: pct(fastpath, fastpath + llm) },
    zeroEdit: { zero, of: withoutHands.length, pct: pct(zero, withoutHands.length), needingHands: win.length - withoutHands.length },
    latency: {
      stopToTranscript: spread(num(utterances.map((u) => u.stopToTranscriptMs))),
      fastpathToItems: spread(num(utterances.filter((u) => u.path === "fastpath").map((u) => u.transcriptToItemsMs))),
      llmToItems: spread(num(utterances.filter((u) => u.path === "voice").map((u) => u.transcriptToItemsMs))),
    },
    finaliseToReceipt: spread(num(win.map((i) => i.metrics.finaliseToReceiptMs))),
    number: spread(num(win.map((i) => i.metrics.numberMs))),
    escapedErrors: cancellations.filter((c) => ERROR_REASONS.has(c.reason) && (escapedFrom === null || c.billFinalizedAt >= escapedFrom)).length,
  };
}

/** What the device holds for a finalised bill / what the server holds for it. */
export interface LocalBillView {
  readonly receiptNumber: string;
  readonly totalPaise: number;
  readonly lineCount: number;
  readonly status: "final" | "cancelled";
  readonly syncStatus: "pending" | "synced" | "conflict";
}
export interface ServerBillView {
  readonly receiptNumber: string;
  readonly totalPaise: number;
  readonly lineCount: number;
  readonly status: "draft" | "final" | "cancelled";
}

/** "No bill lost or corrupted": every difference between a local bill and the server's, in plain words (empty = fine). */
export function compareBill(local: LocalBillView, server: ServerBillView | null): string[] {
  const out: string[] = [];
  if (local.syncStatus === "pending") out.push("is still waiting to sync");
  if (local.syncStatus === "conflict") out.push("the server refused it (conflict)");
  if (server === null) return [...out, "is not on the server"];
  if (local.receiptNumber !== server.receiptNumber) out.push(`receipt number differs (${local.receiptNumber} here, ${server.receiptNumber} on the server)`);
  if (local.totalPaise !== server.totalPaise) out.push(`total differs (${local.totalPaise} paise here, ${server.totalPaise} on the server)`);
  if (local.lineCount !== server.lineCount) out.push(`item count differs (${local.lineCount} here, ${server.lineCount} on the server)`);
  if (local.status !== server.status) out.push(`status differs (${local.status} here, ${server.status} on the server)`);
  return out;
}
