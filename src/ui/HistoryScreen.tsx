import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { KiranaBillDB } from "@/data/db";
import { loadRecentRows, loadSearchIndex, type HistoryRow } from "@/data/history";
import { loadReceipt } from "@/data/receipt";
import { billDateKey, compileQuery, toSearchEntry, type SearchEntry } from "@/domain/billSearch";
import { formatRupees } from "@/domain/money";
import type { Receipt as ReceiptModel } from "@/domain/receipt";
import { Receipt, ReceiptNumberText } from "./Receipt";
import { ShareBar } from "./ShareBar";
import { useBackEntry } from "./useBackEntry";
import { useReceiptShare, type RenderReceiptFiles } from "./useReceiptShare";

// KB-310 (owner's load design, 7 Oct 2026): S5 History and S6 bill detail,
// this phone's bills only (KB-324 pulls from the server later).
// - Opens on the newest 200 rows (the date index, no items).
// - The last 90 days load in the background; search covers them and says so.
// - "Search older bills" loads every bill on demand - offered under any
//   recent search, so an older date never ends at "no bills".
// - 200 results, then "Show more". Never the customer's mobile.

const PAGE = 200;
const RECENT_DAYS = 90;
const DAY_MS = 86_400_000;

function groupLabel(key: string, now: number): string {
  if (key === billDateKey(new Date(now).toISOString())) return "Today";
  if (key === billDateKey(new Date(now - DAY_MS).toISOString())) return "Yesterday";
  return key;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

interface HistoryScreenProps {
  localDb: KiranaBillDB;
  shopId: string;
  render: RenderReceiptFiles;
  onClose: () => void;
}

export function HistoryScreen({ localDb, shopId, render, onClose }: HistoryScreenProps) {
  useBackEntry("kbHistory", onClose);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [recent, setRecent] = useState<SearchEntry<HistoryRow>[] | null>(null);
  const [all, setAll] = useState<SearchEntry<HistoryRow>[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const first = await loadRecentRows(localDb, shopId, PAGE);
      if (!live) return;
      setRows(first);
      const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
      const window = await loadSearchIndex(localDb, shopId, since);
      if (live) setRecent(window);
    })().catch((err: unknown) => console.warn("[history] load failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, shopId]);

  const searchOlder = () => {
    setLoadingAll(true);
    loadSearchIndex(localDb, shopId, null)
      .then(setAll)
      .catch((err: unknown) => console.warn("[history] older load failed:", err instanceof Error ? err.message : err))
      .finally(() => setLoadingAll(false));
  };

  // No query: the newest rows, or every bill once loaded - the 90-day window is
  // for SEARCH only (a shop whose bills are all older must still see them).
  // A query: everything if loaded, else the 90 days, else the newest rows (no items yet).
  const typed = query.trim();
  const rowEntries = useMemo(() => (rows ?? []).map(toSearchEntry), [rows]);
  const results = useMemo(
    () => (typed ? (all ?? recent ?? rowEntries).filter(compileQuery(typed)) : (all ?? rowEntries)),
    [all, recent, rowEntries, typed],
  );
  // The newest rows stop at PAGE: there may be more bills, only loading everything shows them.
  const mayHaveMore = !typed && !all && rows !== null && rows.length >= PAGE;
  const visible = results.slice(0, shown).map((e) => e.bill);
  const now = Date.now();
  const groups: { label: string; bills: HistoryRow[] }[] = [];
  for (const b of visible) {
    const label = groupLabel(billDateKey(b.at), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.bills.push(b);
    else groups.push({ label, bills: [b] });
  }
  const scope = all ? "Searching all bills on this phone" : recent ? "Searching the last 90 days" : "Loading the last 90 days…";

  return (
    <section aria-label="History" className="fixed inset-0 z-20 flex flex-col bg-paper text-ink text-[15px]">
      {/* Under an open bill: hidden from screen readers and out of the tab order. */}
      <div inert={openId !== null} aria-hidden={openId !== null || undefined} className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">History</h2>
        </header>
        <div className="border-b border-line px-4 py-2">
          <input
            type="search"
            aria-label="Search bills"
            placeholder="Name, amount, date (4/10), item, bill no."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            className="min-h-11 w-full rounded-[6px] border border-line bg-surface px-3"
          />
          {typed && <p className="mt-1 text-[13px] text-ink-soft">{scope}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows !== null && rows.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="font-medium">No bills on this phone yet.</p>
              <p className="mt-1 text-[13px] text-ink-soft">History shows the bills saved on this phone.</p>
            </div>
          )}
          {rows !== null && rows.length > 0 && visible.length === 0 && <p className="px-4 py-6 text-center">No bills found.</p>}
          {visible.length > 0 && (
            <ul aria-label="Bills">
              {groups.map((g) => (
                <li key={g.label}>
                  <h3 className="bg-paper px-4 pb-1 pt-3 text-[13px] font-medium text-ink-soft">{g.label}</h3>
                  <ul>
                    {g.bills.map((b) => (
                      <li key={b.localId}>
                        <button type="button" onClick={() => setOpenId(b.localId)} className="flex min-h-12 w-full items-center gap-3 border-b border-line bg-surface px-4 py-2 text-left">
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium [overflow-wrap:anywhere]">
                              <ReceiptNumberText value={b.receiptNumber} />
                            </span>
                            <span className="block text-[13px] text-ink-soft">
                              {timeOf(b.at)}
                              {b.customerName !== "Cash" && <> · {b.customerName}</>}
                            </span>
                          </span>
                          {b.syncStatus !== "synced" && <span className="rounded-[6px] border border-line px-2 py-0.5 text-[12px] text-ink-soft">Not synced</span>}
                          <span className="font-semibold tabular-nums">{formatRupees(b.totalPaise)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col items-center gap-2 px-4 py-4">
            {(results.length > shown || mayHaveMore) && (
              <button
                type="button"
                aria-disabled={loadingAll}
                onClick={() => {
                  if (loadingAll) return;
                  if (mayHaveMore) searchOlder();
                  setShown((n) => n + PAGE);
                }}
                className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
              >
                Show more
              </button>
            )}
            {typed && !all && (
              <button type="button" aria-disabled={loadingAll} onClick={loadingAll ? undefined : searchOlder} className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50">
                Search older bills
              </button>
            )}
            {loadingAll && <p className="text-[13px] text-ink-soft">Loading older bills…</p>}
          </div>
        </div>
      </div>
      {openId && <BillDetail localDb={localDb} localId={openId} render={render} onClose={() => setOpenId(null)} />}
    </section>
  );
}

/** S6: the saved bill, read-only - the receipt and the four share buttons. */
function BillDetail({ localDb, localId, render, onClose }: { localDb: KiranaBillDB; localId: string; render: RenderReceiptFiles; onClose: () => void }) {
  useBackEntry("kbBillDetail", onClose);
  const [receipt, setReceipt] = useState<ReceiptModel | null>(null);
  useEffect(() => {
    let live = true;
    loadReceipt(localDb, localId)
      .then((r) => live && setReceipt(r))
      .catch((err: unknown) => console.warn("[history] receipt read failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb, localId]);
  const saved = useMemo(() => (receipt ? { localId, receiptNumber: receipt.receiptNumber, receipt } : null), [localId, receipt]);
  const share = useReceiptShare({ localDb, saved, render });
  return (
    <section aria-label="Bill" className="fixed inset-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Bill</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {receipt && <Receipt receipt={receipt} />}
          {share && <ShareBar share={share} />}
        </div>
      </div>
    </section>
  );
}
