import { useEffect, useMemo, useState } from "react";
import type { KiranaBillDB, LocalBill } from "@/data/db";
import { cancelBillLocal, loadCancellationInfo, type CancellationInfo } from "@/data/cancelBill";
import { countItems, loadRecentRows, loadSearchIndex, type HistoryRow } from "@/data/history";
import type { SyncStatus } from "@/data/db";
import { loadReceipt } from "@/data/receipt";
import { billDateKey, compileQuery, type BillSearchRow } from "@/domain/billSearch";
import { REASON_LABEL, type CancelReason } from "@/domain/cancelBill";
import { formatRupees } from "@/domain/money";
import { shortTime, type Receipt as ReceiptModel } from "@/domain/receipt";
import { CASH } from "@/domain/customer";
import { subscribeBillsPull } from "@/data/billsPullStatus";
import { CancelBillSheet } from "./CancelBillSheet";
import { Receipt, ReceiptNumberText } from "./Receipt";
import { ReceiptPaper } from "./kit/ReceiptPaper";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { SearchField } from "./kit/TextField";
import { ScreenTitle, TopBar } from "./kit/TopBar";
import { MetaLine } from "./MetaLine";
import { ShareBar } from "./ShareBar";
import { PrintButton } from "./PrintButton";
import { useBackEntry } from "./useBackEntry";
import { useHidesNav } from "./AppTabs";
import { useBrowserOnline } from "./useBrowserOnline";
import { inject, mark } from "./inject";
import { useT } from "./useT";
import { useReceiptShare, type RenderReceiptFiles } from "./useReceiptShare";

// KB-310 (D60, D61): S5 History and S6 bill detail, this phone's bills only
// (KB-324 pulls from the server later).
// - The list: the newest 200 bills from the date index; "Show more" reads the
//   next 200 from the same index.
// - Search: the last 90 days' billSearch rows (one range query, D61); "Search
//   older bills" loads all of them, offered under any recent search so an older
//   date never ends at "no bills". Items are read only when a bill opens.
// - 200 results, then "Show more". Never the customer's mobile.

const PAGE = 200;
const RECENT_DAYS = 90;
const DAY_MS = 86_400_000;

function groupLabel(key: string, now: number): string {
  if (key === billDateKey(new Date(now).toISOString())) return "Today";
  if (key === billDateKey(new Date(now - DAY_MS).toISOString())) return "Yesterday";
  return key;
}

interface HistoryScreenProps {
  localDb: KiranaBillDB;
  shopId: string;
  render: RenderReceiptFiles;
  /** KB-325: needed to cancel a bill (the cancellation records which device made it). Absent = no Cancel button. */
  deviceId?: string;
  /** KB-325: a bill is being built - "Cancel and make a new bill" waits (it would have to replace it). */
  billInProgress?: boolean;
  /** KB-325: the bill was cancelled for a replacement - the billing screen builds its draft from the stored bill. */
  onReissue?: (billLocalId: string, replacementLocalId: string) => void;
  /** KB-414 step 1: Home's Recent bills - Bills opens with this bill's detail on top (Back: the list, then Home) */
  openBill?: string;
  onClose: () => void;
}

