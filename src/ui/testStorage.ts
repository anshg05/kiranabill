import { vi } from "vitest";

/** Test support: Node 26's own `localStorage` getter shadows jsdom's (undefined without --localstorage-file), so tests that
 * need the browser's storage stub a Map-backed one. Returns the Map for assertions. */
export function stubLocalStorage(): Map<string, string> {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  });
  return m;
}
