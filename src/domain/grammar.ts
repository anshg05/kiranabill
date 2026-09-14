/**
 * KB-005 - the pricing grammar (Layer 1, docs/04-VOICE-PIPELINE.md section 3).
 * Deterministic, catalog-aware parsing of a single utterance into one or
 * more bill line items. This is the differentiator: the old code returned
 * rate-based ₹100 instead of total-based ₹30 for "5 kg chawal 30 ka" - see
 * grammar.test.ts's dedicated differentiator test.
 *
 * Re-derived as explicit logic from docs/14-LEGACY-REFERENCE.md section 1
 * (the verbatim old Gemini prompt), NOT transcribed from it - that prompt is
 * an LLM instruction and contains at least one internal contradiction an
 * LLM can absorb through few-shot examples but a deterministic function
 * cannot. Every interpretive call made while resolving that is recorded in
 * docs/07-DECISIONS.md D13 - read that alongside this file, not instead of
 * it, for the reasoning behind each one:
 *   1. "Total price only, no qty/unit spoken" -> qty 1 of the catalog's own
 *      unit if the product resolves, else qty null / unit "".
 *   2. paune/sawa are compositional ("paune do" = 1.75); dedh/dhai are fixed.
 *   3. chataak is a 50g UNIT, not a fraction multiplier.
 *   4. null (bail-out) is for structural ambiguity only, never for an
 *      unknown or unpriced product (hard rule 5: never block on those).
 *
 * Catalog matching here is a deliberate stopgap: exact, case-insensitive,
 * against displayName/aliases only. No fuzzy scoring, no thresholds, no
 * phonetic variants, no guard categories - that whole system is KB-005b's
 * job (domain/validator.ts + domain/catalogIndex.ts). This file only needs
 * enough matching to resolve a catalog default price and unit.
 */

import { catalog, getCatalogEntryById, type CatalogEntry } from "./catalog.js";
import { lineTotalPaise, rupeesToPaise, type Paise } from "./money.js";

export type PriceType = "rate" | "total" | "default" | "unknown";

export interface ParsedItem {
  readonly spokenName: string;
  readonly catalogId: string | null;
  readonly isCustom: boolean;
  readonly qty: number | null;
  readonly unit: string;
  readonly rate: Paise | null;
  readonly total: Paise | null;
  readonly priceType: PriceType;
}

// Hindi numerals, verbatim from docs/14-LEGACY-REFERENCE.md section 3.
const HINDI_NUMBERS: Record<string, number> = {
  ek: 1, एक: 1, do: 2, दो: 2, teen: 3, तीन: 3, char: 4, chaar: 4, चार: 4,
  paanch: 5, panch: 5, पांच: 5, paach: 5, chhe: 6, chhah: 6, छह: 6,
  saat: 7, सात: 7, aath: 8, आठ: 8, nau: 9, nav: 9, नौ: 9, das: 10, दस: 10,
  gyarah: 11, ग्यारह: 11, barah: 12, बारह: 12, terah: 13, तेरह: 13,
  chaudah: 14, चौदह: 14, pandrah: 15, पंद्रह: 15, solah: 16, सोलह: 16,
  satrah: 17, सत्रह: 17, atharah: 18, अठारह: 18, unnees: 19, उन्नीस: 19,
  bees: 20, बीस: 20, pachees: 25, पचीस: 25, tees: 30, तीस: 30,
  chaalees: 40, चालीस: 40, pachaas: 50, पचास: 50,
  saath: 60, साठ: 60, sattar: 70, सत्तर: 70, assi: 80, अस्सी: 80,
  nabbe: 90, नब्बे: 90, sau: 100, सौ: 100,
};

// dedh/dhai are idiomatic to these exact values - nobody says "dedh teen".
// aadha/paav don't compose with a following number either. D13.
const FIXED_FRACTIONS: Record<string, number> = {
  aadha: 0.5, आधा: 0.5, adha: 0.5,
  paav: 0.25, पाव: 0.25, pav: 0.25,
  dedh: 1.5, डेढ़: 1.5, deedh: 1.5,
  dhai: 2.5, ढाई: 2.5, dhaai: 2.5,
};

// sawa/paune modify whichever number word follows ("paune do" = 2 - 0.25).
// Bare form (no following number) defaults to the "...ek" reading. D13.
const COMPOSITIONAL_FRACTIONS: Record<string, number> = {
  sawa: 0.25, सवा: 0.25,
  paune: -0.25, पौने: -0.25,
};

// chataak is a traditional small-weight UNIT (~50g), not a fraction
// multiplier - the old Gemini prompt's chataak=0.05 was 0.05kg read wrong.
// D13. Owner's note: some regional usage is closer to 58g - a pilot
// sanity check, not a Phase 0 concern.
const CHATAAK_GRAMS = 50;
const CHATAAK_WORDS = new Set(["chataak", "chatak"]);

