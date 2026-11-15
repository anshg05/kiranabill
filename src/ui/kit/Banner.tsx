import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch b (26 §5 banners), as drawn. A warning banner is named in 26 §5 but drawn on no screen - asked, not built.

/** 24-Offline: the full-width strip at the top - ink, white 14 / 600, the 18 px wifi-off icon, 10 / 16 padding. */
export function OfflineStrip({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="font-kb flex items-center gap-[10px] bg-kb-ink text-kb-card px-4 py-[10px] text-kb-14 font-semibold">
      <Icon icon={KB_ICONS.WifiOff} size={18} />
      {children}
    </div>
  );
}

/** 24-Offline "Order saved · will send when online": pale blue, the pale-blue line, radius 18, 14 padding; a 46 px white tile
 *  (radius 14) with a 22 px primary icon; title 16 / 700 over 13 sub; busy = the 18 px spinner on the right. */
export function InfoBanner({ icon, title, sub, busy = false }: { icon: LucideIcon; title: string; sub?: string; busy?: boolean }) {
  return (
    <div className="font-kb flex gap-3 items-center bg-kb-primary-pale border border-kb-primary-line rounded-[18px] p-[14px] text-kb-ink">
      <span className="w-[46px] h-[46px] flex-none rounded-[14px] bg-kb-card text-kb-primary flex items-center justify-center">
        <Icon icon={icon} size={22} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-kb-16 font-bold">{title}</span>
        {sub && <span className="block text-kb-13 text-kb-sub">{sub}</span>}
      </span>
      {busy && <span aria-hidden="true" className="w-[18px] h-[18px] flex-none rounded-full border-[2.5px] border-kb-spinner-track border-t-kb-primary animate-kb-spin" />}
    </div>
  );
}

/** 16-Items "3 prices learned from your bills": a banner that opens a screen - pale blue to white at 120°, the pale-blue line,
 *  radius 16, 12 / 14 padding; a 40 px primary tile (radius 12) with a white 20 px icon; title 15 / 700 over 13 sub; chevron 20. */
export function LinkBanner({ icon, title, sub, onClick }: { icon: LucideIcon; title: string; sub?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-kb kb-hit w-full flex items-center gap-3 bg-linear-[120deg] from-kb-primary-pale to-kb-card border border-kb-primary-line rounded-[16px] py-3 px-[14px] text-left text-kb-ink"
    >
      <span className="w-10 h-10 flex-none rounded-[12px] bg-kb-primary text-kb-card flex items-center justify-center">
        <Icon icon={icon} size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-kb-15 font-bold">{title}</span>
        {sub && <span className="block text-kb-13 text-kb-sub">{sub}</span>}
      </span>
      <Icon icon={KB_ICONS.ChevronRight} size={20} className="text-kb-sub" />
    </button>
  );
}
