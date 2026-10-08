import { NAME_MAX_CHARS, codePointLength, parseIndianMobile } from "./customer.js";
import type { ParseResult } from "./billEdit.js";
import type { BillLanguage } from "./receipt.js";

// KB-312 (S7): what a shopkeeper may type into Settings. Domain only - no I/O.
// The shop's name and phone print on every receipt, so they follow the customer
// rules: control characters dropped, 60 code points, an Indian mobile for the phone
// (a landline with an STD code is refused for MVP - NI-39).

export const SHOP_NAME_MAX_CHARS = NAME_MAX_CHARS;
export const SHOP_NAME_REQUIRED = "Shop name is required.";
export const SHOP_NAME_TOO_LONG = `Shop name is too long — ${SHOP_NAME_MAX_CHARS} characters at most`;

export const BILL_LANGUAGES: readonly BillLanguage[] = ["en", "hi", "both"];

export function isBillLanguage(value: unknown): value is BillLanguage {
  return typeof value === "string" && (BILL_LANGUAGES as readonly string[]).includes(value);
}

// C0 and C1 control characters - Postgres text can't even hold \u0000.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

export function parseShopName(text: string): ParseResult<string> {
  const name = text.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, error: SHOP_NAME_REQUIRED };
  if (codePointLength(name) > SHOP_NAME_MAX_CHARS) return { ok: false, error: SHOP_NAME_TOO_LONG };
  return { ok: true, value: name };
}

export const SHOP_PHONE_NO_LEADING_ZERO = "Enter the 10-digit mobile number without a leading 0 (landline numbers aren't supported yet)";

/**
 * The shop's phone: an Indian mobile stored as 10 digits; empty clears it. Unlike a customer's mobile, a
 * leading 0 is refused: parseIndianMobile reads "0712-2345678" (a Nagpur landline) as the mobile 7122345678,
 * which would print a wrong number on every receipt. Landlines with an STD code: NI-39.
 */
export function parseShopPhone(text: string): ParseResult<string | null> {
  if (new RegExp("^\\s*[(]?\\s*[0" + String.fromCharCode(0x966) + "]").test(text)) return { ok: false, error: SHOP_PHONE_NO_LEADING_ZERO };
  return parseIndianMobile(text);
}
