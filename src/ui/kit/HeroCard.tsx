import type { ReactNode } from "react";

// KB-412 batch b (26 §5 "Empty and first-use states: a friendly hero card with one action"), as drawn on 26-FirstDay: white to pale
// blue at 170°, the border, radius 26, 22 / 18 / 18 padding, centred, 12 between parts, the hero shadow; a 20 / 800 title and one
// 14 sub line (6 px closer); the screen puts its one action (and anything with it) inside.
export function HeroCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="font-kb flex flex-col items-center gap-3 bg-linear-[170deg] from-kb-card to-kb-primary-pale border border-kb-border rounded-[26px] pt-[22px] px-[18px] pb-[18px] shadow-kb-hero text-kb-ink">
      <h2 className="text-kb-20 font-extrabold">{title}</h2>
      {sub && <p className="text-kb-14 text-kb-sub text-center -mt-[6px]">{sub}</p>}
      {children}
    </div>
  );
}
