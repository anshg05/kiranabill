import { Icon, KB_ICONS } from "./icons";

// KB-412 batch c (26 §5 mic button), as drawn:
//   home      08-Home / 26-FirstDay: a named button, a 138 px tap area, the ring 12 px in pulsing (kb-pulse), the 114 px primary
//             circle with the mic shadow and a white 48 px mic;
//   recording 09-Recording: not a button (Pause / Stop are) - a 210 px pale circle, the ring 18 px in pulsing, the 132 px circle
//             with the large shadow and a white 56 px mic at stroke 2.
// Reduced motion: the ring stands still (26 §3).
export function MicButton(props: { variant: "home"; label: string; onClick: () => void } | { variant: "recording" }) {
  if (props.variant === "recording") {
    return (
      <div aria-hidden="true" className="relative w-[210px] h-[210px] flex items-center justify-center">
        <span className="absolute inset-[18px] rounded-full bg-kb-primary animate-kb-pulse" />
        <span className="absolute inset-0 rounded-full bg-kb-primary-pale" />
        <span className="relative w-[132px] h-[132px] rounded-full bg-kb-primary shadow-kb-mic-lg flex items-center justify-center text-kb-card">
          <Icon icon={KB_ICONS.Mic} size={56} strokeWidth={2} />
        </span>
      </div>
    );
  }
  return (
    <button type="button" aria-label={props.label} onClick={props.onClick} className="kb-press relative w-[138px] h-[138px] flex items-center justify-center">
      <span className="absolute inset-3 rounded-full bg-kb-primary animate-kb-pulse" />
      <span className="relative w-[114px] h-[114px] rounded-full bg-kb-primary shadow-kb-mic flex items-center justify-center text-kb-card">
        <Icon icon={KB_ICONS.Mic} size={48} />
      </span>
    </button>
  );
}
