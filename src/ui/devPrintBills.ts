import { buildReceipt, type Receipt, type ReceiptItem } from "@/domain/receipt";
import type { Paise } from "@/domain/money";

// DEV ONLY (KB-408 S3): the bills the print previews and the threshold fixtures are made from. Bill 514: its first 7 rows and its shop
// are the ones shown in the approved design (docs/design/screens/15-BillDetail.html); the other 31 rows are typical kirana lines chosen
// for the hard Devanagari - ि ी ् ँ ं, क्ष, द्ध, a long name that wraps, a spoken total with no rate ("—"). Not the real Bill 514's lines.

type Line = readonly [name: string, qty: number | null, unit: string | null, rateRupees: number | null, totalRupees?: number];

const BILL_514: readonly Line[] = [
  ["चावल", 5, "kg", 68], ["शक्कर", 3, "kg", 58], ["उड़द मोगर", 0.5, "kg", 130], ["मसूर सैगी", 0.5, "kg", 80], ["मूंग दाल", 0.5, "kg", 100],
  ["तूर दाल", 1, "kg", 150], ["दाने", 1, "kg", 150], ["चीनी", 2, "kg", 45], ["आटा", 10, "kg", 38], ["मैदा", 1, "kg", 40],
  ["बेसन", 1, "kg", 90], ["हल्दी पाउडर", 0.2, "kg", 260], ["मिर्ची पाउडर", 0.2, "kg", 300], ["धनिया पाउडर", 0.2, "kg", 200], ["जीरा", 0.1, "kg", 400],
  ["सौंफ", 0.1, "kg", 240], ["इलायची", 0.05, "kg", 3000], ["किशमिश", 0.25, "kg", 320], ["काजू", 0.25, "kg", 900], ["शुद्ध घी", 1, "liter", 620],
  ["सरसों का तेल", 1, "liter", 180], ["टाटा नमक", 1, "piece", 30], ["क्षीर मिक्स", 2, "packet", 45], ["पोहा", 1, "kg", 60], ["सूजी", 1, "kg", 44],
  ["साबूदाना", 0.5, "kg", 110], ["मूँगफली", 1, "kg", 140], ["रिन साबुन", 2, "piece", 10], ["लाइजोल", 1, "bottle", 99], ["बिस्किट", 4, "packet", 10],
  ["चिप्स", 3, "packet", 20], ["मैगी नूडल्स", 4, "packet", 14], ["चाय पत्ती", 0.25, "kg", 480], ["दूध", 2, "liter", 56], ["दही", null, null, null, 40],
  ["अगरबत्ती", 1, "packet", null, 25], ["पुदीना", 1, "piece", 10], ["बासमती चावल प्रीमियम पुराना लंबा दाना", 1, "kg", 140],
];

const THREE: readonly Line[] = [["चीनी", 2, "kg", 45], ["चावल", 5, "kg", null, 340], ["टाटा नमक", 1, "piece", 30]];

function receipt(number: string, lines: readonly Line[], at: string): Receipt {
  const items = lines.map(([name, qty, unit, rate, total]): ReceiptItem => ({
    displayName: name,
    qty,
    unit,
    ratePaise: rate === null ? null : ((rate * 100) as Paise),
    rateUnit: rate === null ? null : unit,
    totalPaise: Math.round((total ?? (qty ?? 0) * (rate ?? 0)) * 100) as Paise,
  }));
  const totalPaise = items.reduce((s, i) => s + i.totalPaise, 0) as Paise;
  return buildReceipt(
    { receiptNumber: number, customerName: "Cash", totalPaise, finalizedAt: at, createdAt: at, status: "final" },
    items,
    { name: "Gupta Kirana Store", phone: "9876543210", logoUrl: null, billLanguage: "en" },
  );
}

export const DEV_PRINT_BILLS = {
  bill514: receipt("514", BILL_514, "2026-11-10T07:32:00.000Z"),
  three: receipt("515", THREE, "2026-11-11T07:48:00.000Z"),
} as const;
export const DEV_BILL_514_ROWS = BILL_514.length;
