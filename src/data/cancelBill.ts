import { cancelBlocker, isCancelReason, type CancelReason } from "@/domain/cancelBill";
import { billSearchRowOf, type KiranaBillDB, type LocalBill, type LocalBillCancellation } from "./db";

// KB-325 (docs/07-DECISIONS.md D79): cancel a finalised bill. LOCAL first, like Bill Banao: one Dexie transaction that
// changes the bill's STATUS and nothing else (hard rule 2 - the server's bills_enforce_immutability refuses anything
// more), writes the cancellation record (reason, time, link to the replacement draft) and flags the bill's search row.
// Sync pushes it afterwards (bills first, then cancel_bill()); another device pulls it (applyCancellations).

export interface CancelInput {
  readonly shopId: string;
  readonly billLocalId: string;
  readonly reason: CancelReason;
  readonly deviceId: string;
  /** The draft started to replace this bill (its future local id), or null for "Cancel only". */
  readonly replacementLocalId: string | null;
  /** Injected in tests; the clock otherwise. */
  readonly nowMs?: number;
}

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelBillLocal(localDb: KiranaBillDB, input: CancelInput): Promise<CancelResult> {
  if (!isCancelReason(input.reason)) return { ok: false, error: "Choose a reason" };
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  return localDb.transaction("rw", [localDb.bills, localDb.billCancellations, localDb.billSearch, localDb.billItems], async (): Promise<CancelResult> => {
    const bill = await localDb.bills.get(input.billLocalId);
    if (!bill || bill.shopId !== input.shopId) return { ok: false, error: "That bill isn't on this phone" };
    const blocker = cancelBlocker(bill, (await localDb.billCancellations.get(bill.localId)) !== undefined);
    if (blocker) return { ok: false, error: blocker };
    // A synced bill goes back to pending so its status change is pushed. A bill in permanent conflict stays in conflict:
    // cancelling never quietly retries a bill the server refused.
    const syncStatus = bill.syncStatus === "synced" ? "pending" : bill.syncStatus;
    await localDb.bills.update(bill.localId, { status: "cancelled", syncStatus });
    await localDb.billCancellations.add({
      localId: crypto.randomUUID(),
      shopId: bill.shopId,
      billLocalId: bill.localId,
      reason: input.reason,
      replacementLocalId: input.replacementLocalId,
      cancelledAt: nowIso,
      deviceId: input.deviceId,
      syncStatus: "pending",
      updatedAt: nowIso,
    });
    await flagSearchRow(localDb, { ...bill, status: "cancelled" });
    return { ok: true };
  });
}

/** The bill's History search row, kept and flagged cancelled (made from the stored items, like finalise's). */
async function flagSearchRow(localDb: KiranaBillDB, bill: LocalBill): Promise<void> {
  const items = await localDb.billItems.where("billLocalId").equals(bill.localId).toArray();
  await localDb.billSearch.put(billSearchRowOf(bill, items));
}

/**
 * A cancellation made on another device (pulled into billCancellations): the bill this phone holds as final becomes
 * cancelled - status only, its sync state untouched (it is already on the server). Safe to run every cycle: a bill that is
 * not here yet is applied when it arrives. Returns how many bills changed.
 */
export async function applyCancellations(localDb: KiranaBillDB, shopId: string): Promise<number> {
  return localDb.transaction("rw", [localDb.bills, localDb.billCancellations, localDb.billSearch, localDb.billItems], async () => {
    const rows = await localDb.billCancellations.where("shopId").equals(shopId).toArray();
    const bills = await localDb.bills.bulkGet(rows.map((r) => r.billLocalId));
    let changed = 0;
    for (const bill of bills) {
      if (!bill || bill.shopId !== shopId || bill.status !== "final") continue;
      await localDb.bills.update(bill.localId, { status: "cancelled" });
      await flagSearchRow(localDb, { ...bill, status: "cancelled" });
      changed += 1;
    }
    return changed;
  });
}

export interface LinkedBill {
  readonly localId: string;
  readonly receiptNumber: string;
}

export interface CancellationInfo {
  /** This bill was cancelled: why and when. */
  readonly cancellation: LocalBillCancellation | null;
  /** The bill made from the draft this one was cancelled for - null while it is not made ("No replacement bill made"). */
  readonly replacedBy: LinkedBill | null;
  /** The cancelled bill this one replaces: found by looking up the cancellations whose replacement is THIS bill (no bills column). */
  readonly replaces: LinkedBill | null;
}

const linked = (b: LocalBill | undefined): LinkedBill | null => (b ? { localId: b.localId, receiptNumber: b.receiptNumber } : null);

export async function loadCancellationInfo(localDb: KiranaBillDB, billLocalId: string): Promise<CancellationInfo> {
  const cancellation = (await localDb.billCancellations.get(billLocalId)) ?? null;
  const replacedBy = cancellation?.replacementLocalId ? linked(await localDb.bills.get(cancellation.replacementLocalId)) : null;
  const predecessor = await localDb.billCancellations.where("replacementLocalId").equals(billLocalId).first();
  const replaces = predecessor ? linked(await localDb.bills.get(predecessor.billLocalId)) : null;
  return { cancellation, replacedBy, replaces };
}
