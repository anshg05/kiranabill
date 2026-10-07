import { toSearchEntry, type SearchableBill, type SearchEntry } from "@/domain/billSearch";
import type { KiranaBillDB, LocalBill, SyncStatus } from "./db";

// KB-310 (owner's load design, 7 Oct 2026). History is this phone's bills
// (bills are pushed, never pulled). Measured on real IndexedDB at 40,000
// bills: reading every bill's items took ~4 s with anyOf, ~1.6 s as a full
// table scan; the newest 200 bills by the date index, 3 ms. So:
// - open: the newest rows from the date index, no items;
// - recent: bills since a date (the last 90 days) with items, in the background;
// - older (on demand): every bill, items by a full-table scan.
// Each bill's search text is built once here (toSearchEntry), not per keystroke.

/** One bill in History - never the customer's mobile. */
export interface HistoryRow extends SearchableBill {
  readonly localId: string;
  readonly syncStatus: SyncStatus;
}

const byNewest = (x: { at: string }, y: { at: string }) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0);

function row(b: LocalBill, items: HistoryRow["items"]): HistoryRow {
  return { localId: b.localId, receiptNumber: b.receiptNumber, customerName: b.customerName, totalPaise: b.totalPaise, at: b.finalizedAt ?? b.createdAt, syncStatus: b.syncStatus, items };
}

/** What History opens with: this shop's newest final bills, from the createdAt index, without items. */
export async function loadRecentRows(localDb: KiranaBillDB, shopId: string, limit: number): Promise<HistoryRow[]> {
  const bills = await localDb.bills
    .orderBy("createdAt")
    .reverse()
    .filter((b) => b.shopId === shopId && b.status === "final")
    .limit(limit)
    .toArray();
  return bills.map((b) => row(b, [])).sort(byNewest);
}

/** Search entries with items: bills since `since` (ISO), or every bill when null. Newest first. */
export async function loadSearchIndex(localDb: KiranaBillDB, shopId: string, since: string | null): Promise<SearchEntry<HistoryRow>[]> {
  const bills =
    since === null
      ? await localDb.bills.where("[shopId+status]").equals([shopId, "final"]).toArray()
      : await localDb.bills.where("createdAt").aboveOrEqual(since).filter((b) => b.shopId === shopId && b.status === "final").toArray();
  const ids = new Set(bills.map((b) => b.localId));
  // A full-table scan when loading everything (one shop per device in practice) - faster than anyOf at scale.
  const items =
    since === null
      ? (await localDb.billItems.toArray()).filter((i) => ids.has(i.billLocalId))
      : await localDb.billItems.where("billLocalId").anyOf([...ids]).toArray();
  const byBill = new Map<string, { displayName: string; spokenName: string | null; lineNo: number }[]>();
  for (const i of items) {
    const list = byBill.get(i.billLocalId) ?? [];
    list.push({ displayName: i.displayName, spokenName: i.spokenName, lineNo: i.lineNo });
    byBill.set(i.billLocalId, list);
  }
  return bills
    .map((b) => row(b, (byBill.get(b.localId) ?? []).sort((x, y) => x.lineNo - y.lineNo).map(({ displayName, spokenName }) => ({ displayName, spokenName }))))
    .sort(byNewest)
    .map(toSearchEntry);
}
