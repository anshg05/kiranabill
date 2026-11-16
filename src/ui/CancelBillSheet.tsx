import { useState } from "react";
import { CANCEL_REASONS, REASON_LABEL, type CancelReason } from "@/domain/cancelBill";
import { BottomSheet } from "./kit/BottomSheet";
import { Button } from "./kit/Button";
import { CHOICE_RADIO } from "./kit/Chip";
import { KB_ICONS } from "./kit/icons";
import { ReceiptNumberText } from "./Receipt";
import { inject, mark } from "./inject";
import { useT } from "./useT";

// KB-325 (D79): cancel a saved bill - five preset reasons (nothing to type), then "Cancel & make corrected bill" or
// "Cancel only". Not mid-bill, and irreversible, so a confirm step is right here (hard rule 6 is about questions
// DURING a bill). The bill itself is never edited (hard rule 2): the cancel changes its status only.
// KB-414 step 2: 25-CancelBill's bottom sheet - the reasons as its chips (one required: a radiogroup), its "Why not just edit?" card,
// the red "Cancel & make corrected bill", today's "Cancel only" (not drawn - kept, D110 item 9) and "Keep Bill N".

interface Props {
  receiptNumber: string;
  /** A bill is being built on the billing screen: the reissue would have to replace it, so it waits. */
  billInProgress: boolean;
  /** Resolves with an error text, or null when the bill was cancelled. */
  onCancel: (reason: CancelReason, withReplacement: boolean) => Promise<string | null>;
  onClose: () => void;
}

export function CancelBillSheet({ receiptNumber, billInProgress, onCancel, onClose }: Props) {
  const { t, tx } = useT();
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
  const number = <ReceiptNumberText value={receiptNumber} />;

  return (
    <BottomSheet backKey="kbCancelBill" title={t("cancel.title", { n: receiptNumber })} intro={t("cancel.note")} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <p id="kb-cancel-reason" className="text-kb-14 font-semibold">{t("cancel.reasonLabel")}</p>
        <div role="radiogroup" aria-labelledby="kb-cancel-reason" className="flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => (
            <label key={r} className={CHOICE_RADIO}>
              <input type="radio" name="cancel-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
              {tx(REASON_LABEL[r])}
            </label>
          ))}
        </div>
      </div>
      <div className="rounded-[16px] border border-kb-border bg-kb-card px-[14px] py-3 text-kb-14 leading-[1.5] text-kb-sub">
        <b className="text-kb-ink">{t("cancel.whyNotTitle")}</b> {t("cancel.whyNotEdit")}
      </div>
      {billInProgress && <p className="text-kb-13 text-kb-sub">{t("cancel.inProgress")}</p>}
      {error && (
        <p role="alert" className="text-kb-13 text-kb-err">
          {tx(error)}
        </p>
      )}
      <div className="flex flex-col gap-[10px]">
        {reason === null && <p className="text-center text-kb-13 text-kb-sub">{t("reason.cancelReason")}</p>}
        <Button variant="destructive" icon={KB_ICONS.RotateCcw} iconSize={20} ariaDisabled={!ready || billInProgress} onClick={ready && !billInProgress ? () => void run(true) : undefined}>
          {t("cancel.andNew")}
        </Button>
        <Button variant="destructive-outline" ariaDisabled={!ready} onClick={ready ? () => void run(false) : undefined}>
          {t("cancel.only")}
        </Button>
        <Button variant="tertiary" onClick={onClose}>
          {inject(t("cancel.keep", { n: mark("n") }), { n: number })}
        </Button>
      </div>
    </BottomSheet>
  );
}
