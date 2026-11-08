import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { prepareParserCatalog } from "../../src/domain/catalogIndex.js";

/**
 * Owner, 1 Nov 2026 (rule 1): products the eval catalog DOES have, under another spelling than the owner's - reviewed by hand. Used only to
 * SCORE (scoringCatalog); the app under test keeps the plain catalog. सैगी मूंग and काटा चना are left out: which product they are is not certain.
 */
export const SCORING_SPELLINGS: Readonly<Record<string, string>> = {
  // "फुटाने" (Futana) left this list on 9 Nov 2026: it is a real catalog alias now (KB-383 follow-up)
  "रिन साबुन": "192", // Rin
  "पार्ले जी बिस्किट": "53", // Parle-G 30 (A57: "30 वाला")
  "फेना साबुन": "614", // Sabun (alias फेना, Rs 10)
  "फेना डिटर्जेंट": "472", // Fena Detergent
  "गुड डे बिस्किट": "57", // Good Day
  "कुलथा दाना": "630", // कुलथा
  "पतला पोहा": "14", // Poha (the variety spoken as part of the name)
  "जाड़ा पोहा": "14",
  // KB-379 (owner-confirmed, 7 Nov 2026): one product in another script or spacing - not a wrong product
  "लाइज़ॉल": "200", // Lizol (A27)
  "टूथ ब्रश": "172", // Toothbrush (A50)
  "ग्राउंडनट ऑयल": "37", // Moongfali Tel (A49)
  "ग्राउंडनट ऑइल": "37",
};

/** The catalog a bill is JUDGED against: the same products, plus the owner's spellings above as aliases. */
export function scoringCatalog(shop: ParserCatalog): ParserCatalog {
  const extra = new Map<string, string[]>();
  for (const [name, id] of Object.entries(SCORING_SPELLINGS)) extra.set(id, [...(extra.get(id) ?? []), name]);
  return prepareParserCatalog(shop.entries.map((e) => (extra.has(e.id) ? { ...e, aliases: [...e.aliases, ...extra.get(e.id)!] } : e)));
}
