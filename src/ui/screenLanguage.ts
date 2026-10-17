import type { Language } from "@/domain/messages";

// KB-332 (D84): the Screen language - per DEVICE (this browser), local, never synced, default English. localStorage so it is
// read synchronously at start (no flash of English); a missing or blocked storage is English, never an error.

const KEY = "kb.screenLanguage";
const VALID: readonly Language[] = ["en", "hi", "hl"];

function read(): Language {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v as Language) ? (v as Language) : "en";
  } catch {
    return "en";
  }
}

let current: Language = read();
const listeners = new Set<() => void>();

export const getScreenLanguage = (): Language => current;

export function setScreenLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* a blocked storage: the choice holds for this session only */
  }
  listeners.forEach((cb) => cb());
}

export function subscribeScreenLanguage(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
