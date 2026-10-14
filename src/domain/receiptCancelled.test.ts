import { describe, expect, it } from "vitest";
import { buildReceipt, type ReceiptBill, type ReceiptItem, type ReceiptShop } from "./receipt";
import { layoutReceipt, type DrawText, type Measure } from "./receiptLayout";
import { receiptText, smsText } from "./receiptText";

// KB-325 (D79): a cancelled bill's receipt carries a CANCELLED line in every rendering (screen, image / PDF, WhatsApp
// text, SMS) - it is never shown or shared as if it were valid. The reason is internal: it is not an input here.

const measure: Measure = (text, font) => [...text].length * font.size * 0.6;
const shop: ReceiptShop = { name: "Sharma Kirana", phone: "9876543210", logoUrl: null, billLanguage: "en" };
const items: ReceiptItem[] = [{ displayName: "Chini", qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000 }];
const bill = (over: Partial<ReceiptBill> = {}): ReceiptBill => ({
  receiptNumber: "KB-000142", customerName: "Ramesh", totalPaise: 9000, finalizedAt: "2026-10-04T12:45:00.000Z", createdAt: "2026-10-04T12:44:00.000Z", ...over,
});

describe("the CANCELLED line", () => {
  it("is set only for a cancelled bill, in the shop's bill language", () => {
    expect(buildReceipt(bill({ status: "cancelled" }), items, shop).cancelled).toBe("CANCELLED");
    expect(buildReceipt(bill({ status: "cancelled" }), items, { ...shop, billLanguage: "hi" }).cancelled).toBe("रद्द");
    expect(buildReceipt(bill({ status: "cancelled" }), items, { ...shop, billLanguage: "both" }).cancelled).toBe("रद्द / CANCELLED");
    expect(buildReceipt(bill({ status: "final" }), items, shop).cancelled).toBeNull();
    expect(buildReceipt(bill(), items, shop).cancelled).toBeNull();
  });

  it("the money and the lines are exactly as stored - a cancelled receipt shows the same total", () => {
    const final = buildReceipt(bill({ status: "final" }), items, shop);
    const cancelled = buildReceipt(bill({ status: "cancelled" }), items, shop);
    expect({ ...cancelled, cancelled: null }).toEqual(final);
  });

  it("image / PDF: one centred bold step, below the date and above the bill number; none for a valid bill", () => {
    const ops = layoutReceipt(buildReceipt(bill({ status: "cancelled" }), items, shop), measure, 384).ops.filter((o): o is DrawText => o.kind === "text");
    const step = ops.filter((t) => t.role === "cancelled");
    expect(step.map((t) => t.text).join("")).toBe("CANCELLED");
    expect(step[0]).toMatchObject({ align: "center" });
    const y = (role: string) => ops.find((t) => t.role === role)!.y;
    expect(step[0]!.y).toBeGreaterThan(y("date-time"));
    expect(step[0]!.y).toBeLessThan(y("bill-no-label"));
    const valid = layoutReceipt(buildReceipt(bill({ status: "final" }), items, shop), measure, 384).ops.filter((o): o is DrawText => o.kind === "text");
    expect(valid.some((t) => t.role === "cancelled")).toBe(false);
  });

  it("WhatsApp text and SMS: a CANCELLED line right under the shop name; none for a valid bill", () => {
    const cancelled = buildReceipt(bill({ status: "cancelled" }), items, shop);
    expect(receiptText(cancelled).split("\n").slice(0, 3)).toEqual(["*SHARMA KIRANA*", "98765 43210", "*CANCELLED*"]);
    expect(smsText(cancelled).split("\n").slice(0, 3)).toEqual(["SHARMA KIRANA", "98765 43210", "CANCELLED"]);
    const valid = buildReceipt(bill({ status: "final" }), items, shop);
    expect(receiptText(valid)).not.toMatch(/CANCELLED/);
    expect(smsText(valid)).not.toMatch(/CANCELLED/);
  });
});
