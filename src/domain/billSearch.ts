import { normalizeDigits } from "./billEdit.js";
import type { Paise } from "./money.js";

// KB-310 (owner, 7 Oct 2026): history search, all on the device (05 §5:
// customer, amount, date, item; owner: exact amounts in paise, dd-mm dates
// with - / . and single digits, Devanagari digits as 0-9). Every word must
// match something. The customer's mobile is not an input (D52).

export interface SearchableBill {
  readonly receiptNumber: string;
  readonly customerName: string;
  readonly totalPaise: Paise;
  /** When it was finalised (ISO). */
  readonly at: string;
  readonly items: readonly { readonly displayName: string; readonly spokenName: string | null }[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "04-10-2026" - the bill's date in device time (the date group). */
export function billDateKey(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** "112", "112.5", "112.50" -> paise, without floating point; anything else -> null. */
function amountPaise(word: string): Paise | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(word);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** "4/10", "04-10", "4.10.26", "04-10-2026" -> [day, month, year | null]; anything else -> null. */
function dateParts(word: string): [number, number, number | null] | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(word);
  if (!m) return null;
  const year = m[3] === undefined ? null : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return [Number(m[1]), Number(m[2]), year];
}

/** KB-000142 -> 142; a fallback number (UUID) has none. */
function sequenceNumber(receiptNumber: string): number | null {
  const m = /^[^-]+-(\d+)$/.exec(receiptNumber);
  return m ? Number(m[1]) : null;
}

/**
 * D61: a bill's search row, stored in its own device-only table (billSearch),
 * written in the same transaction as the bill. Never the customer's mobile.
 */
export interface BillSearchRow {
  readonly localId: string;
  readonly shopId: string;
  /** When it was finalised (ISO) - the [shopId+finalizedAt] index. */
  readonly finalizedAt: string;
  readonly totalPaise: Paise;
  /** KB-000142 -> 142; null for a fallback number. */
  readonly sequence: number | null;
  /** "04-10-2026", device time when written. */
  readonly dateKey: string;
  /** As printed - shown on the result row. */
  readonly receiptNumber: string;
  readonly customerName: string;
  /** Customer name, then every item's display and spoken names - lowercased, one per line. */
  readonly text: string;
}

export function toBillSearchRow(bill: SearchableBill & { readonly localId: string; readonly shopId: string }): BillSearchRow {
  const names = bill.items.flatMap((i) => (i.spokenName ? [i.displayName, i.spokenName] : [i.displayName]));
  return {
    localId: bill.localId,
    shopId: bill.shopId,
    finalizedAt: bill.at,
    totalPaise: bill.totalPaise,
    sequence: sequenceNumber(bill.receiptNumber),
    dateKey: billDateKey(bill.at),
    receiptNumber: bill.receiptNumber,
    customerName: bill.customerName,
    text: [bill.customerName, ...names].join("\n").toLowerCase(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** One search word, parsed once per keystroke. */
function compileWord(word: string): (r: BillSearchRow) => boolean {
  const sequence = /^\d+$/.test(word) ? Number(word) : null;
  const paise = amountPaise(word);
  const date = dateParts(word);
  // A date compares as text against the stored "dd-mm-yyyy" key.
  const dayMonth = date ? `${pad(date[0])}-${pad(date[1])}` : null;
  const full = date && date[2] !== null ? `${dayMonth}-${date[2]}` : null;
  return (r) =>
    r.text.includes(word) ||
    (sequence !== null && r.sequence === sequence) ||
    (paise !== null && paise === r.totalPaise) ||
    (dayMonth !== null && (full !== null ? r.dateKey === full : r.dateKey.startsWith(dayMonth))) ||
    r.receiptNumber.toLowerCase() === word;
}

/** The query parsed ONCE; the returned test runs per row. Every word must match something. */
export function compileQuery(query: string): (r: BillSearchRow) => boolean {
  const words = normalizeDigits(query).toLowerCase().split(/\s+/).filter(Boolean).map(compileWord);
  return (r) => words.every((w) => w(r));
}

export function matchBill(query: string, bill: SearchableBill): boolean {
  return compileQuery(query)(toBillSearchRow({ ...bill, localId: "", shopId: "" }));
}
