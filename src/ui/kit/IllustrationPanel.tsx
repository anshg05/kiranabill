import type { ReactNode } from "react";
import { Icon, KB_ICONS } from "./icons";

// KB-415 (26 §7, screens 01-05): the first-time flow's drawn parts - the twinkling 4-point star and the illustration panel.

/** A 4-point star, as the files draw it (amber or primary), twinkling. */
export function Sparkle({ size, className, tone }: { size: number; className: string; tone: "amber" | "primary" | "white" }) {
  const colour = tone === "amber" ? "text-kb-amber" : tone === "primary" ? "text-kb-primary" : "text-kb-card";
  return (
    <span aria-hidden="true" className={`font-kb absolute animate-kb-twinkle ${colour} ${className}`}>
      <Icon icon={KB_ICONS.Twinkle} size={size} />
    </span>
  );
}

/** 02-05's illustration panel: pale blue to warm, radius 30, two soft circles, two sparkles. It grows with big text and never shrinks
 *  in the page's column (flex-none: a box that clips would otherwise be squeezed and cut its own content - KB-415 size matrix). */
export function IllustrationPanel({ minHeight, children }: { minHeight: 300 | 440; children: ReactNode }) {
  return (
    <div className={`font-kb relative mx-4 mt-2 flex flex-none items-center justify-center overflow-clip rounded-[30px] bg-[linear-gradient(180deg,var(--color-kb-primary-pale)_0%,var(--color-kb-warm-end)_100%)] px-4 py-8 ${minHeight === 440 ? "min-h-[440px]" : "min-h-[300px]"}`}>
      <div aria-hidden="true" data-clip-ok className="absolute -top-[50px] -right-[60px] size-[240px] rounded-full bg-kb-card/55" />
      <div aria-hidden="true" data-clip-ok className="absolute -bottom-[40px] -left-[40px] size-[160px] rounded-full bg-kb-amber/12" />
      <Sparkle size={16} tone="amber" className="top-[40px] left-[34px]" />
      <Sparkle size={12} tone="primary" className="right-[44px] bottom-[60px] [animation-delay:.8s]" />
      <div className="relative w-full">{children}</div>
    </div>
  );
}

