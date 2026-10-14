import { useState } from "react";
import { CANCEL_REASONS, REASON_LABEL, type CancelReason } from "@/domain/cancelBill";
import { useBackEntry } from "./useBackEntry";
import { ReceiptNumberText } from "./Receipt";

// KB-325 (D79): cancel a saved bill - five preset reasons (nothing to type), then "Cancel and make a new bill" or
// "Cancel only". Not mid-bill, and irreversible, so a confirm step is right here (hard rule 6 is about questions
// DURING a bill). The bill itself is never edited (hard rule 2): the cancel changes its status only.

interface Props {
  receiptNumber: string;
  /** A bill is being built on the billing screen: the reissue would have to replace it, so it waits. */
  billInProgress: boolean;
  /** Resolves with an error text, or null when the bill was cancelled. */
  onCancel: (reason: CancelReason, withReplacement: boolean) => Promise<string | null>;
  onClose: () => void;
}

export function CancelBillSheet({ receiptNumber, billInProgress, onCancel, onClose }: Props) {
  useBackEntry("kbCancelBill", onClose);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (withReplacement: boolean) => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await onCancel(reason, withReplacement));
    } catch {
      setError("Couldn't cancel the bill — try again");
    } finally {
      setBusy(false);
    }
  };
  const ready = reason !== null && !busy;
  const btn = "min-h-11 w-full rounded-[6px] px-4 font-medium aria-disabled:opacity-50";

  return (
    <section aria-label="Cancel bill" className="fixed inset-0 z-40 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <h2 className="text-[20px] font-semibold">
            Cancel Bill <ReceiptNumberText value={receiptNumber} />?
          </h2>
          <p className="mt-2 text-[13px] text-ink-soft">
            The bill stays in History, marked Cancelled. Its number is not used again. This cannot be undone.
          </p>
          <div role="radiogroup" aria-label="Reason" className="mt-4 flex flex-col gap-2">
            {CANCEL_REASONS.map((r) => (
              <label key={r} className="flex min-h-11 cursor-pointer items-center rounded-[6px] border border-line px-3 has-checked:border-ink has-checked:bg-ink has-checked:text-paper">
                <input type="radio" name="cancel-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                {REASON_LABEL[r]}
              </label>
            ))}
          </div>
          {billInProgress && (
            <p className="mt-4 text-[13px] text-ink-soft">A bill is in progress — finish it or clear it first to make the new bill.</p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            aria-disabled={!ready || billInProgress}
            onClick={ready && !billInProgress ? () => void run(true) : undefined}
            className={`${btn} bg-ink text-paper`}
          >
            Cancel and make a new bill
          </button>
          <button
            type="button"
            aria-disabled={!ready}
            onClick={ready ? () => void run(false) : undefined}
            className={`${btn} border border-danger bg-transparent text-danger`}
          >
            Cancel only
          </button>
          <button type="button" onClick={onClose} className={`${btn} border border-line bg-surface`}>
            Keep the bill
          </button>
        </div>
      </div>
    </section>
  );
}
