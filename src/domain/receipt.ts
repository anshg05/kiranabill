import { shownRate } from "./billEdit.js";
import { formatRupees, type Paise } from "./money.js";

// KB-308: the kirana parchi (05 §6) as plain text pieces - no HTML here. React
// draws it (text nodes, so every value is escaped - hard rule 9); KB-309 can
// draw the same pieces on a canvas. Read from the bill as STORED, never the
// draft. The customer's mobile is not an input (D52: never printed).

export type BillLanguage = "en" | "hi" | "both";

/** Owner-approved strings (3 Oct 2026) - one table, easy to change. */
export const RECEIPT_TEXT = {
  en: { bill: "Bill:", total: "TOTAL", thanks: "Thank you!", item: "Item", qty: "Qty", rate: "Rate", amount: "Amount" },
  hi: { bill: "बिल:", total: "कुल", thanks: "धन्यवाद!", item: "सामान", qty: "मात्रा", rate: "दर", amount: "रकम" },
} as const;

/** Units as printed. A unit missing here prints as stored. "both" uses Hindi. */
const UNIT_TEXT: Record<"en" | "hi", Record<string, string>> = {
  en: { kg: "kg", gm: "gm", liter: "l", ml: "ml", piece: "pc", packet: "packet", dozen: "dozen", box: "box", bottle: "bottle", pouch: "pouch", bag: "bag", can: "can", tin: "tin" },
  hi: { kg: "किलो", gm: "ग्राम", liter: "लीटर", ml: "मि.ली.", piece: "पीस", packet: "पैकेट", dozen: "दर्जन", box: "डिब्बा", bottle: "बोतल", pouch: "पाउच", bag: "थैला", can: "कैन", tin: "टिन" },
};

export interface ReceiptShop {
  readonly name: string;
  readonly phone: string | null;
  readonly logoUrl: string | null;
  readonly billLanguage: BillLanguage;
}

export interface ReceiptBill {
  readonly receiptNumber: string;
  readonly customerName: string;
  readonly totalPaise: Paise;
  readonly finalizedAt: string | null;
  readonly createdAt: string;
}

export interface ReceiptItem {
  readonly displayName: string;
  readonly qty: number | null;
  readonly unit: string | null;
  readonly ratePaise: Paise | null;
  readonly rateUnit: string | null;
  readonly totalPaise: Paise;
}

export interface ReceiptRow {
  readonly name: string;
  readonly qty: string;
  readonly rate: string;
  readonly amount: string;
}

export interface Receipt {
  readonly logoUrl: string | null;
  readonly shopName: string;
  readonly shopPhone: string | null;
  readonly billLabel: string;
  readonly receiptNumber: string;
  /** Q1 A: the number may break only after a hyphen; joined = receiptNumber. */
  readonly numberChunks: readonly string[];
  readonly dateTime: string;
  /** null for "Cash" (KB-306). */
  readonly customer: string | null;
  readonly headers: { readonly item: string; readonly qty: string; readonly rate: string; readonly amount: string };
  readonly rows: readonly ReceiptRow[];
  readonly totalLabel: string;
  readonly total: string;
  readonly thanks: readonly string[];
}

/** "KB-6f1c...-3" -> ["KB-", "6f1c...-", ..., "3"]: a break is allowed only after a hyphen. */
export function numberChunks(receiptNumber: string): string[] {
  return receiptNumber.match(/[^-]*-|[^-]+$/g) ?? [receiptNumber];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "15-08-2026 6:56 PM", in the device's time zone (05 §6). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** A 10-digit number as "98765 43210"; anything else as stored. */
function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  return /^\d{10}$/.test(phone) ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
}

export function buildReceipt(bill: ReceiptBill, items: readonly ReceiptItem[], shop: ReceiptShop): Receipt {
  const lang = shop.billLanguage;
  const label = (key: keyof typeof RECEIPT_TEXT.en) =>
    lang === "both" ? `${RECEIPT_TEXT.hi[key].replace(/:$/, "")} / ${RECEIPT_TEXT.en[key]}` : RECEIPT_TEXT[lang][key];
  const units = UNIT_TEXT[lang === "en" ? "en" : "hi"];
  const unitText = (unit: string) => units[unit] ?? unit;

  const rows = items.map((item): ReceiptRow => {
    const rate = shownRate({ rate: item.ratePaise, rateUnit: item.rateUnit, unit: item.unit ?? "" });
    return {
      name: item.displayName,
      // D47: a spoken total has no qty - "—", never a number nobody said.
      qty: item.qty === null ? "—" : item.unit ? `${item.qty} ${unitText(item.unit)}` : String(item.qty),
      rate: rate === null ? "" : rate.unit === null ? formatRupees(rate.paise) : `${formatRupees(rate.paise)}/${unitText(rate.unit)}`,
      amount: formatRupees(item.totalPaise).replace("₹", ""),
    };
  });

  return {
    logoUrl: shop.logoUrl,
    shopName: shop.name,
    shopPhone: formatPhone(shop.phone),
    billLabel: label("bill"),
    receiptNumber: bill.receiptNumber,
    numberChunks: numberChunks(bill.receiptNumber),
    dateTime: formatDateTime(bill.finalizedAt ?? bill.createdAt),
    customer: bill.customerName === "Cash" ? null : bill.customerName,
    headers: { item: label("item"), qty: label("qty"), rate: label("rate"), amount: label("amount") },
    rows,
    totalLabel: label("total"),
    total: formatRupees(bill.totalPaise),
    thanks: lang === "both" ? [RECEIPT_TEXT.hi.thanks, RECEIPT_TEXT.en.thanks] : [RECEIPT_TEXT[lang].thanks],
  };
}
