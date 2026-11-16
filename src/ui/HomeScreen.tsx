import { useEffect, useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import { loadRecentRows, type HistoryRow } from "@/data/history";
import { subscribeBillsPull } from "@/data/billsPullStatus";
import { formatRupees } from "@/domain/money";
import { formatDateTime } from "@/domain/receipt";
import { Icon, KB_ICONS } from "./kit/icons";
import { Logo } from "./kit/Logo";
import { MicButton } from "./kit/MicButton";
import { InstallHint } from "./InstallHint";
import { ReceiptNumberText } from "./Receipt";
import { inject, mark } from "./inject";
import { useT } from "./useT";

// KB-414 step 1 (owner + reviewer, 16 Nov 2026; plan defaults): 08-Home. The logo, the greeting (the phone's clock) over the shop's name,
// the profile button (opens More, Q4); the record card - the mic records (09), Type items opens 12 with Add item; Recent bills - this
// shop's 2 newest saved bills (cancelled too, as History lists them), See all -> Bills, a row opens that bill. NOT built (26 §9, new
// features with their own tickets): Reprint last (KB-418) and the Today's bills / sales cards (KB-417) - the space closes up (Q5).
// The PWA install hint moved here from the bill (Q14).

export interface HomeScreenProps {
  localDb: KiranaBillDB;
  shopId: string;
  shopName?: string;
  onRecord: () => void;
  onType: () => void;
  onOpenBill: (localId: string) => void;
  onSeeAll: () => void;
  onProfile: () => void;
  /** tests: the clock the greeting reads */
  now?: () => Date;
}

type Recent = HistoryRow & { readonly items: number };

export function HomeScreen({ localDb, shopId, shopName, onRecord, onType, onOpenBill, onSeeAll, onProfile, now = () => new Date() }: HomeScreenProps) {
  const { t } = useT();
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [pulled, setPulled] = useState(0);
  useEffect(() => subscribeBillsPull(localDb.name, () => setPulled((n) => n + 1)), [localDb]);
  useEffect(() => {
    let live = true;
    loadRecentRows(localDb, shopId, 2)
      .then((rows) => Promise.all(rows.map(async (r) => ({ ...r, items: await localDb.billItems.where("billLocalId").equals(r.localId).count() }))))
      .then((rows) => live && setRecent(rows))
      .catch((err: unknown) => console.warn("[home] recent bills failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, shopId, pulled]);
  const hour = now().getHours();
  const greeting = t(hour < 12 ? "home.morning" : hour < 17 ? "home.afternoon" : "home.evening");

  return (
    <section aria-label={t("nav.home")} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-[var(--kb-tab-bottom,0px)] z-20 overflow-y-auto bg-kb-bg text-kb-ink">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-[14px] px-[18px] pt-[18px] pb-[10px]">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size={42} shadow />
            <div className="flex min-w-0 flex-col">
              <p className="text-kb-13 text-kb-sub">{greeting}</p>
              <h1 className="text-kb-19 font-extrabold tracking-[-0.3px] [overflow-wrap:anywhere]">{shopName ?? "KiranaBill"}</h1>
            </div>
          </div>
          <button type="button" aria-label={t("home.profile")} onClick={onProfile} className="kb-hit flex size-11 shrink-0 items-center justify-center rounded-full border border-kb-border bg-kb-card text-kb-ink">
            <Icon icon={KB_ICONS.Profile} size={20} />
          </button>
        </header>

        <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-[26px] border border-kb-border bg-linear-[170deg] from-kb-card to-kb-primary-pale px-[18px] pt-5 pb-4 shadow-kb-hero">
          <span aria-hidden="true" className="absolute top-[22px] right-[26px] flex animate-kb-twinkle text-kb-amber">
            <Icon icon={KB_ICONS.Twinkle} size={14} />
          </span>
          {/* px-6: a long title (Hindi, a big text size) wraps before the sparkle in the corner - it never runs under it */}
          <h2 className="px-6 text-center text-kb-20 font-extrabold tracking-[-0.3px]">{t("home.ready")}</h2>
          <MicButton variant="home" label={t("order.record")} onClick={onRecord} />
          <p className="text-center text-kb-15 text-kb-sub">{t("home.tapToRecord")}</p>
          <div className="flex gap-[10px] self-stretch">
            <button type="button" onClick={onType} className="kb-press kb-hit flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border border-kb-border bg-kb-card px-3 text-kb-14 font-bold text-kb-ink">
              <Icon icon={KB_ICONS.Keyboard} size={18} />
              {t("home.typeItems")}
            </button>
          </div>
        </div>

        {recent && recent.length > 0 && (
          <div className="flex flex-col gap-[6px]">
            <div className="flex items-center justify-between">
              <h2 className="text-kb-16 font-extrabold">{t("home.recent")}</h2>
              <button type="button" onClick={onSeeAll} className="kb-hit flex min-h-10 items-center text-kb-14 font-bold text-kb-primary">
                {t("home.seeAll")}
              </button>
            </div>
            <ul aria-label={t("home.recent")} className="flex flex-col rounded-[18px] border border-kb-border bg-kb-card">
              {recent.map((b, i) => {
                const time = (formatDateTime(b.at).split(" | ")[1] ?? "").toLowerCase(); // "1:02 PM" -> "1:02 pm", as drawn
                return (
                  <li key={b.localId}>
                    {i > 0 && <div aria-hidden="true" className="mx-[14px] h-px bg-kb-border" />}
                    <button type="button" onClick={() => onOpenBill(b.localId)} className="kb-hit flex min-h-[60px] w-full items-center justify-between gap-3 px-[14px] text-left">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex size-10 flex-none items-center justify-center rounded-[12px] bg-kb-primary-pale text-kb-primary">
                          <Icon icon={KB_ICONS.ReceiptText} size={19} />
                        </span>
                        <span className="flex min-w-0 flex-col gap-[2px]">
                          <span className="text-kb-15 font-bold">{inject(t("history.billNo", { n: mark("n") }), { n: <ReceiptNumberText value={b.receiptNumber} /> })}</span>
                          <span className="text-kb-13 text-kb-sub">{b.items === 1 ? t("home.metaOne", { time }) : t("home.metaMany", { n: b.items, time })}</span>
                        </span>
                      </span>
                      <span className={`flex flex-none items-center gap-1 whitespace-nowrap text-kb-16 font-extrabold tabular-nums ${b.cancelled ? "text-kb-sub line-through" : ""}`}>
                        {formatRupees(b.totalPaise)}
                        <Icon icon={KB_ICONS.ChevronRight} size={18} className="text-kb-sub" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <InstallHint eligible />
      </div>
    </section>
  );
}