const UNIT_ALIASES: Record<string, string> = {
  kg: "kg", kilo: "kg", kilogram: "kg", kilograms: "kg", किलो: "kg",
  gram: "gm", grams: "gm", gm: "gm", g: "gm", ग्राम: "gm",
  liter: "liter", litre: "liter", ltr: "liter", l: "liter", लीटर: "liter",
  ml: "ml", मिली: "ml",
  piece: "piece", pieces: "piece", pcs: "piece", pc: "piece", नग: "piece",
  packet: "packet", pack: "packet", pkt: "packet", पैकेट: "packet",
  dozen: "dozen", box: "box", bottle: "bottle", pouch: "pouch",
  bag: "bag", can: "can", tin: "tin",
};

// Discrete-count units are mutually interchangeable for a catalog default
// price lookup - "1 packet" and "1 piece" both mean one retail unit of
// whatever the product is, regardless of which count-word the catalog
// happened to store. Weight (kg/gm) and volume (liter/ml) units are NOT in
// this set - those need real numeric conversion, handled separately below.
const COUNT_UNITS = new Set([
  "piece", "packet", "dozen", "box", "bottle", "pouch", "bag", "can", "tin",
]);

const RATE_MARKERS = new Set(["wala", "wali"]);
const TOTAL_MARKERS = new Set(["ka", "ki"]);
const CURRENCY_FILLERS = new Set(["rupay", "rupaye", "rupaya", "rupee", "rupees", "rs"]);

/** Simple exact match against displayName/aliases - see file header. */
function matchCatalogExact(name: string): CatalogEntry | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return catalog.find(
    (entry) => entry.displayName.toLowerCase() === lower || entry.aliases.some((alias) => alias.toLowerCase() === lower),
  );
}

/**
 * Converts a catalog's per-unit price into the spoken unit's terms.
 * Same unit -> pass through. Count units (piece/packet/...) -> mutually
 * compatible, pass through. kg<->gm and liter<->ml -> exact SI conversion
 * (1 kg = 1000 gm). Anything else (e.g. spoken kg against a piece-priced
 * product) -> null, the caller bails rather than guessing.
 *
 * This is plain unit conversion, NOT the "subtle" rate-basis inference in
 * docs/14-LEGACY-REFERENCE.md section 8 (detecting a spoken RATE that looks
 * like the wrong magnitude) - that is explicitly KB-005b's job.
 */
function convertCatalogRate(entry: CatalogEntry, spokenUnit: string): Paise | null {
  if (spokenUnit === entry.unit) return entry.suggestedPricePaise;
  if (COUNT_UNITS.has(spokenUnit) && COUNT_UNITS.has(entry.unit)) return entry.suggestedPricePaise;
  if (entry.unit === "kg" && spokenUnit === "gm") return Math.round(entry.suggestedPricePaise / 1000);
  if (entry.unit === "gm" && spokenUnit === "kg") return entry.suggestedPricePaise * 1000;
  if (entry.unit === "liter" && spokenUnit === "ml") return Math.round(entry.suggestedPricePaise / 1000);
  if (entry.unit === "ml" && spokenUnit === "liter") return entry.suggestedPricePaise * 1000;
  return null;
}

// ---------------------------------------------------------------------------
// Tokenizing and classifying one segment (one item's worth of an utterance).
// ---------------------------------------------------------------------------

type Classified =
  | { readonly type: "num"; readonly value: number }
  | { readonly type: "unit"; readonly unit: string }
  | { readonly type: "rate" }
  | { readonly type: "total" }
  | { readonly type: "currency" }
  | { readonly type: "word"; readonly raw: string };

