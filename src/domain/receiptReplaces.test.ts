import { describe, expect, it } from "vitest";
import { buildReceipt, type ReceiptBill, type ReceiptItem, type ReceiptShop } from "./receipt";
import { layoutReceipt, type DrawText, type Measure } from "./receiptLayout";
import { receiptText, smsText } from "./receiptText";

// KB-325 / SG-13 (owner, 16 Oct 2026; D57): the replacement bill's receipt prints one small muted line under the bill
// number - "Replaces Bill KB-000142" - in every rendering (screen, image / PDF, WhatsApp text, SMS). The customer who
// still holds the cancelled receipt sees which bill supersedes it. Nothing else on the receipt changes.

const measure: Measure = (text, font) => [...text].length * font.size * 0.6;
const shop: ReceiptShop = { name: "Sharma Kirana", phone: null, logoUrl: null, billLanguage: "en" };
const items: ReceiptItem[] = [{ displayName: "Chini", qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000 }];
const bill: ReceiptBill = { status: "final", receiptNumber: "KB-000143", customerName: "Ramesh", totalPaise: 9000, finalizedAt: "2026-10-04T12:45:00.000Z", createdAt: "2026-10-04T12:44:00.000Z" };
const build = (replaces: string | null, over: Partial<ReceiptShop> = {}) => buildReceipt(bill, items, { ...shop, ...over }, replaces);

describe("the 'Replaces Bill' line", () => {
  it("is the predecessor's number in the shop's bill language; null for an ordinary bill", () => {
    expect(build("KB-000142").replaces).toBe("Replaces Bill KB-000142");
    expect(build("KB-000142", { billLanguage: "hi" }).replaces).toBe("बिल नं. KB-000142 की जगह");
    expect(build("KB-000142", { billLanguage: "both" }).replaces).toBe("बिल नं. KB-000142 की जगह / Replaces Bill KB-000142");
    expect(build(null).replaces).toBeNull();
    expect(buildReceipt(bill, items, shop).replaces).toBeNull();
  });

  it("nothing else changes: the same lines, total, number and date", () => {
    expect({ ...build("KB-000142"), replaces: null }).toEqual(build(null));
  });

  it("image / PDF: a small muted left step below the bill number and above the customer; none for an ordinary bill", () => {
    const ops = layoutReceipt(build("KB-000142"), measure, 384).ops.filter((o): o is DrawText => o.kind === "text");
    const step = ops.filter((t) => t.role === "replaces");
    expect(step.map((t) => t.text).join("")).toBe("Replaces Bill KB-000142");
    expect(step[0]).toMatchObject({ align: "left", muted: true });
    expect(step[0]!.size).toBeLessThan(ops.find((t) => t.role === "customer")!.size);
    const y = (role: string) => ops.find((t) => t.role === role)!.y;
    expect(step[0]!.y).toBeGreaterThan(y("number"));
    expect(step[0]!.y).toBeLessThan(y("customer"));
    expect(layoutReceipt(build(null), measure, 384).ops.some((o) => o.kind === "text" && o.role === "replaces")).toBe(false);
  });

  it("WhatsApp text and SMS: the line sits right under the bill-number line; none for an ordinary bill", () => {
    const r = build("KB-000142");
    const wa = receiptText(r).split("\n");
    const sms = smsText(r).split("\n");
    expect(wa[wa.findIndex((l) => l.startsWith("Bill No."))! + 1]).toBe("Replaces Bill KB-000142");
    expect(sms[sms.findIndex((l) => l.startsWith("Bill No."))! + 1]).toBe("Replaces Bill KB-000142");
    expect(receiptText(build(null))).not.toMatch(/Replaces/);
    expect(smsText(build(null))).not.toMatch(/Replaces/);
  });

  it("a cancelled bill that is itself a replacement shows both lines (CANCELLED and Replaces)", () => {
    const r = buildReceipt({ ...bill, status: "cancelled" }, items, shop, "KB-000142");
    expect([r.cancelled, r.replaces]).toEqual(["CANCELLED", "Replaces Bill KB-000142"]);
  });
});
