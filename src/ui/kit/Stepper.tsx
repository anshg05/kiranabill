import { Icon, KB_ICONS } from "./icons";

// KB-412 (26 §5 stepper), as drawn in 18-Printer (copies): 40 px bordered buttons, radius 10, 18 px - / +, the value 17 / 800 in
// a 28 px column. A button at its limit is disabled (the screen file draws no disabled look; it is shown unchanged).
export function Stepper({
  value, min, max, onChange, decreaseLabel, increaseLabel,
}: { value: number; min: number; max: number; onChange: (v: number) => void; decreaseLabel: string; increaseLabel: string }) {
  const btn = "w-10 h-10 flex-none rounded-[10px] border border-kb-border bg-kb-card text-kb-ink flex items-center justify-center";
  return (
    <div className="font-kb flex items-center gap-3">
      <button type="button" aria-label={decreaseLabel} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>
        <Icon icon={KB_ICONS.Minus} size={18} />
      </button>
      <span className="w-7 text-center text-kb-17 font-extrabold text-kb-ink">{value}</span>
      <button type="button" aria-label={increaseLabel} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>
        <Icon icon={KB_ICONS.Plus} size={18} />
      </button>
    </div>
  );
}
