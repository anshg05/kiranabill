import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB } from "@/data/db";

// KB-351 (owner, 22 Oct 2026; D92, supersedes D22 and D74 sections 1, 2 and 4): ONE bill-number sequence for the whole shop.
// Online, Bill Banao takes the next number from the server - an atomic per-shop counter (next_bill_number, SECURITY INVOKER,
// RLS the boundary), so two phones saving at the same moment get 5 and 6. Offline, or when the server is too slow, the bill
// saves AT ONCE with the KB-341 offline number and keeps it for ever (the customer may already hold the receipt). Never
// "number pending", never an error. The old 50-number blocks are retired: an offline pool would put 353 beside 5.

/** The CAP only (owner): normally the answer comes in one warm round trip, ~100-250 ms from Nagpur to Mumbai. */
export const NUMBER_CAP_MS = 1500;
/** After one failure the server is not asked for this long, so every following bill is not slowed by the same bad connection. */
export const BREAKER_MS = 30_000;
/** warmServer asks at most this often - the connection (DNS, TCP, TLS) is warm for the first Bill Banao. */
export const WARM_EVERY_MS = 20_000;

const FALLBACK_COUNTER_KEY = "receiptNumberFallback";

/**
 * KB-341 (D87, supersedes D23): "7F2A91-1" - the first 6 characters of the device UUID, upper-case, then this device's
 * counter. Two devices of one shop sharing a code is accepted at about 1 in 1.7 million for 5 devices (owner): both then
 * count 1, 2 ... so the second bill to push is refused by unique (shop_id, receipt_number) - that bill stays final on its
 * phone in permanent conflict, never silently wrong. Old numbers with the full UUID stay as saved.
 */
const formatFallbackNumber = (deviceId: string, n: number): string => `${deviceId.slice(0, 6).toUpperCase()}-${n}`;

export interface ServerNumber {
  /** The plain number: "59". */
  readonly receiptNumber: string;
  readonly source: "counter";
  /** The round trip, for the metrics (bill_metrics.number_ms). */
  readonly ms: number;
}

let blockedUntil = 0;
let lastServerTouch = 0;

/** The breaker and the warm clock are per page load - forgotten by the tests. */
export function resetNumberState(): void {
  blockedUntil = 0;
  lastServerTouch = 0;
}

const browserOffline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * The next number of the shop's sequence for THIS bill, or null (offline, breaker open, error, refused, or no answer within
 * the cap) - then the bill takes an offline number. Asking again for the same bill returns the same number (bill_number_grants),
 * so a double tap or a lost response never burns one. Never throws.
 */
export async function requestBillNumber(
  client: SupabaseClient,
  shopId: string,
  billLocalId: string,
  opts: { capMs?: number } = {},
): Promise<ServerNumber | null> {
  if (browserOffline() || Date.now() < blockedUntil) return null;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = (): null => {
    blockedUntil = Date.now() + BREAKER_MS;
    return null;
  };
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), opts.capMs ?? NUMBER_CAP_MS);
    });
    const reply = await Promise.race([Promise.resolve(client.rpc("next_bill_number", { p_shop_id: shopId, p_local_id: billLocalId })), timeout]);
    if (reply === "timeout") return failed();
    const n = typeof reply.data === "string" && /^[0-9]+$/.test(reply.data) ? Number(reply.data) : reply.data;
    if (reply.error || typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) return failed();
    lastServerTouch = Date.now();
    return { receiptNumber: String(n), source: "counter", ms: lastServerTouch - started };
  } catch (err) {
    console.warn("[receiptNumbers] no server number:", err instanceof Error ? err.name : "error"); // only a name - never a message
    return failed();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Called when a bill gets its first line: one cheap question (the sync probe) so the connection is warm by the time Bill
 * Banao is tapped - the first bill of a session must not be the slow one. Not more than every WARM_EVERY_MS; never throws,
 * never awaited, and a failure is silent (the number request has its own cap).
 */
export function warmServer(client: SupabaseClient, shopId: string): void {
  if (browserOffline() || Date.now() - lastServerTouch < WARM_EVERY_MS) return;
  lastServerTouch = Date.now();
  void Promise.resolve(client.rpc("sync_probe", { p_shop_id: shopId })).catch(() => {});
}

/**
 * A device-local, ever-incrementing counter for the offline number. LOCAL tables only, so it can run inside finalise's Dexie
 * transaction (a failed finalise rolls the count back with everything else). Reused from the generic syncState table
 * (tableName as a key, pendingCount repurposed as the counter value) rather than adding a Dexie table for one number.
 */
export async function takeFallbackNumber(localDb: KiranaBillDB, deviceId: string): Promise<string> {
  const state = await localDb.syncState.get(FALLBACK_COUNTER_KEY);
  const next = (state?.pendingCount ?? 0) + 1;
  // Deliberate special-cased overload of syncState's schema for a single device-local counter under a fake "tableName" -
  // NOT a real per-table sync entry. Flagged so a future reader of the real syncState rows doesn't assume otherwise.
  await localDb.syncState.put({ tableName: FALLBACK_COUNTER_KEY, lastSyncedAt: null, cursor: null, pendingCount: next });
  return formatFallbackNumber(deviceId, next);
}
