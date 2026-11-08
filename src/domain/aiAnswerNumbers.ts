/**
 * KB-380 (doc 25 §4, owner 7 Nov 2026): the spoken numbers an AI-READ bill (the Gemini path) rightly does NOT bill, so number_dropped /
 * qty_dropped do not call them "dropped" there:
 *   1. a number a spoken correction REPLACED ("2 किलो चीनी ₹56 किलो नहीं नहीं 3 किलो चीनी" - the 2 and the first 56), when the AI's line for
 *      that product follows the correction word and carries the new numbers;
 *   2. a PACK SIZE beside a count in one item ("बंसल तेल 1 लीटर एक पैकेट", "एक बंसल 1 लीटर"): the line bills one of the two.
 * Anything else stays "dropped" and warns. An unknown correction form is NEVER exempted (owner, 7 Nov 2026): add it to the list.
 * Pure (domain rule 3); the Layer 1 / Sarvam path never calls this.
 */
import { canonicalUnit, extractSpokenNumberEntries, extractSpokenNumbers, type ParsedItem } from "./grammar.js";
import { lineTotalPaiseScaled, paiseToRupeeNumber } from "./money.js";

/** The ONE list of spoken correction words (doc 25 §2 - extendable: a new form is added here, with a test). */
export const CORRECTION_MARKERS: readonly string[] = ["नहीं नहीं", "nahi nahi", "sorry", "करो उसको"];

const PRICE_AFTER = new Set(["रुपए", "रुपये", "रुपया", "रूपए", "रूपये", "rupaye", "rupees", "rs", "वाला", "वाली", "वाले", "का", "की", "के"]);
/** How far after a correction word the corrected product's name may come ("नहीं नहीं 3 किलो करो उसको चना दाल"). */
const NAME_AFTER_WORDS = 6;

const norm = (s: string) => s.normalize("NFD").replace(/़/g, "").normalize("NFC").toLowerCase();
const alike = (a: string, b: string) => a === b || (a.length > 1 && b.length > 1 && (a.startsWith(b) || b.startsWith(a)));

const PER_KILO = new Map([["किलो", "kg"], ["kilo", "kg"], ["kg", "kg"], ["लीटर", "liter"], ["लिटर", "liter"], ["liter", "liter"], ["litre", "liter"]]);
const PER_PIECE = new Set(["वाला", "वाली", "वाले"]);
const PER_GRAM = new Map([["ग्राम", "gm"], ["gram", "gm"], ["grams", "gm"], ["gm", "gm"], ["ml", "ml"], ["मिली", "ml"], ["एमएल", "ml"]]);
const wordsOf = (transcript: string) => transcript.split(/[\s,।]+/).filter(Boolean).map(norm);

/**
 * The unit a SPOKEN price is per, read from the words straight after its number (KB-381 / KB-382): "88 रुपए किलो", "₹56 किलो",
 * "56 का किलो" = per kg (or liter); "10 रुपये ग्राम" = per gram (or ml); "X वाला" = per piece. "वाला" after a NAME ("बड़ा वाला ₹110") is no
 * price (owner, 8 Nov 2026). null = the words say nothing about it.
 */
export function unitAfterSpokenPrice(transcript: string, rateRupees: number): "kg" | "liter" | "gm" | "ml" | "piece" | null {
  const w = wordsOf(transcript);
  for (let i = 0; i < w.length; i++) {
    const v = extractSpokenNumbers(w[i]!);
    if (v.length !== 1 || Math.abs(v[0]! - rateRupees) > 1e-9) continue;
    if (w[i + 1] !== undefined && PER_PIECE.has(w[i + 1]!)) return "piece";
    const next = ["रुपए", "रुपये", "रुपया", "का", "की", "rupaye"].includes(w[i + 1] ?? "") ? w[i + 2] : w[i + 1];
    if (next !== undefined && PER_KILO.has(next)) return PER_KILO.get(next) as "kg" | "liter";
    if (next !== undefined && PER_GRAM.has(next)) return PER_GRAM.get(next) as "gm" | "ml";
  }
  return null;
}

