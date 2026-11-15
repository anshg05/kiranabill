import { CASH } from "@/domain/customer";
import type { Receipt as ReceiptModel } from "@/domain/receipt";
import { Icon, KB_ICONS } from "./kit/icons";
import { ReceiptPaper } from "./kit/ReceiptPaper";
import { PrintButton } from "./PrintButton";
import { Receipt, ReceiptNumberText } from "./Receipt";
import { ShareBar } from "./ShareBar";
import { useBackEntry } from "./useBackEntry";
import type { ReceiptShare } from "./useReceiptShare";
import { useT } from "./useT";

// KB-413 step 4 (owner, 16 Nov 2026): 13-BillSaved. The tick pops; "Bill 515 saved"; "3 items · Cash · 1:18 pm" (the stored receipt's
// own rows, customer and time); the receipt prints out on its torn paper (1.2 s; reduced motion: there at once) and scrolls when long;
// Print bill (today's PrintButton - the first copy is the original, later ones REPRINT); WhatsApp / PDF / Share / SMS; Start a new bill.
// Owner's answers: no top bar (the menu is on 12, one tap away), Android Back = Start a new bill, no Add item here.
export function BillSavedScreen({ receipt, receiptNumber, share, onNewBill }: { receipt: ReceiptModel; receiptNumber: string; share: ReceiptShare | null; onNewBill?: () => void }) {
  const { t } = useT();
  useBackEntry("kbSaved", () => onNewBill?.());
  const time = (receipt.dateTime.split(" | ")[1] ?? "").toLowerCase(); // the receipt's "11-11-2026 | 1:18 PM" -> "1:18 pm", as drawn
  const customer = receipt.customer ?? CASH;
  const n = receipt.rows.length;
  return (
    <div className="font-kb h-dvh bg-kb-bg text-kb-ink">
      <div className="mx-auto flex h-full w-full max-w-[480px] flex-col">
        <div className="flex flex-col items-center gap-2 px-5 pt-[26px] pb-2 text-center">
          <div data-saved-tick className="flex size-16 items-center justify-center rounded-full bg-kb-ok text-kb-card shadow-kb-ok animate-kb-pop">
            <Icon icon={KB_ICONS.Check} size={32} strokeWidth={2.6} />
          </div>
          <p role="status" aria-label={t("bill.savedLabel")} className="text-kb-22 font-extrabold">
            {t("bill.savedBefore")} <ReceiptNumberText value={receiptNumber} /> {t("bill.savedAfter")}
          </p>
          <p className="text-kb-14 text-kb-sub">{n === 1 ? t("saved.subOne", { customer, time }) : t("saved.subMany", { n, customer, time })}</p>
        </div>
        {/* data-scroll-list: a long bill scrolls here by design - the dev sheets count what its edge cuts apart from real clipping */}
        <div data-scroll-list className="flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pt-[6px] pb-[22px]">
          <div className="h-fit">
            <ReceiptPaper width={320} torn print>
              <Receipt receipt={receipt} />
            </ReceiptPaper>
          </div>
        </div>
        <div className="safe-bottom flex flex-col gap-[10px] px-[18px] pt-[14px] pb-6">
          <PrintButton key={receiptNumber} receipt={receipt} firstIsOriginal look="primary" />
          {share && <ShareBar share={share} look="tiles" />}
          <button type="button" onClick={onNewBill} className="kb-hit kb-press flex min-h-[46px] items-center justify-center text-kb-15 font-bold text-kb-primary">
            {t("saved.startNew")}
          </button>
        </div>
      </div>
    </div>
  );
}
