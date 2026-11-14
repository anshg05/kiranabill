import type { LucideIcon } from "lucide-react";
import { Icon } from "./icons";

// KB-412 batch b (26 §5 bottom navigation), as drawn on 08 / 14 / 16 / 17 / 26: a white bar with a top border, 2 / 6 / 8 padding
// (8 at the bottom, or the phone's home-bar inset when that is larger), four 58 px tabs, icon 22 above a 12 px label (gap 3). The
// active tab is primary, 700, on a pale pill (4 / 16 padding) that fades in (kb-tab); the others sub, 500.
export type NavItem = { key: string; label: string; icon: LucideIcon; active: boolean; onClick: () => void };

export function BottomNav({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <nav aria-label={label} className="font-kb flex bg-kb-card border-t border-kb-border px-[6px] pt-[2px] pb-[max(8px,env(safe-area-inset-bottom))]">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-current={it.active ? "page" : undefined}
          onClick={it.onClick}
          className={`kb-hit flex-1 min-h-[58px] flex flex-col items-center justify-center gap-[3px] text-kb-12 ${it.active ? "text-kb-primary font-bold" : "text-kb-sub font-medium"}`}
        >
          <span className={`kb-tab flex py-1 px-4 rounded-full ${it.active ? "bg-kb-primary-pale" : ""}`}>
            <Icon icon={it.icon} size={22} />
          </span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
