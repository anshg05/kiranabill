import type { ReactNode } from "react";
import { useHidesNav } from "./AppTabs";
import { TopBar } from "./kit/TopBar";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";

// KB-414 step 4: an inner page - Back (arrow or Android) goes one level, no nav. Its own file (KB-416) so More's pages, Help and the
// printer screens share it without importing each other.
export function InnerPage({ title, backKey, onClose, children }: { title: string; backKey: string; onClose: () => void; children: ReactNode }) {
  useBackEntry(backKey, onClose);
  useHidesNav();
  const { t } = useT();
  return (
    <section aria-label={title} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-0 z-30 flex flex-col bg-kb-bg text-kb-ink">
      <div data-scroll-page className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-y-auto">
        <TopBar title={title} backLabel={t("settings.back")} onBack={onClose} />
        <div className="flex flex-col gap-[14px] px-4 pt-2 pb-[max(22px,env(safe-area-inset-bottom))] text-kb-15 [overflow-wrap:anywhere]">{children}</div>
      </div>
    </section>
  );
}