/** KB-381 (D105 addition 2): the owner's implied 1 - only a per-kilo / per-litre price or "X वाला" justifies it. */
function impliedOneUnit(transcript: string, rateRupees: number): string | null {
  const u = unitAfterSpokenPrice(transcript, rateRupees);
  return u === "kg" || u === "liter" || u === "piece" ? u : null;
}

/**
 * KB-382 (a) (doc 25 §3.3, D103 item 3a): the price UNIT is read from the spoken words, whatever unit the AI labelled. A gram / ml line
 * whose spoken rate the words call per kilo / per litre ("500 ग्राम शक्कर ₹56 किलो") is a per-kilo rate: its total is OUR arithmetic,
 * qty x rate scaled across g / kg (A38: Rs 28, never Rs 28,000). settleLayer2Items takes a total only when it is exactly that per-kilo
 * reading (KB-366), so setting it here is how the rate becomes per kilo - the AI's own sum is never used.
 */
export function aiAnswerRateUnits(transcript: string, items: readonly ParsedItem[]): ParsedItem[] {
  return items.map((it) => {
    if (it.priceType !== "rate" || it.rate === null || it.qty === null || (it.unit !== "gm" && it.unit !== "ml")) return it;
    const per = unitAfterSpokenPrice(transcript, paiseToRupeeNumber(it.rate));
    return (it.unit === "gm" && per === "kg") || (it.unit === "ml" && per === "liter") ? { ...it, total: lineTotalPaiseScaled(it.qty, it.rate, -3) } : it;
  });
}

/**
 * KB-381 (doc 25 §3.2): the AI's QUANTITIES checked against the whole transcript, in the order said - not against Layer 1's cut (on A57
 * that cut put "5 पीस" in the next piece whenever the transcript had no comma, and KB-359 dropped a 5 the AI had right). For each line:
 *   - a quantity 1 on a spoken-rate line that the words call per-kilo / "X वाला" stands (the owner's implied 1) - and takes no spoken "1";
 *   - otherwise the quantity must be a number spoken after the previous line's quantity; else it is dropped (D47: the spoken total stays);
 *   - a spoken-rate line with NO quantity gets the implied 1 when the words justify it (A42 "दंतकांति 60 वाला" = 1 piece).
 * Our code computes the totals afterwards. AI path only; Layer 1 keeps KB-359's rule.
 */
export function aiAnswerQuantities(transcript: string, items: readonly ParsedItem[]): ParsedItem[] {
  const spoken = extractSpokenNumberEntries(transcript).map((e) => e.value);
  let floor = -1;
  return items.map((it) => {
    const implied = it.priceType === "rate" && it.rate !== null ? impliedOneUnit(transcript, paiseToRupeeNumber(it.rate)) : null;
    // a per-kilo price is 1 kg / 1 liter whatever unit the AI wrote; "X वाला" keeps the line's own count unit (piece by default)
    if (it.qty === null) return implied ? { ...it, qty: 1, unit: implied === "piece" ? it.unit || "piece" : implied } : it;
    if (it.qty === 1 && implied) return it;
    const at = spoken.findIndex((v, k) => k > floor && Math.abs(v - it.qty!) < 1e-9);
    if (at >= 0) {
      floor = at;
      return it;
    }
    return { ...it, qty: null, unit: "", total: it.priceType === "total" ? it.total : null };
  });
}

