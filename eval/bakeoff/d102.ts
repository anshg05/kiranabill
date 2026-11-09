import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { amountNeeded } from "../../src/domain/finalBill.js";
import { canonicalUnit, extractSpokenNumbers, matchProductName } from "../../src/domain/grammar.js";
import { mostlySame, numbersOf, sameName, type ActualBill, type Verdict } from "../acceptance/compare.js";
import type { ExpectedBill, ExpectedLine } from "../acceptance/types.js";
import { scoringCatalog, type RunScore } from "./score.js";

// KB-370 round 2 - scoring under D102 (owner, 4 Nov 2026): the bill line keeps the name that was SAID; the catalog only fills a price that
// was not said. So a line is right when its NAME is the owner's (spelling variants fine: compare.ts's similarity rules) with the right
// quantity, unit and price. The catalog product it claims no longer matters - but a DIFFERENT product's name, or a "shop price" taken from a
// different product than the one he said, is wrong. Bake-off only: the gate's comparison (compare.ts) is unchanged.

const NO_WARNING = " [NO warning]";
const WARNED = " [a Theek hai warned]";
/** Owner, 8 Nov 2026: a line that asks for a price cannot reach Bill Banao unpriced - it is warned, not silent (counted on its own). */
const PRICE_NEEDED = " [Price needed]";
const cache = new WeakMap<ParserCatalog, ParserCatalog>();

type Line = ActualBill["lines"][number];

export function scoreRunD102(id: string, expected: ExpectedBill, actual: ActualBill, shop: ParserCatalog): RunScore {
  void id;
  let sc = cache.get(shop);
  if (!sc) cache.set(shop, (sc = scoringCatalog(shop)));
  const own = (name: string) => matchProductName(name, sc).catalogId;
  // a spelling variant (compare.ts's rules), or the same word in the other script: both names resolve to ONE catalog product ("toor daal" / तुअर दाल)
  const alike = (e: ExpectedLine, l: Line) => {
    if (sameName(e.name, l.item.spokenName) || mostlySame(e.name, l.item.spokenName)) return true;
    // owner, 8 Nov 2026: spaces inside a name do not matter (दंतकांति = दंत कांति) - scoring only
    if (sameName(e.name.replace(/\s+/g, ""), l.item.spokenName.replace(/\s+/g, ""))) return true;
    const mine = own(e.name);
    return mine !== null && own(l.item.spokenName) === mine;
  };
  const warned = new Set(actual.warnedLines ?? []);
  const mark = (j: number) => (warned.has(j) ? WARNED : amountNeeded(actual.lines[j]!.item) === "price" ? PRICE_NEEDED : NO_WARNING);

  /** The numbers, under D102: numbersOf, plus WHERE a "shop price" came from (it must be the said product's, or Price needed if none). */
  const numbers = (e: ExpectedLine, l: Line): Verdict => {
    // D103: units as said, spelled the app's way ("litre" = liter); a unit the app does not know ("set") is kept as it is
    const v = numbersOf(e, { ...l.item, unit: canonicalUnit(l.item.unit) ?? l.item.unit });
    if (e.price.kind !== "default") return v;
    const mine = own(e.name);
    const priced = l.item.priceType !== "unknown" && l.item.total !== null;
    if (!mine && !priced) return "ok"; // not in the catalog: nothing to fill - Price needed is the right, safe result
    if (priced && l.item.catalogId !== mine) return { wrong: `${e.name}: a price from another product (${l.item.catalogId ? sc.byId.get(l.item.catalogId)?.displayName : "?"}) - heard "${l.item.spokenName}"` };
    return v;
  };

  // pair as a SET, by NAME (compare.ts's order of passes): name + numbers, name + quantity, name, then what is left only as a 1:1 substitution
  const taken = new Set<number>();
  const pair = new Map<number, number>();
  const pass = (accept: (e: ExpectedLine, l: Line) => boolean) =>
    expected.lines.forEach((e, i) => {
      if (pair.has(i)) return;
      const j = actual.lines.findIndex((l, k) => !taken.has(k) && accept(e, l));
      if (j >= 0) (pair.set(i, j), taken.add(j));
    });
  pass((e, l) => alike(e, l) && numbers(e, l) === "ok");
  pass((e, l) => alike(e, l) && (e.qty === null || l.item.qty === e.qty));
  pass((e, l) => alike(e, l));
  if (expected.lines.filter((_, i) => !pair.has(i)).length === actual.lines.filter((_, j) => !taken.has(j)).length) pass(() => true);

  const wrong: string[] = [];
  const inexact: string[] = [];
  let wrongProducts = 0;
  let numbersRightNameWrong = 0;
  let dropped = 0;
  expected.lines.forEach((e, i) => {
    const j = pair.get(i);
    if (j === undefined) return void dropped++;
    const l = actual.lines[j]!;
    const n = numbers(e, l);
    if (n !== "ok") {
      if ("wrong" in n) wrong.push(`${n.wrong.includes(" - heard ") ? n.wrong : `${n.wrong} - heard "${l.item.spokenName}"`}${mark(j)}`);
      else inexact.push(n.inexact);
    }
    if (alike(e, l)) return;
    const other = own(l.item.spokenName);
    if (other !== null && other !== own(e.name)) {
      wrongProducts++;
      wrong.push(`${e.name}: wrong product - heard "${l.item.spokenName}" (${sc.byId.get(other)?.displayName})${mark(j)}`);
    } else if (n === "ok") numbersRightNameWrong++;
  });

  let silentDuplicated = 0;
  let warnedDuplicated = 0;
  let invented = 0;
  actual.lines.forEach((l, j) => {
    if (taken.has(j)) return;
    if (l.item.qty === null && (l.item.priceType === "unknown" || l.item.total === null)) return void inexact.push(`an extra empty line: ${l.item.spokenName}`);
    if (expected.lines.some((e, i) => pair.has(i) && alike(e, l))) {
      if (warned.has(j)) return void warnedDuplicated++; // listed, not a wrong line; the order is not exact
      silentDuplicated++;
    } else invented++;
    wrong.push(`an extra line: ${l.item.spokenName} - heard "${l.item.spokenName}"${mark(j)}`);
  });

  // a missing line is warned only by a whole-bill Theek hai (every line warned: "heard X, it is on no line") or a "Not added" piece
  const billWarned = actual.unresolved > 0 || (actual.lines.length > 0 && warned.size === actual.lines.length);
  const exact = actual.unresolved === expected.notAdded && actual.checks <= expected.checks && wrong.length === 0 && inexact.length === 0 && dropped === 0 && numbersRightNameWrong === 0 && warnedDuplicated === 0;
  return {
    exact,
    wrongLines: wrong.length,
    silentWrong: wrong.filter((w) => w.endsWith(NO_WARNING)).length,
    wrongNumbers: wrong.length - wrongProducts,
    wrongProducts,
    dropped,
    silentDropped: billWarned ? 0 : dropped,
    silentDuplicated,
    warnedDuplicated,
    invented,
    numbersRightNameWrong,
    checks: actual.checks,
    warnedLines: warned.size,
    priceNeededLines: actual.lines.filter((l) => amountNeeded(l.item) === "price").length,
    wrong,
  };
}

