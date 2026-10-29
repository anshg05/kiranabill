import { describe, expect, it } from "vitest";
import { normalizeDevanagari } from "./catalogIndex";
import { CANONICAL_DEVANAGARI, NEVER_A_NUMBER, NUMBER_WORDS, NUMBER_WORD_COLLISIONS } from "./numberWords";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-361 (owner, 29 Oct 2026): Layer 1 read only 28 of the 100 standard Devanagari number words, so prices like "अठ्यासी रुपए किलो"
// (88) or "छियानवे" (96) went to Gemini. The table reads all of them, with the spellings Whisper writes - by EXACT lookup, never fuzzy.

const value = (word: string): number | undefined => NUMBER_WORDS[normalizeDevanagari(word.toLowerCase())];

describe("the standard spelling of every number 1-100", () => {
  it("is exactly 100 words", () => {
    expect(CANONICAL_DEVANAGARI).toHaveLength(100);
  });
  it.each(CANONICAL_DEVANAGARI.slice(0, 99).map((w, i) => [i + 1, w] as const))("%i = %s", (n, word) => {
    expect(value(word)).toBe(n);
  });
  it("100 = सौ is the grammar's multiplier, not a table entry (so 'सवा सौ' stays 125)", () => {
    expect(CANONICAL_DEVANAGARI[99]).toBe("सौ");
    expect(value("सौ")).toBeUndefined();
    expect(value("sau")).toBeUndefined();
  });
});

describe("the spellings Whisper writes and shopkeepers say", () => {
  it.each([
    ["अठ्यासी", 88], ["अठ्यास्थी", 88], ["अठासी", 88], ["अट्ठासी", 88], ["छ्यानो", 96], ["छियानबे", 96], ["छ्यानवे", 96], ["छियानवे", 96],
    ["पचपन", 55], ["छप्पन", 56], ["सतावन", 57], ["अठावन", 58], ["नब्बे", 90], ["नव्वे", 90], ["पन्द्रह", 15], ["पंद्रह", 15], ["पन्द्रा", undefined],
    ["सत्तानवे", 97], ["अट्ठानवे", 98], ["निन्यानवे", 99], ["निन्यानबे", 99], ["पांच", 5], ["पाँच", 5], ["पाच", 5], ["छः", 6], ["बाइस", 22],
    ["तेइस", 23], ["पचीस", 25], ["उन्नीस", 19], ["अड़तीस", 38], ["अठतीस", 38], ["अड़तालीस", 48], ["अठतालीस", 48], ["अड़सठ", 68], ["अठसठ", 68],
    ["तैंतीस", 33], ["तैतीस", 33], ["चौंतीस", 34], ["चौसठ", 64], ["पैंसठ", 65], ["पैसठ", 65], ["उनचास", 49], ["उन्चास", 49], ["इक्यानवे", 91], ["इक्यानबे", 91],
    ["athasi", 88], ["atthasi", 88], ["chhiyanbe", 96], ["chhiyanve", 96], ["ikkees", 21], ["ikkis", 21], ["pachchees", 25], ["pachees", 25], ["baees", 22],
    ["ninyanve", 99], ["ninyanbe", 99], ["satasi", 87], ["athanve", 98], ["ikyanbe", 91], ["chhiyanwe", 96], ["pachpan", 55], ["chhappan", 56], ["nabbe", 90], ["assi", 80], ["sattar", 70], ["pachaas", 50], ["pachas", 50],
  ] as const)("%s -> %s", (word, n) => {
    expect(value(word)).toBe(n);
  });
});

describe("never wrong, never fuzzy", () => {
  it("no spelling belongs to two different numbers", () => {
    expect(NUMBER_WORD_COLLISIONS).toEqual([]);
  });
  it("a misheard word is NOT a number ('चैन' for 96 stays unread)", () => {
    for (const w of ["चैन", "अठ्यास", "छियान", "पचप", "आठसी", "xyz", "अठ्यासीx"]) expect(value(w), w).toBeUndefined();
  });
  it("short or everyday words are never numbers: with, tea, yours, big, 'no' ...", () => {
    for (const w of NEVER_A_NUMBER) expect(value(w), w).toBeUndefined();
    for (const w of ["sath", "sat", "chah", "tera", "bara", "no", "की", "का", "के", "है", "में", "से", "को", "और", "वाला", "रुपए", "किलो", "तिस", "असी"]) {
      expect(value(w), w).toBeUndefined();
    }
  });
  it("no number spelling is a word in the base catalog's names, except the four that were numbers already", () => {
    const known = new Set(["एक", "बारह", "पचास", "ek"]);
    const hits = new Set<string>();
    for (const e of SEED_PARSER_CATALOG.entries) {
      for (const text of [e.displayName, ...e.aliases]) for (const w of text.toLowerCase().split(/\s+/)) if (value(w) !== undefined && !known.has(w)) hits.add(w);
    }
    expect([...hits]).toEqual([]);
  });
  it("every number the table had before is still there with the same value", () => {
    const legacy: Record<string, number> = {
      ek: 1, एक: 1, do: 2, दो: 2, teen: 3, तीन: 3, char: 4, chaar: 4, चार: 4, paanch: 5, panch: 5, पांच: 5, paach: 5, पाच: 5, chhe: 6, chhah: 6, छह: 6,
      saat: 7, सात: 7, aath: 8, आठ: 8, nau: 9, nav: 9, नौ: 9, das: 10, दस: 10, gyarah: 11, ग्यारह: 11, barah: 12, बारह: 12, terah: 13, तेरह: 13,
      chaudah: 14, चौदह: 14, pandrah: 15, पंद्रह: 15, solah: 16, सोलह: 16, satrah: 17, सत्रह: 17, atharah: 18, अठारह: 18, unnees: 19, उन्नीस: 19,
      bees: 20, बीस: 20, pachees: 25, पचीस: 25, tees: 30, तीस: 30, chaalees: 40, चालीस: 40, pachaas: 50, pachas: 50, पचास: 50,
      saath: 60, साठ: 60, sattar: 70, सत्तर: 70, assi: 80, अस्सी: 80, nabbe: 90, नब्बे: 90,
    };
    for (const [w, n] of Object.entries(legacy)) expect(value(w), w).toBe(n);
  });
  it("the table is big enough to hold the spellings (a guard against a rule being switched off)", () => {
    expect(Object.keys(NUMBER_WORDS).length).toBeGreaterThan(600);
  });
});
