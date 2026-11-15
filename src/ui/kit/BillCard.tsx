import { Icon, KB_ICONS } from "./icons";

// KB-412 batch c (26 §5 bill card), as drawn on 14-BillsList: a white card (radius 16, 10 / 10 / 10 / 14, gap 12) holding two
// buttons - the bill itself (min 48 high: a 42 px pale tile with the 20 px receipt, title 15 / 700, a 13 sub line, the amount
// 16 / 800) and a separate 42 px print button (19 px printer). Cancelled: a muted tile, the red chip after the title, the amount
// struck through in sub. All words come from the screen. At 360 px + 130% text the bill number never breaks, the words shrink and wrap
// (the chip moves under the number), the amount and the print button never shrink (reviewer, 15 Nov 2026).
export function BillCard({
  title, meta, amount, cancelledLabel, onOpen, printLabel, onPrint,
}: {
  title: string;
  meta: string;
  amount: string;
  /** set = the bill is cancelled; the chip's words */
  cancelledLabel?: string;
  onOpen: () => void;
  printLabel: string;
  onPrint: () => void;
}) {
  const cancelled = cancelledLabel !== undefined;
  return (
    <div className="font-kb flex items-center gap-3 bg-kb-card border border-kb-border rounded-[16px] py-[10px] pr-[10px] pl-[14px] text-kb-ink">
      <button type="button" onClick={onOpen} className="kb-hit flex-1 min-w-0 flex items-center gap-3 min-h-[48px] text-left">
        <span className={`w-[42px] h-[42px] flex-none rounded-[12px] flex items-center justify-center ${cancelled ? "bg-kb-muted text-kb-sub" : "bg-kb-primary-pale text-kb-primary"}`}>
          <Icon icon={KB_ICONS.ReceiptText} size={20} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-[2px]">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-kb-15 font-bold whitespace-nowrap">{title}</span>
            {cancelled && <span className="whitespace-nowrap bg-kb-err-pale text-kb-err rounded-full px-2 py-[2px] text-kb-11 font-bold">{cancelledLabel}</span>}
          </span>
          <span className="text-kb-13 text-kb-sub">{meta}</span>
        </span>
        <span className={`flex-none whitespace-nowrap text-kb-16 font-extrabold ${cancelled ? "line-through text-kb-sub" : ""}`}>{amount}</span>
      </button>
      <button type="button" aria-label={printLabel} onClick={onPrint} className="kb-hit-icon w-[42px] h-[42px] flex-none rounded-[12px] border border-kb-border bg-kb-card text-kb-ink flex items-center justify-center">
        <Icon icon={KB_ICONS.Printer} size={19} />
      </button>
    </div>
  );
}
