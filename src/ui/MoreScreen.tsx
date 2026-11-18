import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { deriveShopAliases } from "@/data/aliasEvidence";
import type { DeviceDB } from "@/data/device";
import type { KiranaBillDB, LocalShop } from "@/data/db";
import { isNativeApp } from "@/data/nativeSignIn";
import { loadPrinterSettings } from "@/data/printer";
import type { ReconcileResult } from "@/data/billMetrics";
import { BUILD_ID } from "@/pwa/buildId";
import { formatMobile } from "@/domain/customer";
import { Icon, KB_ICONS } from "./kit/icons";
import { GroupLabel, ListCard, ListRow } from "./kit/ListRow";
import { Logo } from "./kit/Logo";
import { ScreenTitle } from "./kit/TopBar";
import { BillDesignPage, DeveloperPage, EditShopPage, LanguagePage, PrinterPage, RECEIPT_LANGUAGE_NAME, SCREEN_LANGUAGES, SyncPage, useSyncStateText, type MorePage, type SyncState } from "./MorePages";
import { SignOutButton } from "./OfflineUi";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";

// KB-414 step 4 (owner + reviewer, 18 Nov 2026; the approved plan, all 4 defaults): More (17) - the look from the design file, the
// content from the app. Replaces today's Settings screen (KB-312), whose every part moved to an inner page (MorePages.tsx). The
// design's Help & support (SG-27) and account deletion (KB-430) stay out; its "Backup & sync" is "Sync" (there is no backup the
// shopkeeper can see). Everything here is read from the phone - offline is the same page.

