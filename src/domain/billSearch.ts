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

/** A bill ready to search: its lowercased text and numbers, built ONCE when the list loads. */
export interface SearchEntry<B extends SearchableBill = SearchableBill> {
  readonly bill: B;
  /** Customer name and every item's display / spoken name, lowercased, one per line. */
  readonly text: string;
  readonly receipt: string;
  readonly sequence: number | null;
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

export function toSearchEntry<B extends SearchableBill>(bill: B): SearchEntry<B> {
  const d = new Date(bill.at);
  const names = bill.items.flatMap((i) => (i.spokenName ? [i.displayName, i.spokenName] : [i.displayName]));
  return {
    bill,
    text: [bill.customerName, ...names].join("\n").toLowerCase(),
    receipt: bill.receiptNumber.toLowerCase(),
    sequence: sequenceNumber(bill.receiptNumber),
    day: d.getDate(),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
  };
}

/** One search word, parsed once per keystroke. */
function compileWord(word: string): (e: SearchEntry) => boolean {
  const sequence = /^\d+$/.test(word) ? Number(word) : null;
  const paise = amountPaise(word);
  const date = dateParts(word);
  return (e) =>
    e.text.includes(word) ||
    e.receipt === word ||
    (sequence !== null && e.sequence === sequence) ||
    (paise !== null && paise === e.bill.totalPaise) ||
    (date !== null && e.day === date[0] && e.month === date[1] && (date[2] === null || e.year === date[2]));
}

/** The query parsed ONCE; the returned test runs per entry. Every word must match something. */
export function compileQuery(query: string): (e: SearchEntry) => boolean {
  const words = normalizeDigits(query).toLowerCase().split(/\s+/).filter(Boolean).map(compileWord);
  return (e) => words.every((w) => w(e));
}

export function matchBill(query: string, bill: SearchableBill): boolean {
  return compileQuery(query)(toSearchEntry(bill));
}
