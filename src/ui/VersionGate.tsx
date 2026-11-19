import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { APP_VERSION_CODE } from "@/data/appVersion";
import { fetchMinVersion, type MinVersion } from "@/data/minVersion";
import { supabase } from "@/data/supabaseClient";
import { gateApplies, isBelow, readStoredMin, refreshMin } from "@/data/versionGate";
import { isUpdateSafe, onUpdateSafetyChange } from "@/pwa/updateGate";

// D116 (owner, 19 Nov 2026): is this app below app_min_version? Decided at once from the value stored on the phone; asked again in
// the background at start and whenever the app comes back to the front. A block that arrives while a bill is being made waits for the
// safe moment (the update gate - never mid-bill). "Check again" (the Please update screen) asks at once and opens the app without a
// restart when the minimum came down. Offline never blocks: no answer keeps the last value seen.

interface VersionGateValue {
  blocked: boolean;
  updateUrl: string | null;
  /** Asks the server now (5 s limit, offline-safe) and applies the answer at once. */
  checkAgain: () => Promise<void>;
}

const OPEN: VersionGateValue = { blocked: false, updateUrl: null, checkAgain: () => Promise.resolve() };
const VersionGateContext = createContext<VersionGateValue>(OPEN);

export function VersionGateProvider({
  children,
  applies = gateApplies(),
  appVersionCode = APP_VERSION_CODE,
  fetcher = (signal: AbortSignal) => fetchMinVersion(supabase, signal),
}: {
  children: ReactNode;
  applies?: boolean;
  appVersionCode?: number;
  fetcher?: (signal: AbortSignal) => Promise<MinVersion>;
}) {
  const [min, setMin] = useState<MinVersion | null>(() => (applies ? readStoredMin() : null));
  const [blocked, setBlocked] = useState(() => applies && isBelow(appVersionCode, readStoredMin()));
  const waiting = useRef(false); // a block that arrived mid-bill, waiting for the safe moment
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const apply = useCallback(
    (m: MinVersion | null, now: boolean) => {
      if (m === null) return; // no answer and nothing stored: nothing changes
      setMin(m);
      if (!isBelow(appVersionCode, m)) {
        waiting.current = false;
        setBlocked(false);
      } else if (now || isUpdateSafe()) {
        waiting.current = false;
        setBlocked(true);
      } else {
        waiting.current = true;
      }
    },
    [appVersionCode],
  );

  const refresh = useCallback(async (now: boolean) => apply(await refreshMin((s) => fetchRef.current(s)), now), [apply]);

  useEffect(() => {
    if (!applies) return;
    void refresh(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    const offSafety = onUpdateSafetyChange(() => {
      if (waiting.current && isUpdateSafe()) {
        waiting.current = false;
        setBlocked(true);
      }
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      offSafety();
    };
  }, [applies, refresh]);

  const checkAgain = useCallback(() => refresh(true), [refresh]);
  const value = applies ? { blocked, updateUrl: min?.updateUrl ?? null, checkAgain } : OPEN;
  return <VersionGateContext.Provider value={value}>{children}</VersionGateContext.Provider>;
}

export const useVersionGate = (): VersionGateValue => useContext(VersionGateContext);
