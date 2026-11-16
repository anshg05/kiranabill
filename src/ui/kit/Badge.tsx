import type { ReactNode } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 (26 §5 status badges), as drawn: draft 12-BillReview, saved 15-BillDetail (tick 13 px, stroke 2.4), almost done
// 06-ShopSetup, recording 09-Recording (blinking 9 px dot), small 07-Permissions ("Required" / "For printing").
// paused: NOT drawn - the reviewer's choice (14 Nov 2026): the Recording shape in the warning colours, the dot still.
// cancelled 14-BillsList ("Cancelled" by the bill's number: 11 / 700, 2 / 8 padding, error pale) - also 15's top bar for a cancelled bill.
export type BadgeKind = "draft" | "saved" | "almost" | "recording" | "paused" | "small" | "cancelled";

const LOOK: Record<BadgeKind, string> = {
  draft: "bg-kb-muted text-kb-sub px-[10px] py-[5px] text-kb-12",
  saved: "bg-kb-ok-pale text-kb-ok px-[10px] py-[5px] text-kb-12 gap-[6px]",
  almost: "bg-kb-primary-pale text-kb-primary px-[10px] py-[5px] text-kb-12",
  recording: "bg-kb-err-pale text-kb-err px-[14px] py-[7px] text-kb-14 gap-2",
  paused: "bg-kb-warn-bg text-kb-warn-text px-[14px] py-[7px] text-kb-14 gap-2",
  small: "bg-kb-muted text-kb-sub px-2 py-[2px] text-kb-11",
  cancelled: "bg-kb-err-pale text-kb-err px-2 py-[2px] text-kb-11",
};

export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return (
    <span className={`font-kb whitespace-nowrap inline-flex items-center rounded-full font-bold ${LOOK[kind]}`}>
      {kind === "saved" && <Icon icon={KB_ICONS.Check} size={13} strokeWidth={2.4} />}
      {kind === "recording" && <span className="w-[9px] h-[9px] rounded-full bg-kb-err animate-kb-blink" aria-hidden="true" />}
      {kind === "paused" && <span className="w-[9px] h-[9px] rounded-full bg-kb-warn-text" aria-hidden="true" />}
      {children}
    </span>
  );
}
