import { useEffect, useRef } from "react";
import { useUpdateGate } from "@/pwa/updateGate";

// Android back for an overlay (Add item panel KB-305, History / bill detail
// KB-310): a history entry while it's open; popstate closes it. A normal close
// takes the entry back off, so the next back isn't swallowed. Nested overlays
// each own one entry - back closes the top one only. StrictMode (dev) mounts,
// unmounts and re-mounts at once: the entry is pushed once, and the unmount's
// back() is deferred so the re-mount can cancel it.

export function useBackEntry(key: string, onClose: () => void): void {
  useUpdateGate(false); // KB-401: an open overlay is never reloaded under the shopkeeper
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const entry = useRef<{ token: string; pendingBack: ReturnType<typeof setTimeout> | null } | null>(null);
  useEffect(() => {
    if (!entry.current) {
      entry.current = { token: crypto.randomUUID(), pendingBack: null };
      // Re-opened before the last close's back() ran: take over its entry, never stack a second.
      const current = window.history.state as Record<string, unknown> | null;
      if (typeof current?.[key] === "string") window.history.replaceState({ [key]: entry.current.token }, "");
      else window.history.pushState({ [key]: entry.current.token }, "");
    }
    const mine = entry.current;
    if (mine.pendingBack) clearTimeout(mine.pendingBack);
    mine.pendingBack = null;
    const onOurEntry = () => (window.history.state as Record<string, unknown> | null)?.[key] === mine.token;
    let closedByBack = false;
    const onPop = () => {
      if (onOurEntry()) return; // came forward onto it again - nothing to close
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedByBack) mine.pendingBack = setTimeout(() => onOurEntry() && window.history.back(), 0);
    };
  }, [key]);
}
