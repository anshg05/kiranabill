import type { MinVersion } from "./minVersion";
import { isNativeApp } from "./nativeSignIn";

// D116 (owner, 19 Nov 2026): the "Please update" decision's plain parts. The app never waits on the network for it: the LAST minimum
// it saw is kept on the phone and decides at once; the server is asked in the background with a 5 s limit, and a failed or slow
// answer keeps the stored value (none stored = the app opens). Only the bundled Android app checks - never the website.

export const MIN_VERSION_KEY = "kb.minVersion.v1";
export const CHECK_TIMEOUT_MS = 5_000;
/** The bundled app's own origin (capacitor.config.ts androidScheme + hostname; the same as netlify/functions/_shared/cors.ts). */
export const BUNDLED_APP_ORIGIN = "https://localhost";

export const isBelow = (appVersionCode: number, min: MinVersion | null): boolean => min !== null && appVersionCode < min.minVersionCode;

/** Only the bundled Android app: the website, and the old shell that loads it, never check. */
export const gateApplies = (): boolean => isNativeApp() && typeof window !== "undefined" && window.location.origin === BUNDLED_APP_ORIGIN;

export function readStoredMin(): MinVersion | null {
  try {
    const v = JSON.parse(localStorage.getItem(MIN_VERSION_KEY) ?? "null") as { minVersionCode?: unknown; updateUrl?: unknown } | null;
    if (!v || !Number.isInteger(v.minVersionCode) || (v.minVersionCode as number) < 1) return null;
    return { minVersionCode: v.minVersionCode as number, updateUrl: typeof v.updateUrl === "string" ? v.updateUrl : null };
  } catch {
    return null;
  }
}

function storeMin(m: MinVersion): void {
  try {
    localStorage.setItem(MIN_VERSION_KEY, JSON.stringify(m));
  } catch {
    // no storage: the next start asks again
  }
}

/** Asks the server (CHECK_TIMEOUT_MS at most). A good answer is stored and returned; anything else returns the stored value. */
export async function refreshMin(fetcher: (signal: AbortSignal) => Promise<MinVersion>, timeoutMs = CHECK_TIMEOUT_MS): Promise<MinVersion | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const fresh = await fetcher(ctrl.signal);
    storeMin(fresh);
    return fresh;
  } catch {
    return readStoredMin();
  } finally {
    clearTimeout(timer);
  }
}