export function MoreScreen({ localDb, shopId, deviceId, deviceDb, reconcile, sync, billInProgress, onSignOut, onItems, onClose, initialPage }: {
  localDb: KiranaBillDB;
  shopId: string;
  deviceId: string;
  /** KB-401: where "is this phone's storage protected?" is recorded (D67). */
  deviceDb?: DeviceDB;
  /** KB-404: asks the server about this phone's bills ("no bill lost or corrupted"). Absent = no button. */
  reconcile?: () => Promise<ReconcileResult>;
  sync: SyncState;
  billInProgress: boolean;
  onSignOut: () => void;
  onItems: () => void;
  onClose: () => void;
  /** the dev sheets only: open on an inner page */
  initialPage?: MorePage;
}) {
  useBackEntry("kbMore", onClose);
  const { t, lang } = useT();
  const [page, setPage] = useState<MorePage | null>(initialPage ?? null);
  const [shop, setShop] = useState<LocalShop | null>(null);
  const [counts, setCounts] = useState<{ items: number; learned: number } | null>(null);
  const syncText = useSyncStateText(sync);

  useEffect(() => {
    const sub = liveQuery(() => localDb.shops.get(shopId)).subscribe({
      next: (row) => setShop(row ?? null),
      error: (err: unknown) => console.warn("[more] shop load failed:", err instanceof Error ? err.message : err),
    });
    return () => sub.unsubscribe();
  }, [localDb, shopId]);

  // Items & prices: the active items, and the learned names the Items tab's Learned chip lists (an active name of an active item).
  useEffect(() => {
    if (page !== null) return;
    let live = true;
    void Promise.all([localDb.shopProducts.where("shopId").equals(shopId).toArray(), deriveShopAliases(localDb, shopId)])
      .then(([all, derived]) => {
        const active = new Set(all.filter((p) => p.isActive).map((p) => p.id));
        if (live) setCounts({ items: active.size, learned: derived.filter((a) => a.active && active.has(a.catalogId)).length });
      })
      .catch((err: unknown) => console.warn("[more] counts failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, shopId, page]);

  const close = () => setPage(null);
  const printer = isNativeApp() ? loadPrinterSettings() : null;
  const itemsSub = counts
    ? `${t(counts.items === 1 ? "more.itemOne" : "more.itemMany", { n: counts.items })} · ${t(counts.learned === 1 ? "items.learnedOne" : "items.learnedMany", { n: counts.learned })}`
    : undefined;

  return (
    <section aria-label={t("order.more")} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-[var(--kb-tab-bottom,0px)] z-20 flex flex-col bg-kb-bg text-kb-ink">
      {/* under an inner page: out of reach and out of the screen reader's way (as Items, KB-414 step 3) */}
      <div data-scroll-page inert={page !== null} aria-hidden={page !== null || undefined} className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-y-auto">
        <ScreenTitle title={t("order.more")} />
        {shop && (
          <div className="flex flex-col gap-[10px] px-4 pt-2 pb-6">
            <button type="button" onClick={() => setPage("shop")} className="kb-hit flex w-full items-center gap-[14px] rounded-[16px] border border-kb-border bg-kb-card px-[14px] py-[14px] text-left">
              <Logo size={52} />
              <span className="flex min-w-0 flex-1 flex-col gap-[2px] [overflow-wrap:anywhere]">
                <span className="text-kb-17 font-bold">{shop.name}</span>
                <span className="text-kb-13 text-kb-sub">{shop.phone ? `${/^\d{10}$/.test(shop.phone) ? formatMobile(shop.phone) : shop.phone} · ` : ""}{t("more.editShop")}</span>
              </span>
              <Icon icon={KB_ICONS.ChevronRight} size={18} className="text-kb-sub" />
            </button>

            <div className="mt-2">
              <GroupLabel>{t("more.billing")}</GroupLabel>
            </div>
            <ListCard>
              {isNativeApp() && <ListRow icon={KB_ICONS.Printer} title={t("settings.printer")} sub={printer ? printer.device.name : t("settings.printerNone")} onClick={() => setPage("printer")} />}
              <ListRow icon={KB_ICONS.BillDesign} title={t("more.billDesign")} sub={t("more.receiptIn", { lang: RECEIPT_LANGUAGE_NAME[shop.billLanguage] })} onClick={() => setPage("billDesign")} />
              <ListRow icon={KB_ICONS.Package} title={t("more.items")} sub={itemsSub} onClick={onItems} />
            </ListCard>

            <div className="mt-2">
              <GroupLabel>{t("more.app")}</GroupLabel>
            </div>
            <ListCard>
              <ListRow icon={KB_ICONS.Languages} title={t("more.appLanguage")} value={SCREEN_LANGUAGES.find((l) => l.value === lang)?.label} onClick={() => setPage("language")} />
              <ListRow icon={KB_ICONS.Cloud} title={t("more.sync")} sub={syncText} onClick={() => setPage("sync")} />
              <ListRow icon={KB_ICONS.ShieldCheck} title={t("more.privacy")} href="/privacy" />
              {/* English in every language, as today's Developer mode (KB-312) */}
              <ListRow icon={KB_ICONS.Phone} title="Developer" onClick={() => setPage("developer")} />
            </ListCard>

            <SignOutButton unsynced={sync.unsynced} billInProgress={billInProgress} onSignOut={onSignOut} />
            {/* default 3 (owner, 18 Nov 2026): the draft id one tap away - every phone check starts here */}
            <p className="text-center text-kb-13 text-kb-sub">Version {BUILD_ID}</p>
          </div>
        )}
      </div>

      {shop && page === "shop" && <EditShopPage localDb={localDb} shopId={shopId} onClose={close} />}
      {shop && page === "printer" && <PrinterPage shop={shop} onClose={close} />}
      {shop && page === "billDesign" && <BillDesignPage localDb={localDb} shop={shop} onClose={close} />}
      {page === "language" && <LanguagePage onClose={close} />}
      {page === "sync" && <SyncPage sync={sync} onClose={close} />}
      {page === "developer" && <DeveloperPage localDb={localDb} shopId={shopId} deviceId={deviceId} deviceDb={deviceDb} reconcile={reconcile} onClose={close} />}
    </section>
  );
}
