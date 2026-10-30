import { amountNeeded } from "../../src/domain/finalBill.js";
import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { matchProductName, type ParsedItem } from "../../src/domain/grammar.js";
import { lineTotalPaise } from "../../src/domain/money.js";
import type { ReviewFlag } from "../../src/domain/reviewFlags.js";
import type { ExpectedBill, ExpectedLine } from "./types.js";

// KB-364: the owner's expected bill against what the app produced (docs/23-ACCEPTANCE.md).
//   WRONG   = a confident number or product that is not what was said (the hard stop - 0 allowed).
//   inexact = the app did not guess (a missing line, a price left as "Price needed", a custom line) or a name differs that the
//             owner's spelling may simply not know: costs "exact", never "wrong".
// The bill is judged as a SET (Layer 1 lines come before Layer 2 lines on the screen, so position says nothing).

export interface ActualBill {
  readonly lines: readonly { readonly item: ParsedItem; readonly displayName: string }[];
  /** Pieces shown as "Not added". */
  readonly unresolved: number;
  /** Theek hai checks the screen would show (checksOf). */
  readonly checks: number;
  /** Indexes of the lines a HIGH flag is shown on (a reason about what was said counts for the last line). */
  readonly warnedLines?: readonly number[];
}

export interface OrderVerdict {
  readonly id: string;
  readonly exact: boolean;
  readonly wrong: string[];
  readonly missing: string[];
  readonly extra: string[];
  readonly inexact: string[];
  readonly notAddedOk: boolean;
  readonly unexpectedChecks: boolean;
  /** WRONG lines that no Theek hai warned about - the dangerous ones ("never SILENTLY gets a number wrong"). */
  readonly silentWrong: number;
}

/** The Theek hai checks the screen shows: one per line with a HIGH flag; a reason about what was said joins the last line's check. */
export function checksOf(flags: readonly ReviewFlag[], lineCount: number): number {
  return warnedLinesOf(flags, lineCount).length;
}

/** The lines a HIGH flag is shown on (one check each). */
export function warnedLinesOf(flags: readonly ReviewFlag[], lineCount: number): number[] {
  return [...new Set(flags.filter((f) => f.severity === "HIGH").map((f) => f.itemIndex ?? Math.max(0, lineCount - 1)))];
}

// ---- names: the heard name against the name the owner wrote ------------------------------------------------------------
/** Lower case, spaces collapsed, the nukta dropped - the same folding the app's reader does. */
const norm = (s: string) => s.normalize("NFD").replace(/़/g, "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}
const closeWord = (a: string, b: string) => distance(a, b) <= (Math.min(a.length, b.length) >= 6 ? 2 : 1);

/** Every word of the shorter name has a close word in the other: "फल्ली दाना" ~ "फल्ली दाने", "पतंजलि पेस्ट बड़ा" ~ "पतंजली पेस्ट बडा वाला". */
function sameName(a: string, b: string): boolean {
  const x = norm(a).split(" ").filter(Boolean);
  const y = norm(b).split(" ").filter(Boolean);
  if (x.length === 0 || y.length === 0) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.some((v) => closeWord(w, v)));
}

type Verdict = { wrong: string } | { inexact: string } | "ok";

/** Is this heard line the product the owner wrote? ok = yes; inexact = cannot tell (his spelling is not in the catalog); wrong = it is another product. */
function productOf(exp: ExpectedLine, line: { item: ParsedItem; displayName: string }, shop: ParserCatalog): Verdict {
  const act = line.item;
  const m = matchProductName(exp.name, shop);
  if (m.catalogId && act.catalogId === m.catalogId) return "ok";
  if (sameName(exp.name, act.spokenName) || sameName(exp.name, line.displayName)) return "ok";
  const heard = `"${act.spokenName}"${act.catalogId ? ` (${shop.byId.get(act.catalogId)?.displayName ?? act.catalogId})` : " (not in the catalog)"}`;
  // a custom line claims NO catalog product, so it cannot be a wrong product: the app just did not know the word
  if (m.catalogId && act.catalogId !== null) return { wrong: `${exp.name}: wrong product - heard ${heard}` };
  return { inexact: `${exp.name}: the name differs - heard ${heard}` };
}

/** Count units are one unit for a catalog price (grammar.ts COUNT_UNITS): "1 piece" and "1 packet" are the same retail unit. */
const COUNT_UNITS = new Set(["piece", "packet", "box", "bottle", "pouch", "bag", "can", "tin"]);
const sameUnit = (a: string, b: string) => a === b || (COUNT_UNITS.has(a) && COUNT_UNITS.has(b));

