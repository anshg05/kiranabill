import Dexie from "dexie";
import { buildFinalBill, type FinalFlag, type FinalLine } from "@/domain/finalBill";
import type { KiranaBillDB, LocalBill, LocalBillItem } from "./db";
import { takeNextNumber } from "./receiptNumbers";

// KB-307 commit 2 (owner, 3 Oct 2026; 16-APP-FLOW.md §4): Bill Banao is ONE
// atomic local write. Inside a single Dexie transaction: the receipt number
// (this device's block, or the D23 fallback), the bill (status final, sync
// pending) and its items. IndexedDB commits all of it or none of it - a crash
// or a failed write leaves no bill, no items and no number consumed. The bill
// is keyed by its localId (a UUID made when the bill started), so finalising
// it twice - a double tap, two tabs - writes one bill. Sync pushes it later
// through push_bill (D37); learning runs after, separately (KB-307 commit 3).

export const SAVE_FAILED = "Couldn't save the bill — try again";

/** bills.schema_version - stamped on every bill (03-DATA-MODEL.md). */
const SCHEMA_VERSION = 1;

export interface FinaliseInput {
  /** crypto.randomUUID() from when the bill started - bills.local_id is uuid (D37). */
  readonly localId: string;
  readonly shopId: string;
  readonly deviceId: string;
  /** When the bill started (bills.created_at). */
  readonly startedAt: string;
  readonly customer: { readonly name: string; readonly mobile: string | null };
  readonly lines: readonly FinalLine[];
  readonly flags: readonly FinalFlag[];
  /** Injected in tests; the clock otherwise. */
  readonly now?: Date;
}

export interface FinaliseResult {
  readonly receiptNumber: string;
  readonly source: "block" | "fallback";
  /** True when this bill was already saved (a second tap) - nothing new written. */
  readonly alreadySaved: boolean;
}

/**
 * Writes the bill, or returns the one already written under this localId.
 * Throws when the bill can't be a receipt (no items, a line without an
 * amount - the screen never offers Bill Banao then) or when the write fails;
 * either way nothing is written.
 */
export async function finaliseBill(localDb: KiranaBillDB, input: FinaliseInput): Promise<FinaliseResult> {
  const built = buildFinalBill(input.lines, input.flags);
  if (!built.ok) throw new Error(built.error);
  const finalizedAt = (input.now ?? new Date()).toISOString();

  const run = () =>
    localDb.transaction("rw", [localDb.bills, localDb.billItems, localDb.receiptNumberBlocks, localDb.syncState, localDb.shops], async () => {
      const existing = await localDb.bills.get(input.localId);
      if (existing) return { receiptNumber: existing.receiptNumber, source: existing.receiptNumberSource, alreadySaved: true };

      const receipt = await takeNextNumber(localDb, input.shopId, input.deviceId);
      const bill: LocalBill = {
        localId: input.localId,
        shopId: input.shopId,
        status: "final",
        syncStatus: "pending",
        receiptNumber: receipt.receiptNumber,
        receiptNumberSource: receipt.source,
        customerName: input.customer.name,
        customerMobile: input.customer.mobile,
        subtotalPaise: built.totalPaise,
        totalPaise: built.totalPaise,
        schemaVersion: SCHEMA_VERSION,
        deviceId: input.deviceId,
        createdAt: input.startedAt,
        finalizedAt,
        syncedAt: null,
      };
      await localDb.bills.add(bill);
      await localDb.billItems.bulkAdd(
        built.items.map((item): LocalBillItem => ({
          billLocalId: input.localId,
          shopId: input.shopId,
          lineNo: item.lineNo,
          shopProductId: item.shopProductId,
          displayName: item.displayName,
          spokenName: item.spokenName,
          qty: item.qty,
          unit: item.unit,
          ratePaise: item.ratePaise,
          rateUnit: item.rateUnit,
          totalPaise: item.totalPaise,
          priceType: item.priceType,
          source: item.source,
          reviewFlags: [...item.reviewFlags],
          wasEdited: item.wasEdited,
        })),
      );
      return { receiptNumber: receipt.receiptNumber, source: receipt.source, alreadySaved: false };
    });

  try {
    return await run();
  } catch (err) {
    // Two writers raced on the same localId (two tabs): the loser's add hit the
    // primary key and its transaction rolled back - the bill IS saved, by the
    // other writer. Read it back; never a second bill, never a second number.
    if (err instanceof Dexie.ConstraintError) {
      const saved = await localDb.bills.get(input.localId);
      if (saved) return { receiptNumber: saved.receiptNumber, source: saved.receiptNumberSource, alreadySaved: true };
    }
    throw err;
  }
}
