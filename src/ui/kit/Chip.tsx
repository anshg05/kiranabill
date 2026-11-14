import type { FocusEvent, ReactNode } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 (26 §5 chips), as drawn (buttons - the border is inside the drawn height, as a browser draws a button): filter 14-BillsList / 16-Items, choice 25-CancelBill (the reasons), removable + add 19-AddItem.

export function FilterChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`font-kb kb-hit flex-none min-h-[38px] px-[14px] rounded-full border text-kb-14 font-semibold ${
        selected ? "border-transparent bg-kb-primary text-kb-card" : "border-kb-border bg-kb-card text-kb-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** 14-BillsList / 16-Items: one line of filter chips that scrolls sideways (owner, 14 Nov 2026) - no scrollbar, the cut-off chip
 *  hints at more, a chip reached by the keyboard scrolls into view. 5 px inside top and bottom (taken back by the margin) keep the
 *  chips' 48 px tap areas inside the scroller - nothing moves. The screen adds the row's own padding. */
export function FilterChipRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const onFocus = (e: FocusEvent<HTMLDivElement>) => e.target.scrollIntoView({ block: "nearest", inline: "nearest" });
  return (
    <div onFocus={onFocus} className={`flex gap-2 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-[5px] -my-[5px] ${className}`}>
      {children}
    </div>
  );
}

export function ChoiceChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`font-kb kb-hit min-h-[40px] px-[14px] rounded-full text-kb-14 font-semibold ${
        selected ? "border-0 bg-kb-primary-pale text-kb-primary" : "border border-kb-border bg-kb-card text-kb-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function RemovableChip({ removeLabel, onRemove, children }: { removeLabel: string; onRemove: () => void; children: ReactNode }) {
  return (
    <span className="font-kb inline-flex items-center gap-[6px] min-h-[34px] pl-3 pr-[6px] rounded-full bg-kb-primary-pale text-kb-ink text-kb-14 font-semibold">
      {children}
      <button type="button" aria-label={removeLabel} onClick={onRemove} className="kb-hit-icon w-[26px] h-[26px] rounded-full text-kb-sub flex items-center justify-center">
        <Icon icon={KB_ICONS.X} size={14} />
      </button>
    </span>
  );
}

export function AddChip({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-kb kb-hit inline-flex items-center gap-[6px] min-h-[34px] px-3 rounded-full border-[1.5px] border-dashed border-kb-border bg-transparent text-kb-primary text-kb-14 font-bold"
    >
      <Icon icon={KB_ICONS.Plus} size={15} />
      {children}
    </button>
  );
}