export function HistoryScreen({ localDb, shopId, render, deviceId, billInProgress = false, onReissue, openBill, onClose }: HistoryScreenProps) {
  useBackEntry("kbHistory", onClose);
  const { t, tx } = useT();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [recent, setRecent] = useState<BillSearchRow[] | null>(null);
  const [all, setAll] = useState<BillSearchRow[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  // KB-325: opened bills, stacked - "Replaced by Bill 143" opens that bill over this one.
  const [openIds, setOpenIds] = useState<readonly string[]>([]);
  // Home's Recent bill opens AFTER this screen's own Back entry (above) is in place - a child's effect runs first, so opened at
  // once the bill's entry would sit UNDER the list's and Android Back would skip the list (found in KB-414 step 2)
  useEffect(() => {
    if (openBill) setOpenIds([openBill]);
    // only the bill Home opened this screen with
  }, []);
  const [syncOf, setSyncOf] = useState<ReadonlyMap<string, SyncStatus>>(new Map());
  // KB-324: bills pulled from the server land while this is open - re-read; and say so while the first pull runs.
  const [pulled, setPulled] = useState(0);
  const online = useBrowserOnline();
  // null = not read yet; false = the first pull (this phone's bills from the server) hasn't finished.
  const [pullDone, setPullDone] = useState<boolean | null>(null);
  useEffect(() => subscribeBillsPull(localDb.name, () => setPulled((n) => n + 1)), [localDb]);
  useEffect(() => {
    let live = true;
    localDb.syncState
      .get(`bills:${shopId}`)
      .then((s) => live && setPullDone((s?.cursor ?? "").includes('"done"')))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [localDb, shopId, pulled]);
  const loadingFromServer = pullDone === false;

  // The list: the newest `shown` bills from the createdAt index (no items).
  useEffect(() => {
    let live = true;
    loadRecentRows(localDb, shopId, shown)
      .then((r) => live && setRows(r))
      .catch((err: unknown) => console.warn("[history] load failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, shopId, shown, pulled]);

  // Search: the last 90 days' billSearch rows (D61 - one range query), in the background.
  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
    loadSearchIndex(localDb, shopId, since)
      .then((r) => live && setRecent(r))
      .catch((err: unknown) => console.warn("[history] search load failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, shopId, pulled]);

  const searchOlder = () => {
    setLoadingAll(true);
    loadSearchIndex(localDb, shopId, null)
      .then(setAll)
      .catch((err: unknown) => console.warn("[history] older load failed:", err instanceof Error ? err.message : err))
      .finally(() => setLoadingAll(false));
  };

  // Everything was loaded for an older search: pulled bills arrive in it too.
  useEffect(() => {
    if (pulled > 0 && all) searchOlder();
    // only when a pull lands
  }, [pulled]);

  const typed = query.trim();
  const matches = useMemo(() => (typed ? (all ?? recent ?? []).filter(compileQuery(typed)) : null), [all, recent, typed]);
  const shownMatches = useMemo(() => matches?.slice(0, shown) ?? null, [matches, shown]);

  // Search results come from billSearch rows: their sync state from the bills, the visible ones only.
  useEffect(() => {
    if (!shownMatches) return;
    let live = true;
    localDb.bills
      .bulkGet(shownMatches.map((r) => r.localId))
      .then((bills) => live && setSyncOf(new Map(bills.flatMap((b) => (b ? [[b.localId, b.syncStatus] as const] : [])))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [localDb, shownMatches]);

  const visible: HistoryRow[] = shownMatches
    ? shownMatches.map((r) => ({ localId: r.localId, receiptNumber: r.receiptNumber, customerName: r.customerName, totalPaise: r.totalPaise, at: r.finalizedAt, syncStatus: syncOf.get(r.localId) ?? "synced", cancelled: r.cancelled === true }))
    : (rows ?? []);
  // KB-414 step 2: "N items" on each card - counted for the cards shown, after the list is up (never holds it back)
  const [itemsOf, setItemsOf] = useState<ReadonlyMap<string, number>>(new Map());
  const visibleIds = visible.map((b) => b.localId).join(",");
  useEffect(() => {
    if (!visibleIds) return;
    let live = true;
    countItems(localDb, visibleIds.split(","))
      .then((m) => live && setItemsOf(m))
      .catch((err: unknown) => console.warn("[history] item counts failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, visibleIds, pulled]);
  // More to show: more matches, or - with no search - the newest `shown` rows came back full.
  const more = matches ? matches.length > shown : rows !== null && rows.length >= shown;
  const now = Date.now();
  const groups: { label: string; bills: HistoryRow[] }[] = [];
  for (const b of visible) {
    const label = groupLabel(billDateKey(b.at), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.bills.push(b);
    else groups.push({ label, bills: [b] });
  }
  const scope = t(all ? "history.scopeAll" : recent ? "history.scopeRecent" : "history.scopeLoading");

  return (
    <section aria-label={t("history.billsLabel")} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-[var(--kb-tab-bottom,0px)] z-20 flex flex-col bg-kb-bg text-kb-ink">
      {/* Under an open bill: hidden from screen readers and out of the tab order. */}
      <div inert={openIds.length > 0} aria-hidden={openIds.length > 0 || undefined} className="mx-auto flex h-full w-full max-w-[480px] flex-col">
        {/* KB-414 step 2: 14's title; no back arrow - the nav and Android Back go Home. NOT built (parked): the date chips (SG-28),
            the unfinished-bill card (KB-423), the "Today · N bills" chart (KB-417), a print button per bill (SG-29). */}
        <ScreenTitle title={t("history.billsLabel")} />
        <div className="px-4 pt-[6px]">
          <SearchField
            label={t("history.search")}
            placeholder={t("history.placeholder")}
            value={query}
            onChange={(v) => {
              setQuery(v);
              setShown(PAGE);
            }}
          />
          {typed && <p className="mt-[6px] px-1 text-kb-13 text-kb-sub">{scope}</p>}
        </div>

        <div data-scroll-list className="min-h-0 flex-1 overflow-y-auto px-4 pt-[10px] pb-3">
          {loadingFromServer && <p className="px-1 pb-2 text-kb-13 text-kb-sub">{t(online ? "history.loadingServer" : "history.needInternet")}</p>}
          {rows !== null && rows.length === 0 && pullDone === true && (
            <div className="px-1 py-6 text-center">
              <p className="text-kb-15 font-bold">{t("history.empty")}</p>
              <p className="mt-1 text-kb-13 text-kb-sub">{t("history.emptyHelp")}</p>
            </div>
          )}
          {matches !== null && (recent !== null || all !== null) && matches.length === 0 && <p className="px-1 py-6 text-center text-kb-15">{t("history.none")}</p>}
          {visible.length > 0 && (
            <ul aria-label={t("history.billsLabel")} className="flex flex-col gap-[10px]">
              {groups.map((g) => (
                <li key={g.label} className="flex flex-col gap-[10px]">
                  <h3 className="pt-1 text-kb-12 font-bold uppercase tracking-[.5px] text-kb-sub px-1">{tx(g.label)}</h3>
                  <ul className="flex flex-col gap-[10px]">
                    {g.bills.map((b) => (
                      <li key={b.localId}>
                        <BillCardRow bill={b} items={itemsOf.get(b.localId)} onOpen={() => setOpenIds([b.localId])} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col items-center gap-2 pt-4">
            {more && (
              <Button variant="secondary" fill={false} onClick={() => setShown((n) => n + PAGE)} className="px-4">
                {t("history.showMore")}
              </Button>
            )}
            {typed && !all && (
              <Button variant="secondary" fill={false} disabled={loadingAll} onClick={searchOlder} className="px-4">
                {t("history.searchOlder")}
              </Button>
            )}
            {loadingAll && <p className="text-kb-13 text-kb-sub">{t("history.loadingOlder")}</p>}
          </div>
        </div>
      </div>
      {openIds.map((id, i) => (
        <BillDetail
          key={id}
          localDb={localDb}
          shopId={shopId}
          localId={id}
          render={render}
          deviceId={deviceId}
          billInProgress={billInProgress}
          covered={i < openIds.length - 1}
          onOpen={(next) => setOpenIds((ids) => [...ids, next])}
          onChanged={() => setPulled((n) => n + 1)}
          onReissue={onReissue}
          onClose={() => setOpenIds((ids) => ids.slice(0, -1))}
        />
      ))}
    </section>
  );
}

/** 14-BillsList's bill card: the receipt tile (grey when cancelled), "Bill 515" with its pills, "1:18 pm · 4 items · name", the amount. */
function BillCardRow({ bill: b, items, onOpen }: { bill: HistoryRow; items: number | undefined; onOpen: () => void }) {
  const { t } = useT();
  const time = shortTime(b.at);
  const meta = items === undefined ? time : items === 1 ? t("bills.metaOne", { time }) : t("bills.metaMany", { n: items, time });
  return (
    <button type="button" onClick={onOpen} className="kb-hit kb-press flex min-h-[70px] w-full items-center gap-3 rounded-[16px] border border-kb-border bg-kb-card px-[14px] py-[10px] text-left">
      <span data-bill-tile className={`flex size-[42px] flex-none items-center justify-center rounded-[12px] ${b.cancelled ? "bg-kb-muted text-kb-sub" : "bg-kb-primary-pale text-kb-primary"}`}>
        <Icon icon={KB_ICONS.ReceiptText} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span data-bill-title className="flex flex-wrap items-center gap-x-2 gap-y-1 text-kb-15 font-bold [overflow-wrap:anywhere]">
          <span>{inject(t("history.billNo", { n: mark("n") }), { n: <ReceiptNumberText value={b.receiptNumber} /> })}</span>
          {b.cancelled && <Badge kind="cancelled">{t("history.cancelled")}</Badge>}
          {b.syncStatus !== "synced" && <Badge kind="small">{t("history.notSynced")}</Badge>}
        </span>
        <MetaLine className="text-kb-13 text-kb-sub [overflow-wrap:anywhere]" text={b.customerName !== CASH ? `${meta} · ${b.customerName}` : meta} />
      </span>
      <span className={`flex-none whitespace-nowrap text-kb-16 font-extrabold tabular-nums ${b.cancelled ? "text-kb-sub line-through" : ""}`}>{formatRupees(b.totalPaise)}</span>
    </button>
  );
}

/** S6: the saved bill, read-only - the receipt and the four share buttons; KB-325: Cancel bill, and what a cancellation says. */
function BillDetail({
  localDb,
  shopId,
  localId,
  render,
  deviceId,
  billInProgress,
  covered,
  onOpen,
  onChanged,
  onReissue,
  onClose,
}: {
  localDb: KiranaBillDB;
  shopId: string;
  localId: string;
  render: RenderReceiptFiles;
  deviceId?: string;
  billInProgress: boolean;
  covered: boolean;
  onOpen: (localId: string) => void;
  onChanged: () => void;
  onReissue?: (billLocalId: string, replacementLocalId: string) => void;
  onClose: () => void;
}) {
  useBackEntry("kbBillDetail", onClose);
  const { t, tx } = useT();
  const [receipt, setReceipt] = useState<ReceiptModel | null>(null);
  const [bill, setBill] = useState<LocalBill | null>(null);
  const [info, setInfo] = useState<CancellationInfo | null>(null);
  const [version, setVersion] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([loadReceipt(localDb, localId), localDb.bills.get(localId), loadCancellationInfo(localDb, localId)])
      .then(([r, b, i]) => {
        if (!live) return;
        setReceipt(r);
        setBill(b ?? null);
        setInfo(i);
      })
      .catch((err: unknown) => console.warn("[history] receipt read failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, localId, version]);
  const saved = useMemo(() => (receipt ? { localId, receiptNumber: receipt.receiptNumber, receipt } : null), [localId, receipt]);
  const share = useReceiptShare({ localDb, saved, render });
  useHidesNav();

  const cancel = async (reason: CancelReason, withReplacement: boolean): Promise<string | null> => {
    if (!deviceId) return "Couldn't cancel the bill — try again";
    const replacementLocalId = withReplacement ? crypto.randomUUID() : null;
    const r = await cancelBillLocal(localDb, { shopId, billLocalId: localId, reason, deviceId, replacementLocalId });
    if (!r.ok) return r.error;
    setCancelling(false);
    setVersion((v) => v + 1);
    onChanged();
    if (replacementLocalId) onReissue?.(localId, replacementLocalId);
    return null;
  };

  const c = info?.cancellation ?? null;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const at = bill?.finalizedAt ?? bill?.createdAt;
  const n = receipt?.rows.length ?? 0;
  const detailMeta = receipt && at
    ? n === 1
      ? t("detail.metaOne", { date: day(at), time: shortTime(at), customer: receipt.customer ?? CASH })
      : t("detail.metaMany", { date: day(at), time: shortTime(at), n, customer: receipt.customer ?? CASH })
    : null;
  const link = "kb-hit flex min-h-11 items-center text-left text-kb-14 font-bold text-kb-primary";
  return (
    // KB-414 step 2 phone check (owner, 17 Nov 2026): no nav on 15 (useHidesNav), below the offline strip; the footer stays at the bottom
    // with the receipt scrolling above it - on a screen too short for both the whole page scrolls (the receipt keeps a minimum height)
    <section aria-label={t("bill.savedBefore")} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-0 z-30 flex flex-col bg-kb-bg text-kb-ink">
      <div inert={covered || cancelling} aria-hidden={covered || cancelling || undefined} data-scroll-page className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-y-auto">
        {/* KB-414 step 2: 15's top bar - Back, "Bill 514", Saved (a cancelled bill: Cancelled) - and the line under it */}
        <TopBar
          title={receipt ? t("history.billNo", { n: receipt.receiptNumber }) : t("bill.savedBefore")}
          backLabel={t("settings.back")}
          onBack={onClose}
          right={bill && (bill.status === "cancelled" ? <Badge kind="cancelled">{t("history.cancelled")}</Badge> : <Badge kind="saved">{t("settings.saved")}</Badge>)}
        />
        {detailMeta && <p className="px-5 pb-2 text-kb-14 text-kb-sub">{detailMeta}</p>}
        <div data-scroll-list className="flex min-h-[min(220px,40dvh)] flex-1 flex-col items-center gap-3 overflow-y-auto px-5 pt-1 pb-2">
          {/* a cancelled bill says so first, above its receipt (today's details: the reason, the day, the replacement, the sync note) */}
          {c && (
            <section aria-label={t("history.cancellation")} className="flex w-full max-w-[340px] flex-col gap-[2px] rounded-[16px] border border-kb-border bg-kb-card px-4 py-3 text-kb-14">
              <p className="font-bold">{t("history.cancelledReason", { reason: tx(REASON_LABEL[c.reason]) })}</p>
              <p className="text-kb-sub">{day(c.cancelledAt)}</p>
              {info?.replacedBy ? (
                <button type="button" onClick={() => onOpen(info.replacedBy!.localId)} className={link}>
                  {t("history.replacedBy", { n: info.replacedBy.receiptNumber })}
                </button>
              ) : (
                <p className="text-kb-sub">{t("history.noReplacement")}</p>
              )}
              {bill?.syncStatus === "conflict" ? (
                <p className="text-kb-err">{t("history.conflictNote")}</p>
              ) : (
                c.syncStatus !== "synced" && <p className="text-kb-sub">{t("history.willReach")}</p>
              )}
            </section>
          )}
          {info?.replaces && (
            <button type="button" onClick={() => onOpen(info.replaces!.localId)} className={`${link} w-full max-w-[340px]`}>
              {t("history.replaces", { n: info.replaces.receiptNumber })}
            </button>
          )}
          {/* 15's 340 px paper, no torn edge; the whole receipt ("Show all N items" is parked, SG-32) */}
          {receipt && (
            <div className="h-fit w-full max-w-[340px]">
              <ReceiptPaper width={340}>
                <Receipt receipt={receipt} />
              </ReceiptPaper>
            </div>
          )}
        </div>
        <div data-detail-footer className="flex flex-none flex-col gap-[10px] px-[18px] pt-3 pb-[max(22px,env(safe-area-inset-bottom))]">
          {/* KB-408 S5: a copy printed from a saved bill is always a reprint ("Reprint", in the Android app only) */}
          {receipt && <PrintButton receipt={receipt} firstIsOriginal={false} />}
          {share && <ShareBar share={share} look="tiles" />}
          {bill?.status === "final" && deviceId && (
            <Button variant="destructive-text" icon={KB_ICONS.RotateCcw} onClick={() => setCancelling(true)}>
              {t("history.cancelButton")}
            </Button>
          )}
        </div>
      </div>
      {cancelling && receipt && <CancelBillSheet receiptNumber={receipt.receiptNumber} billInProgress={billInProgress} onCancel={cancel} onClose={() => setCancelling(false)} />}
    </section>
  );
}