/** Up to `n` transcript words either side of the first word of a heard name - to judge a wrong number against what was heard. */
export function aroundWords(transcript: string, heard: string, n = 8): string {
  const words = transcript.split(/\s+/).filter(Boolean);
  const first = heard.split(/\s+/)[0] ?? "";
  const k = words.findIndex((w) => w.includes(first) || first.includes(w.replace(/[,।.]/g, "")) && w.length > 1);
  if (k < 0 || !first) return words.slice(0, 2 * n + 1).join(" ");
  const from = Math.max(0, k - n);
  const to = Math.min(words.length, k + n + 1);
  return `${from > 0 ? "… " : ""}${words.slice(from, k).join(" ")} [${words[k]}] ${words.slice(k + 1, to).join(" ")}${to < words.length ? " …" : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * D106 (owner, 9 Nov 2026, tightened): is a silent wrong NUMBER the EAR's? Only when the transcript has that exact number inside THAT item's
 * own segment - from its name up to the next bill line's name (or the end). Anywhere else, it counts against our code.
 */
export function earHeard(transcript: string, name: string, value: number, otherNames: readonly string[]): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/़/g, "").normalize("NFC").replace(/[,।]/g, "").toLowerCase();
  const words = transcript.split(/\s+/).filter(Boolean).map(fold);
  const first = (n: string) => fold(n.split(/\s+/)[0] ?? "");
  const at = words.findIndex((w) => w === first(name));
  if (at < 0) return false;
  const others = new Set(otherNames.map(first).filter((o) => o !== first(name)));
  let end = at + 1;
  while (end < words.length && !others.has(words[end]!)) end++;
  return words.slice(at, end).some((w) => extractSpokenNumbers(w).some((n) => Math.abs(n - value) < 1e-9));
}
