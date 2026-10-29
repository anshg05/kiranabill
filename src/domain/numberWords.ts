// KB-361 (owner, 29 Oct 2026): every Hindi number word 1-100 - Devanagari and Roman, with the spellings Whisper actually writes -
// so a price like "अठ्यासी रुपए किलो" (88) or "छियानवे" (96) is read by rule and never needs Gemini. Pure data and pure functions
// (hard rule 3: no import but domain's own normaliser).
//
// EXACT LOOKUP ONLY. There is no fuzzy matching anywhere: a fuzzy number could turn a product word into a price, the one thing this
// app must not do. A word that is not in this table is simply not a number (it stays part of the name, or an orphaned price word that
// sends the piece to Layer 2 - "चैन" for 96 is never guessed). Spelling variants are produced from a few reviewed rules (below) and
// every one is checked: the tests assert that no two different numbers share a spelling, that no spelling is an everyday word, and
// that no spelling is a word in the seed catalog's names.

import { normalizeDevanagari } from "./catalogIndex";

/** 1..100, the standard spelling of each (the owner's reviewed list). Index i is the number i + 1. */
export const CANONICAL_DEVANAGARI: readonly string[] = (
  "एक दो तीन चार पाँच छह सात आठ नौ दस " +
  "ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस " +
  "इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस " +
  "इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस " +
  "इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास " +
  "इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ " +
  "इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर " +
  "इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी " +
  "इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे " +
  "इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे सौ"
).split(" ");

/** Other standard or colloquial spellings that the rules below do not make (value -> spellings). */
const EXTRA_DEVANAGARI: Readonly<Record<number, string>> = {
  5: "पांच पाच पान्च",
  6: "छः छे छै",
  14: "चौदा",
  25: "पचीस",
  44: "चवालीस चौआलीस चौंवालीस",
  49: "उन्चास उंचास उनंचास",
  53: "तिरेपन तिरपन",
  54: "चौअन चवन",
  63: "तिरेसठ",
  67: "सरसठ सड़सठ",
  69: "उन्हत्तर उनहतर",
  78: "अठत्तर अठहत्तर",
  79: "उनासी उन्नासी उन्यासी",
  81: "इकासी इक्यासी",
  88: "अठ्यासी अठ्यासि अठ्यास्थी अठयासी अठासी",
  90: "नव्वे नब्बे",
  91: "इकानवे इक्यानवे",
  92: "बयानवे बानवे",
  96: "छ्यानो छियानो छयानवे छ्यानवे छियानबे",
  99: "निनानवे निन्यानवें",
  100: "सौ",
};

/** The Roman (Hinglish) spelling Whisper and the shopkeepers use, 1..100 - one or two standard forms each; the rules add the rest. */
export const CANONICAL_ROMAN: readonly string[] = [
  "ek", "do", "teen tin", "char chaar", "paanch panch paach", "chhe chhah chhey", "saat", "aath", "nau nav", "das",
  "gyarah gyaarah", "barah baarah", "terah", "chaudah", "pandrah", "solah", "satrah", "atharah", "unnees unnis", "bees",
  "ikkees ikkis ekkis", "baees baais", "teis", "chaubees chaubis", "pachchees pachees pachis", "chhabbees chhabbis", "sattaees sattais", "atthaees atthais", "untees untis", "tees",
  "ikattis ikatees", "battees battis", "taintees taintis", "chauntees chauntis", "paintees paintis", "chhattees chhattis", "saintees saintis", "adtees adtis", "untaalees untalis", "chaalees chalis",
  "iktaalees iktalis", "bayaalees bayalis", "taintaalees taintalis", "chauwaalees chavalis", "paintaalees paintalis", "chhiyaalees chhiyalis", "saintaalees saintalis", "adtaalees adtalis", "unchaas unchas", "pachaas pachas",
  "ikyaavan ikyavan", "baavan bavan", "tirpan tirepan", "chauvan chauwan", "pachpan", "chhappan", "sattaavan sattavan", "atthaavan atthavan", "unsath", "saath",
  "iksath", "baasath basath", "tirsath", "chaunsath", "painsath", "chhiyaasath chhiyasath", "sadsath", "adsath", "unhattar", "sattar",
  "ikhattar", "bahattar", "tihattar", "chauhattar", "pachhattar", "chhihattar", "sathattar", "athhattar", "unyaasi unyasi", "assi",
  "ikyaasi ikyasi", "bayaasi bayasi", "tiraasi tirasi", "chauraasi chaurasi", "pachaasi pachasi", "chhiyaasi chhiyasi", "sattaasi sattasi", "atthaasi atthasi athasi", "navaasi navasi", "nabbe",
  "ikyaanve ikyanve", "baanve banve", "tiraanve tiranve", "chauraanve chauranve", "pachaanve pachanve", "chhiyaanve chhiyanve", "sattaanve sattanve", "atthaanve atthanve", "ninyaanve ninyanve", "sau",
];

