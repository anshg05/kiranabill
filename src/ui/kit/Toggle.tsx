import { useId } from "react";

// KB-412 (26 §5 toggle), as drawn in 18-Printer: a 58 px row, label 15 / 600 with an optional 13 sub-line, a 52 x 30 switch
// (primary on, the off colour off) with a white 24 px knob. The whole row is tappable (26 §5): the label is the switch's label.
export function ToggleRow({
  label, sub, checked, onChange, divider = false,
}: { label: string; sub?: string; checked: boolean; onChange: (on: boolean) => void; divider?: boolean }) {
  const id = useId();
  return (
    <div className={`font-kb box-content flex items-center gap-3 min-h-[58px] px-[14px] ${divider ? "border-b border-kb-border" : ""}`}>
      {/* py: a label that wraps (a big text size, 18's compatible-mode hint) keeps clear of the row's edges - one line is unchanged */}
      <label htmlFor={id} className="flex-1 cursor-pointer py-2">
        <span id={`${id}-name`} className="block text-kb-15 font-semibold text-kb-ink">{label}</span>
        {sub && <span className="block text-kb-13 text-kb-sub">{sub}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-labelledby={`${id}-name`}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`kb-hit relative w-[52px] h-[30px] flex-none rounded-full ${checked ? "bg-kb-primary" : "bg-kb-toggle-off"}`}
      >
        <span className={`absolute top-[3px] w-6 h-6 rounded-full bg-kb-card shadow-kb-knob ${checked ? "right-[3px]" : "left-[3px]"}`} />
      </button>
    </div>
  );
}
