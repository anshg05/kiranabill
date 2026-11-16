import { useEffect, useId, useRef, type ReactNode } from "react";
import { useBackEntry } from "../useBackEntry";
import { useHidesNav } from "../AppTabs";
import { trapTab } from "./trapTab";

// KB-412 batch b (26 §5 bottom sheet), as drawn on 25-CancelBill: the page's warm background, radius 28 on top, 10 / 20 / 26
// padding, 16 px between parts, the 44 x 5 grab handle, a 22 / 800 title over an optional 15 / 1.5 sub line; the backdrop is ink at
// 45%. It slides up (kb-sheet) as the backdrop fades in (kb-fade).
// Behaviour = today's sheets and dialogs (KB-342): Android Back and Escape close the top one (useBackEntry), a tap on the backdrop
// closes it, focus moves into the sheet, Tab stays inside, focus goes back where it was on close.
// The drawn 26 px at the bottom - more where the phone's home bar needs it (iPhone, gesture bar).
// Taller than the screen (a short phone, a big text size): it scrolls inside the screen, its top never out of reach (KB-414 step 2).
// position "static" only for a preview (the dev gallery's side-by-side); a real sheet covers the screen.

export function BottomSheet({
  backKey, title, intro, onClose, children, position = "fixed",
}: { backKey: string; title: string; intro?: string; onClose: () => void; children: ReactNode; position?: "fixed" | "static" }) {
  useBackEntry(backKey, onClose);
  useHidesNav(); // KB-414: no nav over this page (it is drawn inside a tab screen, under the nav)
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // a field that focused itself on opening (the hand-added line's quantity, KB-305) keeps the focus - else into the sheet
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className={`${position === "fixed" ? "fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-0 z-40" : ""} flex flex-col justify-end bg-kb-ink/45 animate-kb-fade`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, box.current)}
        className="font-kb bg-kb-bg rounded-t-[28px] pt-[10px] px-5 pb-[max(26px,env(safe-area-inset-bottom))] flex flex-col gap-4 text-kb-ink animate-kb-sheet outline-none max-h-full overflow-y-auto"
      >
        <div aria-hidden="true" className="self-center w-[44px] h-[5px] rounded-[3px] bg-kb-handle" />
        <div className="flex flex-col gap-[6px]">
          <h2 id={titleId} className="text-kb-22 font-extrabold">{title}</h2>
          {intro && <p className="text-kb-15 text-kb-sub leading-[1.5]">{intro}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
