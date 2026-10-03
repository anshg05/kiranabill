import { useCallback, useRef, useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import { finaliseBill, SAVE_FAILED, type FinaliseResult } from "@/data/finalise";
import { loadReceipt } from "@/data/receipt";
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
  /** After the bill is committed - the block top-up and a sync. Never awaited. */
  onSaved?: (result: FinaliseResult) => void;
}

/** KB-308: the saved bill's receipt, read back from the device (null if that read failed - the bill is still saved). */
export interface SavedBill {
  readonly receiptNumber: string;
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

export function useFinalise({ localDb, shopId, deviceId, onSaved }: UseFinaliseOptions): Finaliser {
  const [phase, setPhase] = useState<FinalisePhase>("idle");
  const [saved, setSaved] = useState<SavedBill | null>(null);
  const busy = useRef(false);

  const finalise = useCallback(
    async (draft: BillDraft) => {
      if (busy.current || !localDb || !shopId || !deviceId) return;
      busy.current = true;
      setPhase("saving");
      try {
        const result = await finaliseBill(localDb, { ...draft, shopId, deviceId });
        // KB-308: the receipt from the bill as stored. A failed read never
        // turns a saved bill into "failed" - the status line still shows it.
        const receipt = await loadReceipt(localDb, draft.localId).catch((err: unknown) => {
          console.warn("[receipt] read failed:", err instanceof Error ? err.message : err);
          return null;
        });
        setSaved({ receiptNumber: result.receiptNumber, receipt });
        setPhase("saved");
        onSaved?.(result);
      } catch (err) {
        console.warn("[finalise] save failed:", err instanceof Error ? err.message : err);
        setPhase("failed");
      } finally {
        busy.current = false;
      }
    },
    [deviceId, localDb, onSaved, shopId],
  );

  const clear = useCallback(() => {
    setSaved(null);
    setPhase("idle");
  }, []);

  return { phase, saved, error: phase === "failed" ? SAVE_FAILED : null, finalise, clear };
}
