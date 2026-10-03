import { useCallback, useRef, useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import { finaliseBill, SAVE_FAILED, type FinaliseResult } from "@/data/finalise";
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

export interface Finaliser {
  phase: FinalisePhase;
  saved: { receiptNumber: string } | null;
  error: string | null;
  finalise: (draft: BillDraft) => Promise<void>;
  /** Back to idle - "New bill". */
  clear: () => void;
}

export function useFinalise({ localDb, shopId, deviceId, onSaved }: UseFinaliseOptions): Finaliser {
  const [phase, setPhase] = useState<FinalisePhase>("idle");
  const [saved, setSaved] = useState<{ receiptNumber: string } | null>(null);
  const busy = useRef(false);

  const finalise = useCallback(
    async (draft: BillDraft) => {
      if (busy.current || !localDb || !shopId || !deviceId) return;
      busy.current = true;
      setPhase("saving");
      try {
        const result = await finaliseBill(localDb, { ...draft, shopId, deviceId });
        setSaved({ receiptNumber: result.receiptNumber });
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
