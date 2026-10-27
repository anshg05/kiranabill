import { useCallback, useEffect, useRef, useState } from "react";
import { recordFinalised, type FinaliseSnapshot } from "@/data/billMetrics";
import type { KiranaBillDB } from "@/data/db";
import { captureUtterance, isReviewCaptureOn, purgeReviewCapture, subscribeReviewMode } from "@/data/reviewCapture";
import type { UtteranceMetric } from "@/domain/billMetrics";
import { afterPaint } from "./afterPaint";
import { finaliseSnapshot } from "./billMetricsRecorder";
import type { BillRow } from "./useBillLines";
import type { UtteranceReport } from "./useOrderResolver";
import { useBillMetrics } from "./useBillMetrics";

// KB-404 (docs/07-DECISIONS.md D80): the billing screen's measurement wiring in one place, so it can be tested without the
// screen. Turns (a recording reached transcription), each utterance's report, the Bill Banao snapshot, and - once the receipt
// is on screen - the row written for the bill. Also the opt-in, device-only review capture (S2) and its badge.
// A WRITE-ONLY SINK: nothing here is ever read back into a line, a price or a total, and nothing here can fail a bill.

export interface WiringInput {
  localDb: KiranaBillDB | null;
  shopId: string | null;
  deviceId: string | null;
  billLocalId: string;
  /** The saved draft has been looked at. */
  ready: boolean;
  rows: readonly BillRow[];
  flags: readonly { readonly acknowledged: boolean }[];
  /** Lines removed and not brought back. */
  removed: number;
  /** The bill just saved (the receipt is showing), or null. */
  saved: { readonly localId: string; readonly numberMs?: number | null } | null;
}

interface Pending {
  localId: string;
  t0: number;
  seconds: number;
  turns: number;
  utterances: UtteranceMetric[];
  snapshot: FinaliseSnapshot;
}

export function useMetricsWiring(input: WiringInput) {
  const { localDb, shopId, deviceId, billLocalId, ready, saved } = input;
  const metrics = useBillMetrics(localDb, shopId, billLocalId, ready);
  const latest = useRef(input);
  latest.current = input;
  const stopMs = useRef<number | null>(null);
  const pending = useRef<Pending | null>(null);
  const [reviewOn, setReviewOn] = useState(false);

  // The "Review mode" badge follows the switch in Developer mode.
  useEffect(() => {
    if (!localDb || !shopId) return;
    const load = () => void isReviewCaptureOn(localDb, shopId).then(setReviewOn).catch(() => {});
    load();
    return subscribeReviewMode(load);
  }, [localDb, shopId]);

  // 30 days, on every start.
  useEffect(() => {
    if (localDb) void purgeReviewCapture(localDb).catch(() => {});
  }, [localDb]);

  const onTurn = useCallback(() => metrics.turn(), [metrics]);
  const onTranscribed = useCallback((ms: number) => {
    stopMs.current = ms;
  }, []);
  const onUtterance = useCallback(
    (r: UtteranceReport) => {
      metrics.utterance({ path: r.path, stopToTranscriptMs: stopMs.current, transcriptToItemsMs: r.transcriptToItemsMs });
      if (r.path === "failed") metrics.notAddedSeen(); // its lines never reached the bill
      stopMs.current = null; // it belonged to this utterance only
      const s = latest.current;
      if (s.localDb && s.shopId) void captureUtterance(s.localDb, s.shopId, { billLocalId: s.billLocalId, transcript: r.transcript, path: r.path, lines: [...r.lines] });
    },
    [metrics],
  );
  /** Any other activity on the bill. */
  const touch = metrics.touch;

  /** At the Bill Banao tap: what the screen counts now. Written only once the receipt is showing. */
  const beforeFinalise = useCallback(() => {
    const s = latest.current;
    const rec = metrics.current();
    pending.current = {
      localId: s.billLocalId,
      t0: performance.now(),
      seconds: rec.seconds(Date.now()),
      turns: rec.state.turns,
      utterances: [...rec.state.utterances],
      snapshot: finaliseSnapshot(s.rows, s.flags, s.removed, rec.state.notAdded),
    };
  }, [metrics]);

  // The receipt is on screen: write the bill's row, after the paint (that is the finalise -> receipt time).
  useEffect(() => {
    const p = pending.current;
    if (!p || !saved || saved.localId !== p.localId || !localDb || !shopId || !deviceId) return;
    pending.current = null;
    afterPaint(() => {
      void recordFinalised(localDb, shopId, {
        billLocalId: p.localId,
        deviceId,
        turns: p.turns,
        secondsToBill: p.seconds,
        utterances: p.utterances,
        finaliseToReceiptMs: performance.now() - p.t0,
        numberMs: saved.numberMs ?? null,
        snapshot: p.snapshot,
      });
    });
  }, [saved, localDb, shopId, deviceId]);

  return { reviewOn, onTurn, onTranscribed, onUtterance, touch, beforeFinalise };
}
