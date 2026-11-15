import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch b (26 §5). TopBar as drawn on the inner screens (12-BillReview, 18-Printer, 24-Offline): 12 / 12 / 4 padding, a
// 44 px back button with the 24 px chevron, the title 18 / 700, an optional badge 8 px from the right edge; no coloured background.
export function TopBar({ title, backLabel, onBack, right }: { title: string; backLabel: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="font-kb flex items-center gap-1 pt-3 px-3 pb-1 text-kb-ink">
      <button type="button" aria-label={backLabel} onClick={onBack} className="kb-hit-icon w-11 h-11 flex-none flex items-center justify-center text-kb-ink">
        <Icon icon={KB_ICONS.ChevronLeft} size={24} />
      </button>
      <h1 className="flex-1 min-w-0 text-kb-18 font-bold">{title}</h1>
      {right && <div className="flex-none mr-2">{right}</div>}
    </header>
  );
}

// ScreenTitle as drawn on the tab screens (14-BillsList, 16-Items, 17-More): 18 / 18 / 6 padding, 26 / 800 at -0.5; 16's "+ Add" is a
// small primary button (44 high, radius 12, 14 / 700, plus 18, no shadow).
export function ScreenTitle({ title, action }: { title: string; action?: { label: string; icon: LucideIcon; onClick: () => void } }) {
  return (
    <div className="font-kb flex items-center justify-between pt-[18px] px-[18px] pb-[6px] text-kb-ink">
      <h1 className="text-kb-26 font-extrabold tracking-[-0.5px]">{title}</h1>
      {action && (
        <button type="button" onClick={action.onClick} className="kb-hit kb-press flex items-center gap-[6px] min-h-[44px] px-[14px] rounded-[12px] bg-kb-primary text-kb-card text-kb-14 font-bold">
          <Icon icon={action.icon} size={18} />
          {action.label}
        </button>
      )}
    </div>
  );
}
