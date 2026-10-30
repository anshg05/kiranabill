import { amountNeeded } from "../../src/domain/finalBill.js";
import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { matchProductName, type ParsedItem } from "../../src/domain/grammar.js";
import { lineTotalPaise } from "../../src/domain/money.js";
import type { ReviewFlag } from "../../src/domain/reviewFlags.js";
import type { ExpectedBill, ExpectedLine } from "./types.js";

// KB-364: the owner's expected bill against what the app produced (docs/23-ACCEPTANCE.md).
//   WRONG   = a confident number or product that is not what was said (the hard stop - 0 allowed).
//   inexact = the app did not guess (a missing line, a price left as "Price needed", a custom line): costs "exact", never "wrong".

export interface ActualBill {
  readonly lines: readonly { readonly item: ParsedItem; readonly displayName: string }[];
  /** Pieces shown as "Not added". */
  readonly unresolved: number;
  /** Theek hai checks the screen would show (checksOf). */
  readonly checks: number;
}

export interface OrderVerdict {
  readonly id: string;
  readonly exact: boolean;
  readonly wrong: string[];
  readonly missing: string[];
  readonly extra: string[];
  readonly notAddedOk: boolean;
  readonly unexpectedChecks: boolean;
}

/** The Theek hai checks the screen shows: one per line with a HIGH flag; a reason about what was said joins the last line's check. */
export function checksOf(flags: readonly ReviewFlag[], lineCount: number): number {
  const keys = new Set(flags.filter((f) => f.severity === "HIGH").map((f) => f.itemIndex ?? Math.max(0, lineCount - 1)));
  return keys.size;
}

type LineResult = { wrong: string } | { inexact: string } | "ok";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function compareLine(exp: ExpectedLine, act: ParsedItem, shop: ParserCatalog): LineResult {
  // the product
  const m = matchProductName(exp.name, shop);
  if (m.catalogId) {
    if (act.catalogId !== null && act.catalogId !== m.catalogId) return { wrong: `wrong product: ${act.spokenName} (${act.catalogId}) for ${exp.name}` };
    if (act.catalogId === null) return { inexact: `${exp.name} not matched to the catalog` };
  } else if (act.catalogId !== null) {
    return { wrong: `wrong product: ${act.spokenName} (${act.catalogId}) for a name not in the catalog (${exp.name})` };
  } else if (!norm(act.spokenName).includes(norm(exp.name)) && !norm(exp.name).includes(norm(act.spokenName))) {
    return { wrong: `wrong name: ${act.spokenName} for ${exp.name}` };
  }
  // the quantity and unit
  if (exp.qty !== null) {
    if (act.qty === null) return { inexact: `${exp.name}: no quantity` };
    if (act.qty !== exp.qty) return { wrong: `${exp.name}: wrong quantity ${act.qty} (expected ${exp.qty})` };
    if (act.unit !== exp.unit) return { wrong: `${exp.name}: wrong unit ${act.unit || "(none)"} (expected ${exp.unit})` };
  } else if (act.qty !== null) return { wrong: `${exp.name}: a quantity ${act.qty} nobody said` };
  // the price
  const priced = act.priceType !== "unknown" && act.total !== null;
  const p = exp.price;
  if (p.kind === "needed") return priced ? { wrong: `${exp.name}: invented price ${act.total} (expected Price needed)` } : amountNeeded(act) === "price" || act.qty === null ? "ok" : { inexact: `${exp.name}: Price needed expected` };
  if (!priced) return { inexact: `${exp.name}: the price was left out` };
  if (p.kind === "default") return act.priceType === "default" ? "ok" : { wrong: `${exp.name}: a price nobody said (${act.priceType} ${act.total}; expected the shop's price)` };
  if (p.kind === "total") return act.total === p.paise ? "ok" : { wrong: `${exp.name}: wrong total ${act.total} (expected ${p.paise})` };
  // a rate per the line's unit
  const total = act.qty === null ? null : lineTotalPaise(act.qty, p.paise);
  return act.rate === p.paise && act.total === total ? "ok" : { wrong: `${exp.name}: wrong price ${act.rate}/${act.total} (expected rate ${p.paise})` };
}

export function compareOrder(id: string, expected: ExpectedBill, actual: ActualBill, shop: ParserCatalog): OrderVerdict {
  const wrong: string[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  let inexact = 0;
  const n = Math.min(expected.lines.length, actual.lines.length);
  for (let i = 0; i < n; i++) {
    const r = compareLine(expected.lines[i]!, actual.lines[i]!.item, shop);
    if (r === "ok") continue;
    if ("wrong" in r) wrong.push(`line ${i + 1}: ${r.wrong}`);
    else inexact++;
  }
  for (let i = n; i < expected.lines.length; i++) missing.push(`line ${i + 1}: ${expected.lines[i]!.name} was not added`);
  for (let i = n; i < actual.lines.length; i++) {
    extra.push(`line ${i + 1}: ${actual.lines[i]!.item.spokenName} was not expected`);
    wrong.push(`line ${i + 1}: an extra line (${actual.lines[i]!.item.spokenName})`);
  }
  const notAddedOk = actual.unresolved === expected.notAdded;
  const unexpectedChecks = actual.checks > expected.checks;
  const exact = wrong.length === 0 && inexact === 0 && missing.length === 0 && notAddedOk && actual.checks <= expected.checks;
  return { id, exact, wrong, missing, extra, notAddedOk, unexpectedChecks };
}

export interface GateResult {
  readonly passed: boolean;
  readonly total: number;
  readonly exact: number;
  readonly wrongLines: number;
  readonly unexpectedCheckOrders: number;
  readonly reasons: string[];
}

export const EXACT_RATIO = 0.9;

/** The release gate (owner, 30 Oct 2026): 0 wrong lines (hard stop), >= 90% of orders exact, no check beyond what the owner accepted. */
export function gate(verdicts: readonly OrderVerdict[]): GateResult {
  const total = verdicts.length;
  const exact = verdicts.filter((v) => v.exact).length;
  const wrongLines = verdicts.reduce((n, v) => n + v.wrong.length, 0);
  const unexpectedCheckOrders = verdicts.filter((v) => v.unexpectedChecks).length;
  const reasons: string[] = [];
  if (total === 0) reasons.push("no acceptance orders");
  if (wrongLines > 0) reasons.push(`${wrongLines} wrong line(s) - the hard stop`);
  if (total > 0 && exact / total < EXACT_RATIO) reasons.push(`only ${exact}/${total} orders exact (need ${EXACT_RATIO * 100}%)`);
  if (unexpectedCheckOrders > 0) reasons.push(`${unexpectedCheckOrders} order(s) show more Theek hai checks than expected`);
  return { passed: reasons.length === 0, total, exact, wrongLines, unexpectedCheckOrders, reasons };
}
