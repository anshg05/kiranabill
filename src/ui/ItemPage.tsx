import type { ReactNode } from "react";
import { TopBar } from "./kit/TopBar";
import { useT } from "./useT";

/**
 * KB-414 step 3: 19-AddItem's frame, for Add item and Edit item - an inner page over the Items tab (the nav hidden by its caller,
 * useHidesNav), below the offline strip; Back, the title; the fields scroll; the footer (Save item, Archive) stays at the bottom above
 * the phone's system bar - on a screen too short for both the whole page scrolls (as 15).
 */
export function ItemPage({ title, onBack, children, footer }: { title: string; onBack: () => void; children: ReactNode; footer: ReactNode }) {
  const { t } = useT();
  return (
    <section aria-label={title} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-0 z-30 flex flex-col bg-kb-bg text-kb-ink">
      <div data-scroll-page className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-y-auto">
        <TopBar title={title} backLabel={t("settings.back")} onBack={onBack} />
        <div className="flex flex-1 flex-col gap-[18px] px-[18px] pt-2 pb-4">{children}</div>
        <div data-item-footer className="flex flex-none flex-col gap-[6px] px-[18px] pt-3 pb-[max(22px,env(safe-area-inset-bottom))]">{footer}</div>
      </div>
    </section>
  );
}

/** A field's own line of trouble (19 draws none; today's red line under the field). */
export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="-mt-3 text-kb-13 text-kb-err [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

/** Today's offline line ("Needs internet to change the catalog"), in the new look. */
export function PageNote({ children }: { children: ReactNode }) {
  return <p className="rounded-[12px] border border-kb-border bg-kb-card px-3 py-[10px] text-kb-13 text-kb-sub">{children}</p>;
}
