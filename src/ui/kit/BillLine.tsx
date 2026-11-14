import { useId } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch c (26 §5), as drawn on 12-BillReview. Every word (the name as said, the detail, the mark, the labels) comes from the
// screen: the kit decides the look only, never what a line says or whether a price is a rate or an amount (D110 item 8.8).

/** A draft bill line: white card, radius 16, 12 / 14, gap 12; the name 17 / 600 over the detail 14 sub (gap 3) with an optional
 *  mark (a pale pill, the 11 px star, 11 / 700) for a price our code filled; the amount 17 / 800; a 40 px muted edit button. */
export function BillLine({
  name, detail, amount, mark, editLabel, onEdit,
}: { name: string; detail: string; amount: string; mark?: string; editLabel: string; onEdit: () => void }) {
  return (
    <div className="font-kb flex items-center gap-3 bg-kb-card border border-kb-border rounded-[16px] py-3 px-[14px] text-kb-ink">
      <div className="flex-1 flex flex-col gap-[3px]">
        <div className="text-kb-17 font-semibold">{name}</div>
        <div className="flex items-center gap-2">
          <span className="text-kb-14 text-kb-sub">{detail}</span>
          {mark && (
            <span className="inline-flex items-center gap-1 bg-kb-primary-pale text-kb-primary rounded-full px-2 py-[2px] text-kb-11 font-bold">
              <Icon icon={KB_ICONS.Sparkles} size={11} />
              {mark}
            </span>
          )}
        </div>
      </div>
      <div className="text-kb-17 font-extrabold">{amount}</div>
      <button type="button" aria-label={editLabel} onClick={onEdit} className="kb-hit-icon w-10 h-10 flex-none rounded-[10px] bg-kb-muted text-kb-sub flex items-center justify-center">
        <Icon icon={KB_ICONS.Pencil} size={17} />
      </button>
    </div>
  );
}

/** A line waiting for its price (a pending check - Bill Banao stays locked): warn background, 1.5 px warn border, radius 16, 12 / 14,
 *  gap 10; the name 17 / 600 over the detail 14 in warn text; the warning icon 17 + "Price needed" 14 / 700 in warn text; an inline
 *  ₹ field (48 high + its border, as the file sizes it; radius 12, the warn-field border) with its own label, and the ink Add button (48, radius 12, 15 / 700). */
export function PriceNeededLine({
  name, detail, needLabel, inputLabel, placeholder, value, onChange, addLabel, onAdd,
}: {
  name: string;
  detail: string;
  needLabel: string;
  inputLabel: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  addLabel: string;
  onAdd: () => void;
}) {
  const id = useId();
  return (
    <div className="font-kb bg-kb-warn-bg border-[1.5px] border-kb-warn-border rounded-[16px] py-3 px-[14px] flex flex-col gap-[10px] text-kb-ink">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[3px]">
          <div className="text-kb-17 font-semibold">{name}</div>
          <div className="text-kb-14 text-kb-warn-text">{detail}</div>
        </div>
        <div className="flex items-center gap-[6px] text-kb-warn-text text-kb-14 font-bold">
          <Icon icon={KB_ICONS.TriangleAlert} size={17} />
          {needLabel}
        </div>
      </div>
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">{inputLabel}</label>
        <div className="box-content flex-1 min-w-0 flex items-center gap-[6px] min-h-[48px] rounded-[12px] bg-kb-card border border-kb-warn-field px-3">
          <span className="text-kb-sub">₹</span>
          <input id={id} inputMode="decimal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 min-w-0 border-0 outline-none bg-transparent text-kb-16 text-kb-ink placeholder:text-kb-sub" />
        </div>
        <button type="button" onClick={onAdd} className="kb-hit kb-press min-h-[48px] px-4 rounded-[12px] bg-kb-ink text-kb-card text-kb-15 font-bold">{addLabel}</button>
      </div>
    </div>
  );
}
