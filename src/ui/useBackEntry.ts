import { useEffect, useRef } from "react";
import { useUpdateGate } from "@/pwa/updateGate";

// Android back for an overlay (Add item panel KB-305, History / bill detail
// KB-310): a history entry while it's open; popstate closes it. A normal close
// takes the entry back off, so the next back isn't swallowed. Nested overlays
// each own one entry - back closes the top one only. StrictMode (dev) mounts,
// unmounts and re-mounts at once: the entry is pushed once, and the unmount's
// back() is deferred so the re-mount can cancel it.
//
// KB-325 follow-up: an overlay closes only when history has gone BELOW its own
// entry. It used to close on any popstate whose state wasn't its own, so with
// three open (History > bill > Cancel sheet) closing the top one landed on the
// middle entry and the bottom one closed too. `stack` is the open overlays'
// tokens, bottom first; `pending` the tokens whose close is waiting for its back().

const stack: string[] = [];
const pending = new Set<string>();
// Overlays that closed and whose entry is still in history. Several can close together (Cancel and make a new bill closes
// History, the bill and the sheet at once): each entry comes off only when it is the current one, one back() at a time.
const closing = new Set<string>();
let backing = false;
let listening = false;

function drain(): void {
  const now = tokenOf(window.history.state);
  if (backing || now === undefined || !closing.delete(now)) return;
  backing = true;
  window.history.back();
}
function ensureListening(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", () => {
    backing = false;
    drain();
  });
}

const tokenOf = (state: unknown): string | undefined =>
  Object.values((state ?? {}) as Record<string, unknown>).find((v): v is string => typeof v === "string");

export function useBackEntry(key: string, onClose: () => void): void {
  useUpdateGate(false); // KB-401: an open overlay is never reloaded under the shopkeeper
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const entry = useRef<{ token: string; pendingBack: ReturnType<typeof setTimeout> | null } | null>(null);
  useEffect(() => {
    if (!entry.current) {
      entry.current = { token: crypto.randomUUID(), pendingBack: null };
      // Re-opened before the last close's back() ran: take over its entry, never stack a second.
      // Only an entry no open overlay owns qualifies (a close still waiting, or one whose back() is on its way) - an overlay of the same kind that is still open (a bill opened over a bill) keeps its own.
      const current = window.history.state as Record<string, unknown> | null;
      const waiting = current?.[key];
      if (typeof waiting === "string" && (pending.has(waiting) || !stack.includes(waiting))) {
        window.history.replaceState({ [key]: entry.current.token }, "");
        const at = stack.indexOf(waiting);
        if (at >= 0) stack[at] = entry.current.token;
        else stack.push(entry.current.token);
        pending.delete(waiting);
      } else {
        window.history.pushState({ [key]: entry.current.token }, "");
        stack.push(entry.current.token);
      }
    }
    const mine = entry.current;
    if (mine.pendingBack) clearTimeout(mine.pendingBack);
    mine.pendingBack = null;
    pending.delete(mine.token);
    let closedByBack = false;
    const onPop = () => {
      // On my entry, or on one of an overlay opened above me: still open.
      const now = tokenOf(window.history.state);
      const here = now === undefined ? -1 : stack.indexOf(now);
      if (here >= stack.indexOf(mine.token) && stack.indexOf(mine.token) >= 0) return;
      closedByBack = true;
      const at = stack.indexOf(mine.token);
      if (at >= 0) stack.splice(at, 1);
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    // KB-342: Escape closes the TOP overlay only (the one whose entry is last in the stack) - like Back. An editor that
    // uses Escape itself (EditableValue) stops it before it gets here.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || stack[stack.length - 1] !== mine.token) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      if (closedByBack) return;
      pending.add(mine.token);
      mine.pendingBack = setTimeout(() => {
        if (!pending.delete(mine.token)) return;
        const at = stack.indexOf(mine.token);
        if (at >= 0) stack.splice(at, 1);
        ensureListening();
        closing.add(mine.token);
        drain();
      }, 0);
    };
  }, [key]);
}
