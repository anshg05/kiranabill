import type { ReactNode } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 (26 §5 chips), as drawn (buttons - the border is inside the drawn height, as a browser draws a button): filter 14-BillsList / 16-Items, choice 25-CancelBill (the reasons), removable + add 19-AddItem.

export function FilterChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`font-kb flex-none min-h-[38px] px-[14px] rounded-full border text-kb-14 font-semibold ${
        selected ? "border-transparent bg-kb-primary text-kb-card" : "border-kb-border bg-kb-card text-kb-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function ChoiceChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`font-kb min-h-[40px] px-[14px] rounded-full text-kb-14 font-semibold ${
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
      <button type="button" aria-label={removeLabel} onClick={onRemove} className="w-[26px] h-[26px] rounded-full text-kb-sub flex items-center justify-center">
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
      className="font-kb inline-flex items-center gap-[6px] min-h-[34px] px-3 rounded-full border-[1.5px] border-dashed border-kb-border bg-transparent text-kb-primary text-kb-14 font-bold"
    >
      <Icon icon={KB_ICONS.Plus} size={15} />
      {children}
    </button>
  );
}
