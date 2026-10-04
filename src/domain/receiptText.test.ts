import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { buildReceipt, type ReceiptBill, type ReceiptShop } from "./receipt";
import { receiptText, smsLink, smsText, waLink } from "./receiptText";

// KB-309 (owner, 4 Oct 2026, Q2/Q5): the WhatsApp text, from the same
// buildReceipt - bill_language labels, the shop phone when there is one,
// exact paise, never the mobile. waLink: the bill's stored mobile as
// wa.me/91XXXXXXXXXX; no number -> the shopkeeper picks the chat.

const shop: ReceiptShop = { name: "Sharma Kirana", phone: "9876543210", logoUrl: null, billLanguage: "en" };

function receipt(over: Partial<ReceiptBill> = {}, shopOver: Partial<ReceiptShop> = {}) {
  const lines: FinalLine[] = ["2 kilo chini", "500 gram chini", "chini 30 rupay"].flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
      id: `l${u}-${i}`, utteranceId: u, item, original: item,
      displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
    })),
  );
  const built = buildFinalBill(lines, []);
  if (!built.ok) throw new Error(built.error);
  const bill: ReceiptBill = { receiptNumber: "KB-000142", customerName: "Ramesh", totalPaise: built.totalPaise, finalizedAt: "2026-10-04T12:45:00.000Z", createdAt: "2026-10-04T12:44:00.000Z", ...over };
  return buildReceipt(bill, built.items, { ...shop, ...shopOver });
}

describe("receiptText - the WhatsApp message", () => {
  it("en: the approved format, with the shop phone line", () => {
    const r = receipt();
    expect(receiptText(r)).toBe(
      [
        "*SHARMA KIRANA*",
        "98765 43210",
        `Bill No. KB-000142 · ${r.dateTime}`,
        "Customer: Ramesh",
        "Chini — 2 kg × ₹45 = ₹90",
        "Chini — 500 gm × ₹45/kg = ₹22.50",
        "Chini — ₹30",
        "*TOTAL ₹142.50*",
        "Thank You!",
      ].join("\n"),
    );
  });

  it("no shop phone -> no phone line; Cash -> no customer line", () => {
    const text = receiptText(receipt({ customerName: "Cash" }, { phone: null }));
    expect(text.split("\n").slice(0, 2)).toEqual(["*SHARMA KIRANA*", expect.stringMatching(/^Bill No\. KB-000142 · /)]);
    expect(text).not.toContain("Customer");
    expect(text).not.toContain("Cash");
  });

  it("hi and both: the bill_language labels and units", () => {
    const hi = receiptText(receipt({}, { billLanguage: "hi" }));
    for (const v of ["बिल नं. KB-000142", "ग्राहक: Ramesh", "Chini — 2 किलो × ₹45 = ₹90", "*कुल ₹142.50*", "धन्यवाद!"]) expect(hi, v).toContain(v);
    const both = receiptText(receipt({}, { billLanguage: "both" }));
    for (const v of ["बिल नं. / Bill No. KB-000142", "*कुल / TOTAL ₹142.50*", "धन्यवाद!  Thank You!"]) expect(both, v).toContain(v);
  });

  it("a qty without a rate: 'name — qty = amount'", () => {
    const r = receipt();
    const one = { ...r, rows: [{ name: "Kuch naya", qty: "2 kg", rate: "—", amount: "₹240" }] };
    expect(receiptText(one)).toContain("Kuch naya — 2 kg = ₹240");
  });

  it("the mobile is never in the text (it isn't an input); names are sent as typed", () => {
    const r = receipt({ customerMobile: "9123456789", customerName: "<b>Ramesh*</b>" } as Partial<ReceiptBill>);
    const text = receiptText(r);
    expect(text).not.toContain("9123456789");
    expect(text).toContain("Customer: <b>Ramesh*</b>");
  });
});

describe("waLink - wa.me with the bill's stored mobile", () => {
  it("a 10-digit mobile -> wa.me/91XXXXXXXXXX, the text URI-encoded", () => {
    expect(waLink("Bill No. KB-1 · ₹90\n*TOTAL*", "9123456789")).toBe(`https://wa.me/919123456789?text=${encodeURIComponent("Bill No. KB-1 · ₹90\n*TOTAL*")}`);
  });

  it("no mobile, or not a valid one -> no number (the shopkeeper picks the chat)", () => {
    expect(waLink("hi", null)).toBe("https://wa.me/?text=hi");
    expect(waLink("hi", "12345")).toBe("https://wa.me/?text=hi");
    expect(waLink("hi", "1234567890")).toBe("https://wa.me/?text=hi"); // D52: starts 6-9
  });
});

describe("smsText - the SMS (owner, KB-309 commit 3): plain text, Rs. not the rupee sign", () => {
  it("en: no WhatsApp *bold*, Rs. for amounts, the shop phone; GSM-7-friendly (plain ASCII for ASCII names)", () => {
    const r = receipt();
    const text = smsText(r);
    expect(text).toBe(
      [
        "SHARMA KIRANA",
        "98765 43210",
        `Bill No. KB-000142 - ${r.dateTime}`,
        "Customer: Ramesh",
        "Chini - 2 kg x Rs.45 = Rs.90",
        "Chini - 500 gm x Rs.45/kg = Rs.22.50",
        "Chini - Rs.30",
        "TOTAL Rs.142.50",
        "Thank You!",
      ].join("\n"),
    );
    // The rupee sign, the middle dot, the em dash, "×" and "*" would each force a Unicode SMS (more parts).
    expect(text).toMatch(/^[\x20-\x7E\n]*$/);
  });

  it("hi: the bill_language labels (Devanagari makes it a Unicode SMS anyway - 05 §6)", () => {
    const text = smsText(receipt({}, { billLanguage: "hi" }));
    for (const v of ["बिल नं. KB-000142", "ग्राहक: Ramesh", "Chini - 2 किलो x Rs.45 = Rs.90", "कुल Rs.142.50", "धन्यवाद!"]) expect(text, v).toContain(v);
    expect(text).not.toContain("₹");
  });

  it("the mobile is never in the text", () => {
    expect(smsText(receipt({ customerMobile: "9123456789" } as Partial<ReceiptBill>))).not.toContain("9123456789");
  });
});

describe("smsLink - sms:<10 digits>?body=, only for a valid D52 mobile", () => {
  it("a valid mobile -> the Android form, body URI-encoded", () => {
    expect(smsLink("TOTAL Rs.90\nThank You!", "9123456789")).toBe(`sms:9123456789?body=${encodeURIComponent("TOTAL Rs.90\nThank You!")}`);
  });

  it("anything that isn't 10 digits starting 6-9 -> no link", () => {
    for (const bad of ["", "12345", "1234567890", "91234567890", "+919123456789", "9123 456789"]) expect(smsLink("x", bad), bad).toBeNull();
  });
});
