import { useCallback, useSyncExternalStore } from "react";
import { render, translateEnglish, type Language, type MessageId } from "@/domain/messages";
import { getScreenLanguage, subscribeScreenLanguage } from "./screenLanguage";

/** KB-332 (D84): `t` says a catalog message, `tx` says an English sentence the domain built - both in the chosen language, live. */
export type Translate = (id: MessageId, params?: Readonly<Record<string, string | number>>) => string;

export function useT(): { lang: Language; t: (id: MessageId, params?: Readonly<Record<string, string | number>>) => string; tx: (english: string) => string } {
  const lang = useSyncExternalStore(subscribeScreenLanguage, getScreenLanguage, getScreenLanguage);
  const t = useCallback((id: MessageId, params: Readonly<Record<string, string | number>> = {}) => render(id, params, lang), [lang]);
  const tx = useCallback((english: string) => translateEnglish(english, lang), [lang]);
  return { lang, t, tx };
}
