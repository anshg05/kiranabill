import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 (26 §5 text field / search field), as drawn: 19-AddItem (52 px, 8 px gap, ₹ prefix, helper line), 06-ShopSetup (54 px,
// 10 px gap, a leading icon or +91, a lighter note after the label), 14-BillsList (search: 50 px, hidden label, icon 20, 15 px).
// Focus = 1.5 px primary border + a 4 px pale primary ring (26 §5; drawn on the focused field of 06 and 19).
const BOX = "box-content flex items-center rounded-[14px] bg-kb-card px-[14px] border border-kb-border focus-within:border-[1.5px] focus-within:border-kb-primary focus-within:ring-4 focus-within:ring-kb-primary/10";
const INPUT = "flex-1 min-w-0 border-0 outline-none bg-transparent text-kb-ink placeholder:text-kb-sub";

export function TextField({
  label, labelNote, value, onChange, prefix, icon, helper, placeholder, height = 52, inputMode,
}: {
  label: string;
  labelNote?: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  icon?: LucideIcon;
  helper?: string;
  placeholder?: string;
  height?: 52 | 54;
  inputMode?: "text" | "decimal" | "numeric" | "tel";
}) {
  const id = useId();
  return (
    <div className="font-kb flex flex-col gap-[6px] text-kb-ink">
      <label htmlFor={id} className="text-kb-14 font-semibold">
        {label}
        {labelNote && <span className="font-normal text-kb-sub"> {labelNote}</span>}
      </label>
      <div className={`${BOX} ${height === 54 ? "min-h-[54px] gap-[10px]" : "min-h-[52px] gap-2"}`}>
        {icon && <Icon icon={icon} size={20} className="text-kb-sub" />}
        {prefix && <span className="text-kb-16 text-kb-sub">{prefix}</span>}
        <input id={id} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} className={`${INPUT} text-kb-16`} />
      </div>
      {helper && <p className="text-kb-13 text-kb-sub">{helper}</p>}
    </div>
  );
}

export function SearchField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="font-kb">
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className={`${BOX} min-h-[50px] gap-[10px]`}>
        <Icon icon={KB_ICONS.Search} size={20} className="text-kb-sub" />
        <input id={id} type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${INPUT} text-kb-15`} />
      </div>
    </div>
  );
}
