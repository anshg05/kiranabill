import type { KiranaBillDB, LocalReviewCapture } from "./db";

// KB-404 (D80), S2: the review capture - the owner's way to see "what was said" beside "what was billed" for the pilot's
// bills. The only honest test of "no silent number errors" is a human reading the pair; no automatic number can find an
// error nobody noticed.
// DEVICE-ONLY and OPT-IN, by design:
//  - OFF by default; switched on in Developer mode, in person, on the pilot shop's phone(s); the billing screen shows a
//    "Review mode" badge while it is on;
//  - kept in the signed-in user's own database on THIS phone: never pushed (sync.ts does not know the table), never in the
//    backup (it is not on the server) and never in any export;
//  - purged after 30 days (on every start), by "Clear now", and when the shopkeeper signs out.
// A transcript can contain a customer's spoken name or number - that is why it never leaves the shop's own phone.

export const REVIEW_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const flagKey = (shopId: string) => `reviewCapture:${shopId}`;

export async function isReviewCaptureOn(localDb: KiranaBillDB, shopId: string): Promise<boolean> {
  return (await localDb.meta.get(flagKey(shopId)))?.value === "on";
}

const listeners = new Set<() => void>();
/** The billing screen's "Review mode" badge follows the switch in Developer mode. */
export function subscribeReviewMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export async function setReviewCapture(localDb: KiranaBillDB, shopId: string, on: boolean): Promise<void> {
  await localDb.meta.put({ key: flagKey(shopId), value: on ? "on" : "off" });
  listeners.forEach((cb) => cb());
}

/** One utterance's pair. Only when the switch is on; never throws (a capture failure must not touch the bill). */
export async function captureUtterance(localDb: KiranaBillDB, shopId: string, entry: Omit<LocalReviewCapture, "id" | "shopId" | "capturedAt">, nowMs: number = Date.now()): Promise<void> {
  try {
    if (!(await isReviewCaptureOn(localDb, shopId))) return;
    await localDb.reviewCapture.add({ ...entry, shopId, capturedAt: new Date(nowMs).toISOString() });
  } catch (err) {
    console.warn("[review] capture failed:", err instanceof Error ? err.name : "error");
  }
}

/** Everything older than 30 days goes. Returns how many were removed. */
export async function purgeReviewCapture(localDb: KiranaBillDB, nowMs: number = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - REVIEW_RETENTION_DAYS * DAY_MS).toISOString();
  return localDb.reviewCapture.where("capturedAt").below(cutoff).delete();
}

/** "Clear now", and sign-out: every pair of this shop on this phone. */
export async function clearReviewCapture(localDb: KiranaBillDB, shopId: string): Promise<number> {
  return localDb.reviewCapture.where("shopId").equals(shopId).delete();
}

/** Sign-out: the pairs go first, then the session ends - a failed clear never blocks signing out. */
export async function clearThenSignOut(localDb: KiranaBillDB | null, shopId: string | null, signOut: () => Promise<unknown> | unknown): Promise<void> {
  if (localDb && shopId) await clearReviewCapture(localDb, shopId).catch(() => {});
  await signOut();
}

export async function listReviewCapture(localDb: KiranaBillDB, shopId: string): Promise<LocalReviewCapture[]> {
  return (await localDb.reviewCapture.where("shopId").equals(shopId).toArray()).sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}
