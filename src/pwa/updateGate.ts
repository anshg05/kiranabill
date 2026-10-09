import { useEffect, useId } from "react";

// KB-401 (docs/07-DECISIONS.md D67): "is it safe to reload the page right now?" Every screen that holds something a
// reload would lose says so (useUpdateGate(false)); the billing screen says "safe" only for an empty bill with
// nothing open; the sign-in screen has nothing to lose. Safe means: at least one screen has reported AND none says
// no - a screen that never reports is never assumed idle.

const gates = new Map<string, boolean>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export const isUpdateSafe = (): boolean => gates.size > 0 && [...gates.values()].every(Boolean);

export function setGate(key: string, safe: boolean): void {
  if (gates.get(key) === safe) return;
  gates.set(key, safe);
  emit();
}

function clearGate(key: string): void {
  if (gates.delete(key)) emit();
}

export function onUpdateSafetyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Tests only. */
export function resetUpdateGate(): void {
  gates.clear();
  emit();
}

/** Report from a mounted screen: `safe` false = "a reload would lose something here". */
export function useUpdateGate(safe: boolean): void {
  const id = useId();
  useEffect(() => () => clearGate(id), [id]);
  useEffect(() => setGate(id, safe), [id, safe]);
}