function splitWords(text: string): string[] {
  // "5kg" -> "5 kg" (docs/12-PARKED.md / KB-004 eval fixture VC003 shows a
  // real transcript arrives this way) - insert a boundary between a digit
  // run and an adjacent letter run, either direction, before tokenizing.
  const spaced = text
    .replace(/(\d)([a-zA-Zऀ-ॿ])/g, "$1 $2")
    .replace(/([a-zA-Zऀ-ॿ])(\d)/g, "$1 $2");
  return spaced
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function classifySegment(words: readonly string[]): Classified[] {
  const out: Classified[] = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i]!; // i < words.length, bounds-guaranteed

    if (CHATAAK_WORDS.has(word)) {
      const prev = out[out.length - 1];
      if (prev && prev.type === "num") {
        out[out.length - 1] = { type: "num", value: prev.value * CHATAAK_GRAMS };
        out.push({ type: "unit", unit: "gm" });
        i += 1;
        continue;
      }
      out.push({ type: "word", raw: word });
      i += 1;
      continue;
    }

    const compositionalSign = COMPOSITIONAL_FRACTIONS[word];
    if (compositionalSign !== undefined) {
      const nextWord = words[i + 1];
      const nextValue = nextWord !== undefined ? HINDI_NUMBERS[nextWord] : undefined;
      if (nextValue !== undefined) {
        out.push({ type: "num", value: nextValue + compositionalSign });
        i += 2;
      } else {
        out.push({ type: "num", value: 1 + compositionalSign }); // bare "...ek" form
        i += 1;
      }
      continue;
    }

    if (FIXED_FRACTIONS[word] !== undefined) {
      out.push({ type: "num", value: FIXED_FRACTIONS[word] });
      i += 1;
      continue;
    }

    if (HINDI_NUMBERS[word] !== undefined) {
      out.push({ type: "num", value: HINDI_NUMBERS[word] });
      i += 1;
      continue;
    }

    if (/^\d+(\.\d+)?$/.test(word)) {
      out.push({ type: "num", value: Number(word) });
      i += 1;
      continue;
    }

    if (UNIT_ALIASES[word] !== undefined) {
      out.push({ type: "unit", unit: UNIT_ALIASES[word] });
      i += 1;
      continue;
    }

    if (RATE_MARKERS.has(word)) {
      out.push({ type: "rate" });
      i += 1;
      continue;
    }

    if (TOTAL_MARKERS.has(word)) {
      out.push({ type: "total" });
      i += 1;
      continue;
    }

    if (CURRENCY_FILLERS.has(word)) {
      out.push({ type: "currency" });
      i += 1;
      continue;
    }

    out.push({ type: "word", raw: word });
    i += 1;
  }

  return out;
}

interface NumEntry {
  readonly value: number;
  readonly attachedUnit: string | null;
  readonly isRate: boolean;
  readonly isTotal: boolean;
  readonly isCurrency: boolean;
}

function extractNums(classified: readonly Classified[]): NumEntry[] {
  const entries: NumEntry[] = [];
  for (let j = 0; j < classified.length; j++) {
    const token = classified[j]!; // j < classified.length, bounds-guaranteed
    if (token.type !== "num") continue;
    const next = classified[j + 1];
    entries.push({
      value: token.value,
      attachedUnit: next?.type === "unit" ? next.unit : null,
      isRate: next?.type === "rate",
      isTotal: next?.type === "total",
      isCurrency: next?.type === "currency",
    });
  }
  return entries;
}

function extractSpokenName(classified: readonly Classified[]): string {
  return classified
    .filter((token): token is { type: "word"; raw: string } => token.type === "word")
    .map((token) => token.raw)
    .join(" ")
    .trim();
}

/** qty defaults to "piece" when no unit word was attached to it - the
 * `[qty][product]` pattern in docs/04-VOICE-PIPELINE.md section 3. */
function qtyAndUnit(entry: NumEntry): { qty: number; unit: string } {
  return { qty: entry.value, unit: entry.attachedUnit ?? "piece" };
}

/** Rule 5a: qty spoken, no price -> the catalog's own default price,
 * converted to the spoken unit. Never invents a price for an unresolved
 * product (rate/total stay null - there is nothing to derive it from). */
function resolveDefault(
  qty: number,
  spokenUnit: string,
  catalogId: string | null,
  spokenName: string,
  isCustom: boolean,
): ParsedItem | null {
  if (!catalogId) {
    return { spokenName, catalogId, isCustom, qty, unit: spokenUnit, rate: null, total: null, priceType: "unknown" };
  }
  const entry = getCatalogEntryById(catalogId);
  if (!entry) {
    throw new Error(`grammar.ts: matched catalogId "${catalogId}" that getCatalogEntryById cannot find`);
  }
  const ratePaise = convertCatalogRate(entry, spokenUnit);
  if (ratePaise === null) return null; // incompatible units - bail rather than guess
  return {
    spokenName,
    catalogId,
    isCustom,
    qty,
    unit: spokenUnit,
    rate: ratePaise,
    total: lineTotalPaise(qty, ratePaise),
    priceType: "default",
  };
}

/** Rule 2/3's "total price only, no qty/unit spoken" edge case - docs/07-DECISIONS.md D13 point 1. */
function resolveUnattachedTotal(
  totalPaise: Paise,
  catalogId: string | null,
  spokenName: string,
  isCustom: boolean,
): ParsedItem {
  const entry = catalogId ? getCatalogEntryById(catalogId) : undefined;
  return {
    spokenName,
    catalogId,
    isCustom,
    qty: entry ? 1 : null,
    unit: entry ? entry.unit : "",
    rate: null,
    total: totalPaise,
    priceType: "total",
  };
}

