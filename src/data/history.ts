import Dexie from "dexie";
import type { BillSearchRow } from "@/domain/billSearch";
import type { KiranaBillDB, LocalBill, SyncStatus } from "./db";

// KB-310 (D60) and D61. History is this phone's bills (pushed, never pulled -
// KB-324). Measured on real Chrome IndexedDB at 40,000 bills: the newest 200
// by the date index take milliseconds; reading items by anyOf(bill ids) costs
// ~22 ms PER id (9,000 ids ~ 4 minutes). So:
// - the list: the newest rows from the bills' createdAt index, no items;
// - search: the device-only billSearch rows (D61), one range query - items are
//   read only when a bill's detail opens (loadReceipt).

/** One bill in the History list - never the customer's mobile. */
export interface HistoryRow {
  readonly localId: string;
  readonly receiptNumber: string;
  readonly customerName: string;
  readonly totalPaise: number;
  /** When it was finalised (ISO). */
  readonly at: string;
  readonly syncStatus: SyncStatus;
}

const byNewest = (x: { at: string }, y: { at: string }) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0);

function row(b: LocalBill): HistoryRow {
  return { localId: b.localId, receiptNumber: b.receiptNumber, customerName: b.customerName, totalPaise: b.totalPaise, at: b.finalizedAt ?? b.createdAt, syncStatus: b.syncStatus };
}

/** What History opens with: this shop's newest final bills, from the createdAt index, without items. */
export async function loadRecentRows(localDb: KiranaBillDB, shopId: string, limit: number): Promise<HistoryRow[]> {
  const bills = await localDb.bills
    .orderBy("createdAt")
    .reverse()
    .filter((b) => b.shopId === shopId && b.status === "final")
    .limit(limit)
    .toArray();
  return bills.map(row).sort(byNewest);
}

/**
 * D61: the search rows (device-only billSearch table) - bills finalised since
 * `since` (ISO), or all of this shop's when null. ONE range query on
 * [shopId+finalizedAt]; items are never read here (only when a bill opens).
 * Replaces anyOf over bill ids, measured ~22 ms per id on Chrome's IndexedDB.
 */
export async function loadSearchIndex(localDb: KiranaBillDB, shopId: string, since: string | null): Promise<BillSearchRow[]> {
  return localDb.billSearch
    .where("[shopId+finalizedAt]")
    .between([shopId, since ?? Dexie.minKey], [shopId, Dexie.maxKey], true, true)
    .reverse()
    .toArray();
}