/** Short or everyday words the rules must never make into a number (a spelling of "with", "tea", "yours", "big" ...). */
export const NEVER_A_NUMBER: ReadonlySet<string> = new Set([
  "sat", "sath", "pach", "chah", "che", "bis", "tis", "asi", "no", "ath", "aat", "bara", "tera", "sola", "tin", "dus",
  "तिस", "असी", "बारा", "तेरा", "सोला", "नो",
]);

// ---- spelling rules (reviewed; each is applied to a word of three or more letters) ------------------------------------------
const DEVA_RULES: readonly ((w: string) => string)[] = [
  (w) => w.replace(/[ंँ]/g, ""), //             पांच -> पाच, तैंतीस -> तैतीस (a dropped nasal)
  (w) => w.replace(/ं([दतधथ])/g, "न्$1"), //     पंद्रह -> पन्द्रह
  (w) => w.replace(/न्([दतधथ])/g, "ं$1"), //     पन्द्रह -> पंद्रह
  (w) => w.replace(/ी/g, "ि").replace(/ू/g, "ु").replace(/ई/g, "इ"), //   short vowels: बाईस -> बाइस
  (w) => w.replace(/ै/g, "े"), //                सैंतीस -> सेंतीस
  (w) => w.replace(/ौ/g, "ो"), //                चौदह -> चोदह
  (w) => w.replace(/([क-ह])्\1/g, "$1").replace(/ट्ठ|ठ्ठ/g, "ठ"), // a doubled consonant once: सत्तावन -> सतावन, अट्ठाईस -> अठाईस
  (w) => w.replace(/नवे/g, "नबे").replace(/नवें/g, "नबें"), //   इक्यानवे -> इक्यानबे
  (w) => w.replace(/े$/, "ें"), //               नवे -> नवें
  (w) => w.replace(/छिया/g, "छ्या").replace(/छिया/g, "छया"), // छियानवे -> छ्यानवे / छयानवे
  (w) => w.replace(/नवे$/, "नो"), //             छियानवे -> छियानो
  (w) => w.replace(/^अड़|^अड/, "अठ"), //          अड़तीस -> अठतीस
];
const ROMAN_RULES: readonly ((w: string) => string)[] = [
  (w) => w.replace(/aa/g, "a"),
  (w) => w.replace(/ee/g, "i"),
  (w) => w.replace(/([b-df-hj-np-tv-z])\1/g, "$1"), // a doubled consonant once
  (w) => w.replace(/chh/g, "ch"),
  (w) => w.replace(/nve$/, "nbe"),
  (w) => w.replace(/nve$/, "nwe"),
];

function closure(word: string, rules: readonly ((w: string) => string)[], depth: number): Set<string> {
  let layer = new Set([word]);
  const all = new Set([word]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const w of layer) for (const rule of rules) {
      const v = rule(w);
      if (v !== w && !all.has(v)) next.add(v);
    }
    for (const v of next) all.add(v);
    layer = next;
  }
  return all;
}

export interface NumberWordTable {
  readonly words: Readonly<Record<string, number>>;
  /** Spellings claimed by two different numbers - must be empty (the tests assert it). */
  readonly collisions: readonly string[];
}

export function buildNumberWords(): NumberWordTable {
  const words: Record<string, number> = {};
  const collisions: string[] = [];
  const add = (spelling: string, value: number) => {
    const key = normalizeDevanagari(spelling.toLowerCase());
    if (key.length === 0 || NEVER_A_NUMBER.has(key)) return;
    if (key in words && words[key] !== value) collisions.push(key);
    else words[key] = value;
  };
  const longEnough = (w: string) => [...w].length >= 3;
  // 100 ("सौ" / "sau") is NOT in the table: it is the grammar's MULTIPLIER ("सवा सौ" = 125, "दो सौ" = 200, "एक सौ दस" = 110) and
  // must stay one - as a plain number "सवा सौ" would read 100.25.
  CANONICAL_DEVANAGARI.forEach((w, i) => {
    const value = i + 1;
    if (value === 100) return;
    const forms = [w, ...(EXTRA_DEVANAGARI[value]?.split(" ") ?? [])];
    for (const f of forms) {
      add(f, value);
      if (longEnough(f)) for (const v of closure(f, DEVA_RULES, 3)) add(v, value);
    }
  });
  CANONICAL_ROMAN.forEach((entry, i) => {
    const value = i + 1;
    if (value === 100) return;
    for (const f of entry.split(" ")) {
      add(f, value);
      if (f.length >= 5) for (const v of closure(f, ROMAN_RULES, 2)) if (v.length >= 4) add(v, value);
    }
  });
  return { words, collisions };
}

const TABLE = buildNumberWords();
/** spelling (as the tokenizer sees it: lower-case, normalised) -> value. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = TABLE.words;
export const NUMBER_WORD_COLLISIONS: readonly string[] = TABLE.collisions;
