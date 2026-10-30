import { slots } from "../../src/acceptance/categories.js";
import { parseSheet, sheetBlock } from "./sheet.js";
import type { OrdersFile } from "./store.js";
import type { AcceptanceOrder } from "./types.js";

// KB-364: the pure steps behind `npm run accept:import` and `npm run accept:build`.

export const SHEET_HEADER = `# Acceptance sheet (KB-364, docs/23-ACCEPTANCE.md). One block per recorded order - the same A-number as on the phone.
# Fill in "said:" (your words) and one "- " line per item of the bill you expect:
#   - 2 kg चीनी @45          a rate you said (per the unit)
#   - 5 kg चावल =225         a total you said
#   - चावल =90               a total with no quantity
#   - 1 kg मूंग दाल          nothing said: the shop's own price
#   - 1 kg बेसन price needed  you did not say it clearly: the bill must show Price needed
#   - NOT ADDED              a piece nothing can read (add a number for more than one)
# "checks: N" = how many Theek hai checks you accept for this order (usually 0).
# Leave a block empty to skip it. Then run: npm run accept:build

`;

/** Adds a template block for every slot not yet in the sheet; blocks already there (filled or not) are never touched. */
export function addMissingBlocks(sheet: string): string {
  let out = sheet === "" ? SHEET_HEADER : sheet;
  const have = new Set([...out.matchAll(/^## (A\d\d)/gm)].map((m) => m[1]));
  if (!out.endsWith("\n")) out += "\n";
  for (const slot of slots()) if (!have.has(slot.id)) out += sheetBlock(slot);
  return out;
}

export interface BuildResult {
  readonly errors: string[];
  /** null when there were errors. */
  readonly file: OrdersFile | null;
  /** Blocks with nothing filled in. */
  readonly pending: string[];
  /** Blocks kept out of the gate on purpose, with the reason. */
  readonly skipped: { id: string; reason: string }[];
}

/** The sheet -> orders.json. A frozen transcript and the frozen flag survive a rebuild; any error leaves the old file alone. */
export function buildOrders(sheetText: string, prev: OrdersFile): BuildResult {
  const parsed = parseSheet(sheetText);
  const known = new Map(slots().map((s) => [s.id, s]));
  const errors = [...parsed.errors];
  for (const o of parsed.orders) if (!known.has(o.id)) errors.push(`${o.id}: not one of the ${known.size} slots (A01..A${known.size})`);
  if (errors.length > 0) return { errors, file: null, pending: [], skipped: [] };
  const before = new Map(prev.orders.map((o) => [o.id, o]));
  const orders: AcceptanceOrder[] = [];
  const pending: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const o of parsed.orders) {
    if (o.skipped !== undefined) {
      skipped.push({ id: o.id, reason: o.skipped });
      continue;
    }
    if (!o.expected) {
      pending.push(o.id);
      continue;
    }
    orders.push({ id: o.id, category: known.get(o.id)!.category, said: o.said, transcript: before.get(o.id)?.transcript ?? null, expected: o.expected });
  }
  orders.sort((a, b) => a.id.localeCompare(b.id));
  return { errors: [], file: { frozen: prev.frozen, orders }, pending, skipped };
}

/**
 * The set locks (npm test then enforces the FULL gate) only after a PASSING run that covered EVERY order that has a frozen text, and
 * only when there are enough of them. A run of a few orders (accept:live --only A14) proves nothing about the set (30 Oct 2026).
 */
export function canLock(a: { passed: boolean; ranOrders: number; ordersWithText: number; min: number }): boolean {
  return a.passed && a.ranOrders === a.ordersWithText && a.ordersWithText >= a.min;
}
