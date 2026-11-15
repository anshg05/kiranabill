import { useId, type ReactNode } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 batch c (26 §5), as drawn on 12-BillReview. Every word (the name as said, the detail, the mark, the labels) comes from the
// screen: the kit decides the look only, never what a line says or whether a price is a rate or an amount (D110 item 8.8). Words
// shrink and wrap on the left; amounts, labels and buttons on the right never shrink; the mark never breaks and moves under the detail
// when the row is full (reviewer, 15 Nov 2026).

/** KB-413 step 1 (owner, 15 Nov 2026, answer 8): a line with an open check takes the Price needed line's pattern - warn for a HIGH
 *  check (Theek hai), error for a BLOCK - and its check sits inside the card, under the line. */
const TONE = {
  normal: "bg-kb-card border border-kb-border",
  warn: "bg-kb-warn-bg border-[1.5px] border-kb-warn-border",
  err: "bg-kb-err-pale border-[1.5px] border-kb-err",
} as const;

/** A draft bill line: radius 16, 12 / 14, gap 12; the name 17 / 600 over the detail 14 sub (gap 3) with an optional mark (a pale
 *  pill, the 11 px star, 11 / 700) for a price our code filled; the amount 17 / 800; a 40 px muted edit button. */
export function BillLine({
  name, detail, amount, mark, editLabel, onEdit, tone = "normal", children,
}: {
  name: string;
  detail: string;
  amount: string;
  mark?: string;
  editLabel: string;
  onEdit?: () => void;
  tone?: keyof typeof TONE;
  /** rows under the line, inside the card (its check, a learned-name note) */
  children?: ReactNode;
}) {
  return (
    <div className={`font-kb rounded-[16px] py-3 px-[14px] text-kb-ink flex flex-col gap-[10px] ${TONE[tone]}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
          <div className="text-kb-17 font-semibold">{name}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-kb-14 ${tone === "normal" ? "text-kb-sub" : tone === "warn" ? "text-kb-warn-text" : "text-kb-err"}`}>{detail}</span>
            {mark && (
              <span className="flex-none whitespace-nowrap inline-flex items-center gap-1 bg-kb-primary-pale text-kb-primary rounded-full px-2 py-[2px] text-kb-11 font-bold">
                <Icon icon={KB_ICONS.Sparkles} size={11} />
                {mark}
              </span>
            )}
          </div>
        </div>
        <div className="flex-none whitespace-nowrap text-kb-17 font-extrabold">{amount}</div>
        {onEdit && (
          <button type="button" aria-label={editLabel} onClick={onEdit} className="kb-hit-icon w-10 h-10 flex-none rounded-[10px] bg-kb-muted text-kb-sub flex items-center justify-center">
            <Icon icon={KB_ICONS.Pencil} size={17} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** A line waiting for its price or quantity (a pending check - Bill Banao stays locked): warn background, 1.5 px warn border, radius
 *  16, 12 / 14, gap 10; the name 17 / 600 over the detail 14 in warn text; the warning icon 17 + "Price needed" 14 / 700 in warn text;
 *  an inline field (48 high + its border, as the file sizes it; radius 12, the warn-field border) with its own label, and the ink Add
 *  button (48, radius 12, 15 / 700). Enter adds too. A refused value keeps the field and says why under it. */
export function PriceNeededLine({
  name, detail, needLabel, inputLabel, placeholder, value, onChange, addLabel, onAdd, prefix = "₹", inputMode = "decimal", error, pendingTarget = false,
  editLabel, onEdit, children,
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
  /** "₹" for a price; none for a quantity */
  prefix?: string;
  inputMode?: "decimal" | "numeric";
  error?: string | null;
  /** KB-307: where a Bill Banao tap sends focus while this is what's missing */
  pendingTarget?: boolean;
  /** KB-413: the line's edit sheet stays reachable (change item, remove) - not drawn on 12, kept from today's app */
  editLabel?: string;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="font-kb bg-kb-warn-bg border-[1.5px] border-kb-warn-border rounded-[16px] py-3 px-[14px] flex flex-col gap-[10px] text-kb-ink">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-[3px]">
          <div className="text-kb-17 font-semibold">{name}</div>
          <div className="text-kb-14 text-kb-warn-text">{detail}</div>
        </div>
        <div className="flex-none flex items-center gap-3">
          <div data-severity="HIGH" className="flex-none whitespace-nowrap flex items-center gap-[6px] text-kb-warn-text text-kb-14 font-bold">
            <Icon icon={KB_ICONS.TriangleAlert} size={17} />
            {needLabel}
          </div>
          {onEdit && editLabel && (
            <button type="button" aria-label={editLabel} onClick={onEdit} className="kb-hit-icon w-10 h-10 flex-none rounded-[10px] bg-kb-card text-kb-warn-text flex items-center justify-center">
              <Icon icon={KB_ICONS.Pencil} size={17} />
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">{inputLabel}</label>
        <div className="box-content flex-1 min-w-0 flex items-center gap-[6px] min-h-[48px] rounded-[12px] bg-kb-card border border-kb-warn-field px-3">
          {prefix && <span className="text-kb-sub">{prefix}</span>}
          <input
            id={id}
            inputMode={inputMode}
            placeholder={placeholder}
            value={value}
            aria-label={inputLabel}
            data-pending-target={pendingTarget || undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            className="flex-1 min-w-0 border-0 outline-none bg-transparent text-kb-16 text-kb-ink placeholder:text-kb-sub"
          />
        </div>
        <button type="button" onClick={onAdd} className="kb-hit kb-press flex-none whitespace-nowrap min-h-[48px] px-4 rounded-[12px] bg-kb-ink text-kb-card text-kb-15 font-bold">{addLabel}</button>
      </div>
      {error && <p role="alert" className="text-kb-13 text-kb-err">{error}</p>}
      {children}
    </div>
  );
}
