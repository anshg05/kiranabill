import { canonicalUnit } from "../../src/domain/grammar.js";
import type { ExpectedBill, ExpectedLine, ExpectedPrice } from "./types.js";

// KB-364: the expected-bill sheet (eval/acceptance/sheet.txt) in plain words - docs/23-ACCEPTANCE.md has the format and examples.

export interface SheetOrder {
  readonly id: string;
  readonly category: string;
  readonly said: string;
  /** null while the block is not filled in (nothing said, no lines). */
  readonly expected: ExpectedBill | null;
  /** The question for the owner when the block carries a "# OWNER CHECK: ..." line - it stays pending until that line is removed. */
  readonly ownerCheck?: string;
  /** Why the block is kept out of the gate ("# SKIP: reason": the owner's call, or Whisper heard other words). */
  readonly skipped?: string;
}

export interface ParsedSheet {
  readonly orders: SheetOrder[];
  readonly errors: string[];
}

/** An empty block for the owner to fill in. */
export function sheetBlock(slot: { id: string; category: string }): string {
  return `## ${slot.id} ${slot.category}\nsaid:\n# one line per item, e.g.   - 2 kg चीनी @45     - 5 kg चावल =225     - 1 kg मूंग दाल     - 1 kg बेसन price needed     - NOT ADDED\nchecks: 0\n\n`;
}

/** "45" -> 4500, "45.5" -> 4550, "0.07" -> 7. Exact: no float. null when it is not a plain non-negative amount. */
function paiseOf(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

function parseLine(text: string): ExpectedLine | { error: string } | { notAdded: number } {
  const na = /^NOT ADDED(?:\s+(\d+))?$/i.exec(text);
  if (na) return { notAdded: na[1] ? Number(na[1]) : 1 };

  let rest = text;
  let price: ExpectedPrice | null = null;
  const needed = /\s+price needed$/i.exec(rest);
  if (needed) (price = { kind: "needed" }), (rest = rest.slice(0, needed.index));
  const amounts = [...rest.matchAll(/\s+([@=])(\S*)/g)];
  if (amounts.length > 1 || (amounts.length === 1 && price)) return { error: `one price per line ("${text}")` };
  if (amounts.length === 1) {
    const [whole, sign, raw] = amounts[0]!;
    const paise = paiseOf(raw!);
    if (paise === null) return { error: `the amount in "${text}" must be like 45 or 45.50` };
    price = sign === "@" ? { kind: "rate", paise } : { kind: "total", paise };
    rest = rest.replace(whole, "");
  }

  const words = rest.trim().split(/\s+/);
  let qty: number | null = null;
  let unit = "";
  if (/^\d+(\.\d+)?$/.test(words[0]!)) {
    const u = canonicalUnit(words[1] ?? "");
    if (!u) return { error: `a quantity needs a unit right after it ("${text}")` };
    qty = Number(words[0]);
    unit = u;
    words.splice(0, 2);
  }
  const name = words.join(" ");
  if (!name) return { error: `no product name in "${text}"` };
  if (qty === null) {
    if (!price || price.kind !== "total") return { error: `a line with no quantity needs a total (=90): "${text}"` };
  } else price ??= { kind: "default" };
  return { name, qty, unit, price };
}

export function parseSheet(text: string): ParsedSheet {
  const orders: SheetOrder[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const blocks = text.replace(/\r\n/g, "\n").split(/^(?=## )/m).filter((b) => b.startsWith("## "));
  for (const block of blocks) {
    const [head = "", ...body] = block.split("\n");
    const m = /^## (A\d{2})(?:\s+(\S+))?\s*$/.exec(head);
    if (!m) {
      errors.push(`${head.slice(0, 12)}: the block id must look like A01`);
      continue;
    }
    const id = m[1]!;
    if (seen.has(id)) {
      errors.push(`${id}: appears twice`);
      continue;
    }
    seen.add(id);
    let said = "";
    let checks = 0;
    let notAdded = 0;
    let ownerCheck: string | undefined;
    let skipped: string | undefined;
    const lines: ExpectedLine[] = [];
    let bad = false;
    const fail = (why: string) => (errors.push(`${id}: ${why}`), (bad = true));
    for (const raw of body) {
      const line = raw.trim();
      const oc = /^#\s*OWNER CHECK:?\s*(.*)$/i.exec(line);
      if (oc) ownerCheck = oc[1] || "check this order";
      const sk = /^#\s*SKIP(?:PED)?:?\s*(.*)$/i.exec(line);
      if (sk) skipped = sk[1] || "skipped";
      if (!line || line.startsWith("#")) continue;
      if (/^said:/i.test(line)) said = line.slice(5).trim();
      else if (/^checks:/i.test(line)) {
        const n = line.slice(7).trim();
        if (!/^\d+$/.test(n)) fail(`checks must be a number ("${line}")`);
        else checks = Number(n);
      } else if (line.startsWith("- ")) {
        const r = parseLine(line.slice(2).trim());
        if ("error" in r) fail(r.error);
        else if ("notAdded" in r) notAdded += r.notAdded;
        else lines.push(r);
      } else fail(`lines start with "- " ("${line.slice(0, 30)}")`);
    }
    if (bad) continue;
    const pending = ownerCheck !== undefined || skipped !== undefined || (said === "" && lines.length === 0 && notAdded === 0);
    orders.push({ id, category: m[2] ?? "", said, expected: pending ? null : { lines, notAdded, checks }, ...(ownerCheck !== undefined ? { ownerCheck } : {}), ...(skipped !== undefined ? { skipped } : {}) });
  }
  if (blocks.length === 0 && text.trim() !== "") errors.push(`no "## A01 ..." block found`);
  return { orders, errors };
}
