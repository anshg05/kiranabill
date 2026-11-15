import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch b (26 §5 tip card), as drawn:
//   warm        11-Generating "DID YOU KNOW": warn background, radius 16, 14 / 16 padding, the 20 px bulb in warn text (1 px down),
//               a 13 / 700 heading over 14 / 1.5 words, all warn text;
//   white       22-PrinterSearch "Not listed?": white card, border, radius 16, 14 padding, the amber bulb, 14 / 1.5 sub words;
//   white-dense 09-Recording: the same card at 12 / 14 padding, 10 apart, centred, 14 sub words (normal line height);
//   note        10-Review: the white card at 14 / 16 padding, the 20 px primary icon (the ear) 2 px down, 14 / 1.5 sub words.
export function TipCard({ variant, title, icon, children }: { variant: "warm" | "white" | "white-dense" | "note"; title?: string; icon?: LucideIcon; children: ReactNode }) {
  if (variant === "warm") {
    return (
      <div className="font-kb flex gap-3 items-start bg-kb-warn-bg rounded-[16px] py-[14px] px-4">
        <span className="text-kb-warn-text mt-px"><Icon icon={KB_ICONS.Lightbulb} size={20} /></span>
        <span className="flex flex-col gap-[2px]">
          {title && <span className="text-kb-13 font-bold text-kb-warn-text">{title}</span>}
          <span className="text-kb-14 text-kb-warn-text leading-[1.5]">{children}</span>
        </span>
      </div>
    );
  }
  if (variant === "note") {
    return (
      <div className="font-kb flex gap-3 items-start bg-kb-card border border-kb-border rounded-[16px] py-[14px] px-4">
        <span className="text-kb-primary mt-[2px]"><Icon icon={icon ?? KB_ICONS.Ear} size={20} /></span>
        <span className="text-kb-14 text-kb-sub leading-[1.5]">{children}</span>
      </div>
    );
  }
  const dense = variant === "white-dense";
  return (
    <div className={`font-kb flex bg-kb-card border border-kb-border rounded-[16px] ${dense ? "gap-[10px] py-3 px-[14px] items-center" : "gap-3 p-[14px] items-start"}`}>
      <span className="text-kb-amber"><Icon icon={KB_ICONS.Lightbulb} size={20} /></span>
      <span className={`text-kb-14 text-kb-sub ${dense ? "" : "leading-[1.5]"}`}>{children}</span>
    </div>
  );
}
