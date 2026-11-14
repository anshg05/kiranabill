import { buildReceipt, type Receipt, type ReceiptItem } from "@/domain/receipt";
import type { Paise } from "@/domain/money";

// DEV ONLY (KB-408): the bills the print previews and the threshold fixtures are made from. Bill 514 is the owner's REAL bill, read
// from his printed copy (S6, 13-14 Nov 2026): 38 lines, total Rs 2,216 - item names and prices only, no customer. Its lines cover the
// cases that matter on paper: long names, "—" rates, a per-kg rate on a gram quantity (₹500/kg), a line with no quantity.

type Line = readonly [name: string, qty: number | null, unit: string | null, rateRupees: number | null, totalRupees: number, rateUnit?: string];

const BILL_514: readonly Line[] = [
  ["चावल", 5, "kg", 68, 340], ["शक्कर", 3, "kg", 58, 174], ["उड़द मोगर", 0.5, "kg", 130, 65], ["मसूर सैगी", 0.5, "kg", 80, 40], ["मूंग दाल", 0.5, "kg", 100, 50],
  ["तूर दाल", 1, "kg", 150, 150], ["दाने", 1, "kg", 150, 150], ["चना दाल", 0.5, "kg", 90, 45], ["टाटा नमक", 1, "piece", 30, 30], ["गरम मसाला", 100, "gm", null, 56],
  ["पतला पोहा", 1, "kg", 60, 60], ["चावल", 2, "kg", 40, 80], ["जाड़ा पोहा पैकेट", 1, "kg", 55, 55], ["बेसन पैकेट", 0.5, "kg", null, 55], ["चाय पत्ती मार्वल", 0.25, "kg", null, 55],
  ["20 20 बिस्किट", 1, "packet", null, 55], ["विम लिक्विड", 1, "packet", 15, 15], ["रवा", 1, "kg", 45, 45], ["एक्सपर्ट बार साबुन", 12, "piece", null, 55], ["सौंफ", 50, "gm", 500, 25, "kg"],
  ["राई", 250, "gm", 100, 25, "kg"], ["कलमी", 25, "gm", null, 15], ["मीरे", 25, "gm", null, 25], ["लौंग", 25, "gm", null, 30], ["भैया पाउडर", 1, "piece", 20, 20],
  ["पापड़", null, null, null, 55], ["मिर्ची", 100, "gm", null, 35], ["तन-मन निरमा", 1, "kg", null, 80], ["सोयाबीन बड़ी", 0.25, "kg", 100, 25], ["काबुली चना", 0.25, "kg", 100, 25],
  ["धनिया पाउडर", 100, "gm", null, 30], ["हल्दी पाउडर", 100, "gm", null, 35], ["काला नमक", 1, "piece", 10, 10], ["ईनो", 5, "packet", null, 50], ["शैम्पू", 32, "piece", null, 28],
  ["आटा", 2, "kg", 40, 80], ["राजमा", 0.25, "kg", null, 33], ["विम लिक्विड", 1, "piece", 15, 15],
];

const THREE: readonly Line[] = [["चीनी", 2, "kg", 45, 90], ["चावल", 5, "kg", null, 340], ["टाटा नमक", 1, "piece", 30, 30]];

function receipt(number: string, lines: readonly Line[], at: string): Receipt {
  const items = lines.map(([name, qty, unit, rate, total, rateUnit]): ReceiptItem => ({
    displayName: name,
    qty,
    unit,
    ratePaise: rate === null ? null : ((rate * 100) as Paise),
    rateUnit: rate === null ? null : (rateUnit ?? unit),
    totalPaise: (total * 100) as Paise,
  }));
  const totalPaise = items.reduce((s, i) => s + i.totalPaise, 0) as Paise;
  return buildReceipt(
    { receiptNumber: number, customerName: "Cash", totalPaise, finalizedAt: at, createdAt: at, status: "final" },
    items,
    { name: "Gupta Kirana Store", phone: null, logoUrl: null, billLanguage: "en" },
  );
}

/** The widest numbers a kirana bill can hold: a 6-digit amount and total, "80 packet", a per-kg rate on a gram quantity. */
export const WIDE_NUMBERS_BILL: Receipt = receipt(
  "100000",
  [["काजू कतली मिठाई डिब्बा", 80, "packet", 1250, 100000], ["केसर कश्मीरी", 250, "gm", 1250, 312.5, "kg"]],
  "2026-11-14T06:30:00.000Z",
);

export const DEV_PRINT_BILLS = {
  bill514: receipt("514", BILL_514, "2026-11-10T07:32:00.000Z"),
  three: receipt("515", THREE, "2026-11-11T07:48:00.000Z"),
} as const;
