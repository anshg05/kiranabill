import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch b (26 §5 list row), as drawn on 17-More: a 60 px row (every row, the last too, carries its 1 px divider below,
// so 61 on screen), 14 px sides, gap 12; a 38 px pale tile (radius 11) with a 19 px primary icon; title 15 / 600 over an optional
// sub 13 sub (gap 1); an optional value 13 sub; the 18 px sub chevron. The whole row is the button.
export function ListRow({
  icon, title, sub, value, onClick,
}: { icon: LucideIcon; title: string; sub?: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="font-kb kb-hit w-full flex items-center gap-3 min-h-[61px] px-[14px] text-left text-kb-ink border-b border-kb-border">
      <span className="w-[38px] h-[38px] flex-none rounded-[11px] bg-kb-primary-pale text-kb-primary flex items-center justify-center">
        <Icon icon={icon} size={19} />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span className="text-kb-15 font-semibold">{title}</span>
        {sub && <span className="text-kb-13 text-kb-sub">{sub}</span>}
      </span>
      {value && <span className="flex-none whitespace-nowrap text-kb-13 text-kb-sub">{value}</span>}
      <Icon icon={KB_ICONS.ChevronRight} size={18} className="text-kb-sub" />
    </button>
  );
}

/** 17-More: the white card the rows sit in (radius 16, 1 px border, rows clipped to its corners). */
export function ListCard({ children }: { children: ReactNode }) {
  return <div className="bg-kb-card border border-kb-border rounded-[16px] overflow-hidden">{children}</div>;
}

/** 26 §2.2 group label ("BILLING", "PAPER SIZE"): 12 / 700 sub, 0.5 tracking, upper case, 4 px in. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="font-kb text-kb-12 font-bold text-kb-sub tracking-[.5px] uppercase px-1">{children}</div>;
}