function resolveSegment(rawSegment: string): ParsedItem | null {
  const words = splitWords(rawSegment);
  if (words.length === 0) return null;

  const classified = classifySegment(words);
  const nums = extractNums(classified);
  const spokenName = extractSpokenName(classified);

  const matched = matchCatalogExact(spokenName);
  const catalogId = matched ? matched.id : null;
  const isCustom = !matched;

  // Rule 5b: nothing numeric spoken at all - never guess a price, even for
  // a product that resolves in the catalog (hard rule 5: never block, and
  // never invent, on an unknown or unpriced product).
  if (nums.length === 0) {
    return { spokenName, catalogId, isCustom, qty: null, unit: "", rate: null, total: 0, priceType: "unknown" };
  }

  const rateEntry = nums.find((n) => n.isRate);
  const totalEntry = nums.find((n) => n.isTotal);

  // Both wala and ka in one segment - conflicting, not decidable. Bail.
  if (rateEntry && totalEntry) return null;

  // Rule 1: wala/wali -> that number is the rate; whichever other number is
  // present is qty. No other number present -> nothing to bail into except
  // guessing a qty, so bail instead.
  if (rateEntry) {
    const qtyEntry = nums.find((n) => n !== rateEntry);
    if (!qtyEntry) return null;
    const { qty, unit } = qtyAndUnit(qtyEntry);
    const ratePaise = rupeesToPaise(rateEntry.value);
    return { spokenName, catalogId, isCustom, qty, unit, rate: ratePaise, total: lineTotalPaise(qty, ratePaise), priceType: "rate" };
  }

  // Rule 2: ka/ki -> that number is the total, rate stays null.
  if (totalEntry) {
    const totalPaise = rupeesToPaise(totalEntry.value);
    const qtyEntry = nums.find((n) => n !== totalEntry);
    if (qtyEntry) {
      const { qty, unit } = qtyAndUnit(qtyEntry);
      return { spokenName, catalogId, isCustom, qty, unit, rate: null, total: totalPaise, priceType: "total" };
    }
    return resolveUnattachedTotal(totalPaise, catalogId, spokenName, isCustom);
  }

  // No wala/ka/ki anywhere. More than two bare numbers is beyond what this
  // deterministic layer will disambiguate (this also covers a conflicting
  // multi-unit utterance, which naturally produces 3+ numbers).
  if (nums.length > 2) return null;

  if (nums.length === 1) {
    const only = nums[0]!; // nums.length === 1, bounds-guaranteed
    if (only.attachedUnit) {
      // Rule 5a: qty + unit, no price.
      return resolveDefault(only.value, only.attachedUnit, catalogId, spokenName, isCustom);
    }
    if (only.isCurrency) {
      // Rule 3: a bare price via an explicit currency word, no qty/unit spoken.
      return resolveUnattachedTotal(rupeesToPaise(only.value), catalogId, spokenName, isCustom);
    }
    // Bare number, no unit, no currency word - "[qty][product]" pattern,
    // implicit piece count (docs/04-VOICE-PIPELINE.md section 3).
    return resolveDefault(only.value, "piece", catalogId, spokenName, isCustom);
  }

  // nums.length === 2, no rule word: Rule 3. Exactly one number must carry
  // an explicit unit to be unambiguously qty - the other is then the total.
  // Neither (or both) carrying a unit is genuine ambiguity - bail.
  const qtyEntry = nums.find((n) => n.attachedUnit !== null);
  const otherEntries = nums.filter((n) => n !== qtyEntry);
  if (!qtyEntry || otherEntries.length !== 1 || otherEntries[0]!.attachedUnit !== null) return null;

  const { qty, unit } = qtyAndUnit(qtyEntry);
  return { spokenName, catalogId, isCustom, qty, unit, rate: null, total: rupeesToPaise(otherEntries[0]!.value), priceType: "total" };
}

/**
 * Parses one utterance into its bill line items. Returns null the moment
 * anything is structurally ambiguous (docs/04-VOICE-PIPELINE.md section 3's
 * bail-out rule) - never for a merely unknown or unpriced product, which
 * always returns an item (Rule 5b). Multiple items in one utterance are
 * separated by "aur"; if any one segment can't be resolved, the whole
 * utterance bails rather than silently dropping a line.
 */
export function parseUtterance(text: string): ParsedItem[] | null {
  const segments = text
    .split(/\baur\b/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return null;

  const items: ParsedItem[] = [];
  for (const segment of segments) {
    const item = resolveSegment(segment);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}
