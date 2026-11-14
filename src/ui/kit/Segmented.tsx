// KB-412 (26 §5 segmented control), as drawn in 18-Printer (paper size): a muted track, radius 14, 4 px inside, 6 px apart; the
// chosen segment white with the segment shadow, 15 / 700 ink; the others clear, 15 / 600 sub; 46 px high, radius 11.
export function Segmented<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="font-kb flex gap-[6px] bg-kb-muted rounded-[14px] p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 min-h-[46px] rounded-[11px] text-kb-15 ${on ? "bg-kb-card shadow-kb-segment font-bold text-kb-ink" : "bg-transparent font-semibold text-kb-sub"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
