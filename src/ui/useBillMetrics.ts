import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KiranaBillDB } from "@/data/db";
import type { UtteranceMetric } from "@/domain/billMetrics";
import { BillMetricsRecorder, loadRecorder, saveRecorder } from "./billMetricsRecorder";

// KB-404 (D80): the measurements of the bill being built. A write-only sink - the bill never reads anything from here.
// Kept with the draft (a reload mid-bill loses nothing); a new bill (a new local id) starts fresh.

export interface BillMetrics {
  /** Any activity on the bill: a mic tap, a line added / edited / removed, a customer set. */
  touch: () => void;
  /** A recording reached transcription. */
  turn: () => void;
  utterance: (u: UtteranceMetric) => void;
  notAddedSeen: () => void;
  /** The recorder as it stands now (read at the Bill Banao tap). */
  current: () => BillMetricsRecorder;
}

export function useBillMetrics(db: KiranaBillDB | null, shopId: string | null, billLocalId: string, ready: boolean): BillMetrics {
  const ref = useRef(new BillMetricsRecorder(billLocalId));
  if (ref.current.state.billLocalId !== billLocalId) ref.current = new BillMetricsRecorder(billLocalId);

  // The kept record for THIS bill - only onto a recorder that has seen nothing yet (a late load never wipes events).
  useEffect(() => {
    if (!db || !shopId || !ready) return;
    let live = true;
    void loadRecorder(db, shopId, billLocalId).then((stored) => {
      if (live && ref.current.state.billLocalId === billLocalId && ref.current.state.lastAt === null && stored.state.lastAt !== null) ref.current = stored;
    });
    return () => {
      live = false;
    };
  }, [db, shopId, billLocalId, ready]);

  const persist = useCallback(() => {
    if (db && shopId) void saveRecorder(db, shopId, ref.current).catch(() => {});
  }, [db, shopId]);

  return useMemo(
    () => ({
      touch: () => (ref.current.touch(), persist()),
      turn: () => (ref.current.turn(), persist()),
      utterance: (u) => (ref.current.utterance(u), persist()),
      notAddedSeen: () => (ref.current.notAddedSeen(), persist()),
      current: () => ref.current,
    }),
    [persist],
  );
}
