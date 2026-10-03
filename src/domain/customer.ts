import { normalizeDigits, type ParseResult } from "./billEdit.js";

// KB-306 (owner, 3 Oct 2026; D6, D52): the customer on a bill. A name that
// defaults to "Cash" and never blocks; an optional Indian mobile stored as
// exactly 10 digits (so a future udhaar can match bills). Nothing else - no
// profile, no list of past customers (01-PRD, DPDP Act 2023: minimal data).
//
// The stored-value rules are IDENTICAL to the bills CHECK constraints
// (migration 20261003090000): a mismatch would make a bill a permanent 23514
// sync conflict. Lengths are counted in code points, as Postgres char_length
// does - never JS .length (UTF-16 units: an emoji is 2). Proven against
// Postgres in data/customer.e2e.test.ts.

export const CASH = "Cash";
export const NAME_MAX_CHARS = 60;

export const NAME_TOO_LONG = `Name is too long — ${NAME_MAX_CHARS} characters at most`;
export const MOBILE_LENGTH = "Enter a 10-digit mobile number";
export const MOBILE_START = "Mobile numbers start with 6, 7, 8 or 9";
export const MOBILE_COUNTRY = "Only Indian mobile numbers (+91)";

/** Characters as Postgres char_length counts them: code points. */
export function codePointLength(text: string): number {
  return [...text].length;
}

// C0 and C1 control characters - Postgres text can't even hold \u0000.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** Trimmed, inner spaces collapsed, control characters dropped; empty or any
 * "cash" -> "Cash"; at most 60 code points. */
export function parseCustomerName(text: string): ParseResult<string> {
  const name = text.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (name === "" || name.toLowerCase() === "cash") return { ok: true, value: CASH };
  if (codePointLength(name) > NAME_MAX_CHARS) return { ok: false, error: NAME_TOO_LONG };
  return { ok: true, value: name };
}

/** 10 digits starting 6-9, optionally written +91 / 91 / 0 first, with spaces,
 * hyphens, dots or brackets, in Devanagari digits too. Stored as the 10
 * digits; empty clears it (null). */
export function parseIndianMobile(text: string): ParseResult<string | null> {
  let digits = normalizeDigits(text).replace(/[\s\-.()]/g, "");
  if (digits === "") return { ok: true, value: null };
  if (digits.startsWith("+")) {
    if (!digits.startsWith("+91")) return { ok: false, error: MOBILE_COUNTRY };
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[0-9]{10}$/.test(digits)) return { ok: false, error: MOBILE_LENGTH };
  if (!/^[6-9]/.test(digits)) return { ok: false, error: MOBILE_START };
  return { ok: true, value: digits };
}

/** "98765 43210" - display only; the bill stores the 10 digits. */
export function formatMobile(mobile: string): string {
  return `${mobile.slice(0, 5)} ${mobile.slice(5)}`;
}

/** = CHECK (char_length(customer_name) BETWEEN 1 AND 60). */
export function isStorableName(name: string): boolean {
  const n = codePointLength(name);
  return n >= 1 && n <= NAME_MAX_CHARS;
}

/** = CHECK (customer_mobile IS NULL OR customer_mobile ~ '^[6-9][0-9]{9}$'). */
export function isStorableMobile(mobile: string | null): boolean {
  return mobile === null || /^[6-9][0-9]{9}$/.test(mobile);
}