/** The numbers of one line: quantity, unit and price. */
function numbersOf(exp: ExpectedLine, act: ParsedItem): Verdict {
  if (exp.qty !== null) {
    if (act.qty === null) return { inexact: `${exp.name}: no quantity` };
    if (act.qty !== exp.qty) return { wrong: `${exp.name}: wrong quantity ${act.qty} (expected ${exp.qty})` };
    if (!sameUnit(act.unit, exp.unit)) return { wrong: `${exp.name}: wrong unit ${act.unit || "(none)"} (expected ${exp.unit})` };
  } else if (act.qty !== null) return { wrong: `${exp.name}: a quantity ${act.qty} nobody said` };
  const priced = act.priceType !== "unknown" && act.total !== null;
  const p = exp.price;
  if (p.kind === "needed") {
    if (priced) return { wrong: `${exp.name}: invented price ${act.total} (expected Price needed)` };
    return amountNeeded(act) === "price" || act.qty === null ? "ok" : { inexact: `${exp.name}: Price needed expected` };
  }
  if (!priced) return { inexact: `${exp.name}: the price was left out` };
  if (p.kind === "default") return act.priceType === "default" ? "ok" : { wrong: `${exp.name}: a price nobody said (${act.priceType} ${act.total}; expected the shop's price)` };
  if (p.kind === "total") return act.total === p.paise ? "ok" : { wrong: `${exp.name}: wrong total ${act.total} (expected ${p.paise})` };
  // a rate per the line's unit
  const total = act.qty === null ? null : lineTotalPaise(act.qty, p.paise);
  return act.total === total && (act.rate === null || act.rate === p.paise) ? "ok" : { wrong: `${exp.name}: wrong price ${act.rate}/${act.total} (expected rate ${p.paise})` };
}

export function compareOrder(id: string, expected: ExpectedBill, actual: ActualBill, shop: ParserCatalog): OrderVerdict {
  const wrong: string[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  const inexact: string[] = [];
  let silentWrong = 0;
  const warned = new Set(actual.warnedLines ?? []);
  const noteWrong = (text: string, actualIndex: number) => {
    const w = warned.has(actualIndex);
    if (!w) silentWrong++;
    wrong.push(`${text}${w ? " [a Theek hai warned]" : " [NO warning]"}`);
  };

  // Pair expected with heard lines as a SET: the same product with the same numbers, then the same product and quantity, then the same
  // product, then what is left in order (so a wrong product still shows as one wrong line, not as a shifted list).
  const taken = new Set<number>();
  const pair = new Map<number, number>();
  const sameProduct = (e: ExpectedLine, j: number) => productOf(e, actual.lines[j]!, shop) === "ok";
  const pass = (accept: (e: ExpectedLine, j: number) => boolean) => {
    expected.lines.forEach((e, i) => {
      if (pair.has(i)) return;
      const j = actual.lines.findIndex((_, k) => !taken.has(k) && accept(e, k));
      if (j >= 0) {
        pair.set(i, j);
        taken.add(j);
      }
    });
  };
  pass((e, j) => sameProduct(e, j) && numbersOf(e, actual.lines[j]!.item) === "ok");
  pass((e, j) => sameProduct(e, j) && (e.qty === null || actual.lines[j]!.item.qty === e.qty));
  pass((e, j) => sameProduct(e, j));
  // what is left pairs in order ONLY as a plain substitution (the same number on each side); otherwise it is missing / extra
  const leftExpected = expected.lines.filter((_, i) => !pair.has(i)).length;
  const leftActual = actual.lines.filter((_, j) => !taken.has(j)).length;
  if (leftExpected === leftActual) pass(() => true);

  expected.lines.forEach((e, i) => {
    const j = pair.get(i);
    if (j === undefined) {
      missing.push(`${e.name} was not added`);
      return;
    }
    const line = actual.lines[j]!;
    for (const r of [productOf(e, line, shop), numbersOf(e, line.item)]) {
      if (r === "ok") continue;
      if ("wrong" in r) noteWrong(r.wrong, j);
      else inexact.push(r.inexact);
    }
  });
  actual.lines.forEach((l, j) => {
    if (taken.has(j)) return;
    extra.push(`${l.item.spokenName} was not expected`);
    noteWrong(`an extra line: ${l.item.spokenName}`, j);
  });
  const notAddedOk = actual.unresolved === expected.notAdded;
  const unexpectedChecks = actual.checks > expected.checks;
  const exact = wrong.length === 0 && inexact.length === 0 && missing.length === 0 && notAddedOk && actual.checks <= expected.checks;
  return { id, exact, wrong, missing, extra, inexact, notAddedOk, unexpectedChecks, silentWrong };
}

export interface GateResult {
  readonly passed: boolean;
  readonly total: number;
  readonly exact: number;
  readonly wrongLines: number;
  /** Wrong lines no Theek hai warned about (reported next to the hard stop, which counts every wrong line). */
  readonly silentWrongLines: number;
  readonly unexpectedCheckOrders: number;
  readonly reasons: string[];
}

export const EXACT_RATIO = 0.9;

/** The release gate (owner, 30 Oct 2026): 0 wrong lines (hard stop), >= 90% of orders exact, no check beyond what the owner accepted. */
export function gate(verdicts: readonly OrderVerdict[]): GateResult {
  const total = verdicts.length;
  const exact = verdicts.filter((v) => v.exact).length;
  const wrongLines = verdicts.reduce((n, v) => n + v.wrong.length, 0);
  const silentWrongLines = verdicts.reduce((n, v) => n + v.silentWrong, 0);
  const unexpectedCheckOrders = verdicts.filter((v) => v.unexpectedChecks).length;
  const reasons: string[] = [];
  if (total === 0) reasons.push("no acceptance orders");
  if (wrongLines > 0) reasons.push(`${wrongLines} wrong line(s) - the hard stop`);
  if (total > 0 && exact / total < EXACT_RATIO) reasons.push(`only ${exact}/${total} orders exact (need ${EXACT_RATIO * 100}%)`);
  if (unexpectedCheckOrders > 0) reasons.push(`${unexpectedCheckOrders} order(s) show more Theek hai checks than expected`);
  return { passed: reasons.length === 0, total, exact, wrongLines, silentWrongLines, unexpectedCheckOrders, reasons };
}
