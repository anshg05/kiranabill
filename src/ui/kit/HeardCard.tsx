import { useState } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch c (26 §5 Heard card), as drawn on 12-BillReview: shown for every recording (KB-385). White card, radius 16, 10 / 14,
// gap 10, top-aligned; the 18 px ear in sub (2 px down); "Heard:" in ink, then the words 13 sub at 1.5, two lines until opened; the
// 18 px chevron opens and closes the rest. Every word comes from the screen.
export function HeardCard({ label, text, expandLabel, collapseLabel }: { label: string; text: string; expandLabel: string; collapseLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="font-kb flex gap-[10px] items-start bg-kb-card border border-kb-border rounded-[16px] py-[10px] px-[14px]">
      <span className="text-kb-sub mt-[2px]"><Icon icon={KB_ICONS.Ear} size={18} /></span>
      <p className={`flex-1 text-kb-13 text-kb-sub leading-[1.5] ${open ? "" : "line-clamp-2"}`}>
        <b className="text-kb-ink">{label}</b> {text}
      </p>
      <button type="button" aria-label={open ? collapseLabel : expandLabel} aria-expanded={open} onClick={() => setOpen(!open)} className="kb-hit-icon text-kb-sub">
        <Icon icon={KB_ICONS.ChevronDown} size={18} className={open ? "rotate-180" : ""} />
      </button>
    </div>
  );
}