/** The spoken numbers an AI answer rightly left off the bill (a multiset of values, in rupee / quantity terms). */
export function aiAnswerExemptNumbers(transcript: string, items: readonly ParsedItem[]): number[] {
  const words = transcript.split(/[\s,।]+/).filter(Boolean).map(norm);
  const num = (i: number): number | null => {
    const v = words[i] === undefined ? [] : extractSpokenNumbers(words[i]!);
    return v.length === 1 ? v[0]! : null;
  };
  const isPrice = (i: number) => words[i]!.startsWith("₹") || PRICE_AFTER.has(words[i + 1] ?? "");
  const isUnit = (i: number) => words[i] !== undefined && canonicalUnit(words[i]!) !== null;
  const names = items.map((it) => it.spokenName.split(/\s+/).filter(Boolean).map(norm));
  const numbersOf = (it: ParsedItem) => [it.qty, it.rate === null ? null : paiseToRupeeNumber(it.rate), it.total === null ? null : paiseToRupeeNumber(it.total)].filter((v): v is number => v !== null);
  const exempt: number[] = [];

  // 1. corrections: the numbers between the corrected product's earlier mention and the correction word, that its line does not carry
  const markers = CORRECTION_MARKERS.map((m) => m.split(" ").map(norm));
  let previousEnd = 0;
  for (let m = 0; m < words.length; m++) {
    const marker = markers.find((mk) => mk.every((w, k) => words[m + k] === w));
    if (!marker) continue;
    const after = m + marker.length;
    const k = names.findIndex((n) => n.length > 0 && words.slice(after, after + NAME_AFTER_WORDS).some((w) => alike(w, n[0]!)));
    if (k >= 0) {
      let s = -1;
      for (let i = m - 1; i >= previousEnd && s < 0; i--) if (alike(words[i]!, names[k]![0]!)) s = i;
      if (s >= 0) {
        let start = s;
        // a leading quantity of the same item ("2 किलो चीनी"), never another item's price
        while (start - 1 >= previousEnd && start > s - 2 && (num(start - 1) !== null || isUnit(start - 1)) && !(num(start - 1) !== null && isPrice(start - 1))) start--;
        // a value the line carries is exempt only if it is said AGAIN after the correction (₹56 ... नहीं नहीं ... ₹56): otherwise the line
        // took it from before the correction (₹92 said once) and it is not "replaced"
        const own = numbersOf(items[k]!);
        const nextMarker = words.findIndex((_, i) => i >= after && markers.some((mk) => mk.every((w, x) => words[i + x] === w)));
        const afterNums = words.slice(after, nextMarker < 0 ? after + NAME_AFTER_WORDS + 4 : nextMarker).map((w) => extractSpokenNumbers(w)).filter((v) => v.length === 1).map((v) => v[0]!);
        for (let i = start; i < m; i++) {
          const v = num(i);
          if (v === null) continue;
          const carried = own.some((o) => Math.abs(o - v) < 1e-9) && !afterNums.some((x) => Math.abs(x - v) < 1e-9);
          if (!carried) exempt.push(v);
        }
      }
    }
    previousEnd = after;
    m = after - 1;
  }

  // 2. pack sizes: a count and a size in ONE item, with only units and that item's name between them, the line billing one of them
  const used = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const a = num(i);
    if (a === null || isPrice(i) || used.has(i)) continue;
    let j = i + 1;
    while (j < words.length && num(j) === null) j++;
    const b = num(j);
    if (b === null || isPrice(j) || !isUnit(j + 1)) continue;
    // "1 लीटर एक पैकेट": two numbers, each with its unit, nothing else between, different units. "एक बंसल 1 लीटर": a bare count, the line's
    // name, a size. Anything else ("3 किलो चीनी 5 किलो चावल") is two items.
    const aUnit = isUnit(i + 1) ? canonicalUnit(words[i + 1]!) : null;
    if (aUnit !== null && (j !== i + 2 || aUnit === canonicalUnit(words[j + 1]!))) continue;
    const between = words.slice(i + 1, j).filter((w) => canonicalUnit(w) === null);
    const before = words.slice(Math.max(0, i - 3), i);
    const k = names.findIndex((n, idx) => {
      const q = items[idx]!.qty;
      if (q === null || !(Math.abs(q - a) < 1e-9 || Math.abs(q - b) < 1e-9) || n.length === 0) return false;
      const inName = (w: string) => n.some((x) => alike(w, x));
      return between.length > 0 ? between.every(inName) : before.some(inName);
    });
    if (k < 0) continue;
    exempt.push(Math.abs(items[k]!.qty! - a) < 1e-9 ? b : a);
    used.add(i).add(j);
  }
  return exempt;
}
