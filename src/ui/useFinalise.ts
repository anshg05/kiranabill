import { useCallback, useRef, useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import { finaliseBill, SAVE_FAILED, type FinaliseResult } from "@/data/finalise";
import type { ServerNumber } from "@/data/receiptNumbers";
import { loadReceipt } from "@/data/receipt";
import { afterPaintOrSoon } from "./afterPaint";
import type { Receipt } from "@/domain/receipt";
import type { BillDraft } from "./useBillLines";

// KB-307 commit 2: Bill Banao's save, for the screen. One save at a time (a
// second tap while saving is ignored - and finaliseBill is idempotent per bill
// anyway); the saved receipt number for the saved screen; a plain message if
// the local write fails - the bill stays as it was, nothing half-written.

export type FinalisePhase = "idle" | "saving" | "saved" | "failed";

export interface UseFinaliseOptions {
  localDb: KiranaBillDB | null;
  shopId: string | null;
  deviceId: string | null;
  /** KB-351 (D92): the shop's next bill number from the server (requestBillNumber - null when offline, slow or refused: the bill then takes an offline number). Absent = always offline numbers. */
  getNumber?: (billLocalId: string) => Promise<ServerNumber | null>;
  /**
   * KB-352: after the bill is committed AND its receipt has painted - learning, the catalog reload, a sync. Started a frame after the
   * receipt, never awaited by finalise; a failure or a hang in it cannot touch the saved bill.
   */
  onSaved?: (result: FinaliseResult, billLocalId: string) => void | Promise<unknown>;
}

/** KB-308: the saved bill's receipt, read back from the device (null if that read failed - the bill is still saved). */
export interface SavedBill {
  /** KB-309: the stored bill's id - share reads its mobile from it at tap time. */
  readonly localId: string;
  readonly receiptNumber: string;
  /** KB-351: the server round trip for the number, for the metrics (null: an offline number). */
  readonly numberMs?: number | null;
  /** KB-352: where the save's time went, in ms (performance.now): waiting for the number, the one local write, reading the receipt back; and the moment it was saved. */
  readonly phases?: { readonly numberWaitMs: number; readonly writeMs: number; readonly readMs: number; readonly savedAtMs: number };
  readonly receipt: Receipt | null;
}

export interface Finaliser {
  phase: FinalisePhase;
  saved: SavedBill | null;
  error: string | null;
  finalise: (draft: BillDraft) => Promise<void>;
  /** Back to idle - "New bill". */
  clear: () => void;
}

export function useFinalise({ localDb, shopId, deviceId, getNumber, onSaved }: UseFinaliseOptions): Finaliser {
  const [phase, setPhase] = useState<FinalisePhase>("idle");
  const [saved, setSaved] = useState<SavedBill | null>(null);
  const busy = useRef(false);

  const finalise = useCallback(
    async (draft: BillDraft) => {
      if (busy.current || !localDb || !shopId || !deviceId) return;
      busy.current = true;
      setPhase("saving");
      try {
        // KB-351: ONE bounded round trip for the shop's next number; never an error and never "pending" - an offline number instead.
        const t0 = performance.now();
        const got = (await getNumber?.(draft.localId).catch(() => null)) ?? null;
        const t1 = performance.now();
        const result = await finaliseBill(localDb, { ...draft, shopId, deviceId, serverNumber: got?.receiptNumber ?? null });
        const t2 = performance.now();
        // KB-308: the receipt from the bill as stored. A failed read never
        // turns a saved bill into "failed" - the status line still shows it.
        const receipt = await loadReceipt(localDb, draft.localId).catch((err: unknown) => {
          console.warn("[receipt] read failed:", err instanceof Error ? err.message : err);
          return null;
        });
        const t3 = performance.now();
        setSaved({
          localId: draft.localId, receiptNumber: result.receiptNumber, numberMs: result.source === "counter" ? (got?.ms ?? null) : null,
          phases: { numberWaitMs: t1 - t0, writeMs: t2 - t1, readMs: t3 - t2, savedAtMs: t3 }, receipt,
        });
        setPhase("saved");
        // KB-352: nothing else runs before the receipt paints; the after-save work starts a frame later and is never awaited.
        afterPaintOrSoon(() => {
          try {
            void Promise.resolve(onSaved?.(result, draft.localId)).catch((err: unknown) => console.warn("[finalise] after-save step failed:", err instanceof Error ? err.message : err));
          } catch (err) {
            console.warn("[finalise] after-save step failed:", err instanceof Error ? err.message : err);
          }
        });
      } catch (err) {
        console.warn("[finalise] save failed:", err instanceof Error ? err.message : err);
        setPhase("failed");
      } finally {
        busy.current = false;
      }
    },
    [deviceId, getNumber, localDb, onSaved, shopId],
  );

  const clear = useCallback(() => {
    setSaved(null);
    setPhase("idle");
  }, []);

  return { phase, saved, error: phase === "failed" ? SAVE_FAILED : null, finalise, clear };
}
