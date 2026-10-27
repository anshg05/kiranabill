import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB } from "./db";
import { finaliseBill as finaliseWithNumber, type FinaliseInput } from "./finalise";
import { takeFallbackNumber, type ServerNumber } from "./receiptNumbers";

// TEST HELPERS (KB-351): the old 50-number blocks are retired, so a test that needs "bill 1, bill 2 ..." takes the numbers the
// way the app now does - from a counter that is handed in. The tests that are about the numbering itself use requestBillNumber
// against the real stack (serverBillNumbers.e2e.test.ts).

/** A unique offline-style number ("7F2A91-1") for a hand-built LocalBill. */
export async function consumeNextNumber(_client: SupabaseClient, db: KiranaBillDB, _shopId: string, deviceId: string) {
  return { receiptNumber: await takeFallbackNumber(db, deviceId), source: "fallback" as const };
}

/** The next plain number for this local database: 1 + the bills already in it (what a one-phone shop's server counter would give). */
export async function nextCountedNumber(db: KiranaBillDB): Promise<string> {
  return String((await db.bills.count()) + 1);
}

/** finaliseBill with a counted server-style number unless the test passes one (`serverNumber: null` = an explicit offline number). */
export async function finaliseBill(db: KiranaBillDB, input: FinaliseInput) {
  return finaliseWithNumber(db, input.serverNumber === undefined ? { ...input, serverNumber: await nextCountedNumber(db) } : input);
}

/** For useFinalise({ getNumber }): the same counted number, shaped as requestBillNumber answers. */
export const countedGetNumber =
  (db: KiranaBillDB) =>
  async (): Promise<ServerNumber> => ({ receiptNumber: await nextCountedNumber(db), source: "counter", ms: 5 });
