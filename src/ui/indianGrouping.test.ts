import { describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { buildFinalBill, type FinalLine } from "@/domain/finalBill";
import { customItem, editAmount, MAX_AMOUNT_PAISE, parseMoneyInput } from "@/domain/billEdit";
import { buildReceipt, type ReceiptBill, type ReceiptShop } from "@/domain/receipt";
import { layoutReceipt, type DrawText, type Measure } from "@/domain/receiptLayout";
import { receiptText, smsText } from "@/domain/receiptText";
import { formatRupees } from "@/domain/money";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { formatAmount, formatRate, paiseText } from "@/ui/billFormat";
import { priceDriftText } from "@/ui/priceDriftText";

// KB-343 (owner, 19 Oct 2026, UI audit #12): Indian digit grouping on every amount - ₹1,520 and ₹1,25,000. Display only:
// stored paise and parsing unchanged. ONE formatter (formatRupees), so every renderer must group identically.

describe("formatRupees - Indian grouping", () => {
  it.each([
    [0, "₹0"],
    [99, "₹0.99"],
    [99900, "₹999"],
    [100000, "₹1,000"],
    [152000, "₹1,520"],
    [152050, "₹1,520.50"],
    [9999900, "₹99,999"],
    [10000000, "₹1,00,000"],
    [12500000, "₹1,25,000"],
    [12500050, "₹1,25,000.50"],
    [100000000, "₹10,00,000"],
    [-152000, "-₹1,520"],
  ])("%i paise -> %s", (paise, text) => {
    expect(formatRupees(paise)).toBe(text);
  });
});

describe("what is typed: commas are read, only in a real grouping (never a silent wrong number)", () => {
  const paise = (t: string) => {
    const r = parseMoneyInput(t, MAX_AMOUNT_PAISE);
    return r.ok ? r.value : null;
  };
  it("'1,520', '1,25,000', '125,000', '₹ 1,520.50' read as the amount they show", () => {
    expect(paise("1,520")).toBe(152000);
    expect(paise("1,25,000")).toBe(12500000);
    expect(paise("125,000")).toBe(12500000);
    expect(paise("₹ 1,520.50")).toBe(152050);
  });
  it("a comma that is not a grouping is refused: '1,5', '12,34', ',100', '1,,000'", () => {
    for (const bad of ["1,5", "12,34", ",100", "1,,000", "1,2345"]) expect(paise(bad), bad).toBeNull();
  });
  it("the editor's starting text stays plain - '1520' - so a small correction is one keystroke", () => {
    expect(paiseText(152000)).toBe("1520");
    expect(paiseText(12500050)).toBe("125000.50");
  });
});

describe("every renderer groups identically", () => {
  const shop: ReceiptShop = { name: "Sharma Kirana", phone: "9876543210", logoUrl: null, billLanguage: "en" };
  const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
    if (!r.ok) throw new Error(r.error);
    return r.item;
  };
  function receipt(billLanguage: ReceiptShop["billLanguage"] = "en") {
    const spoken: FinalLine[] = parseUtterance("chini 1520 rupay", SEED_PARSER_CATALOG)!.map((item, i) => ({
      id: `l${i}`, utteranceId: 1, item, original: item, displayName: "Chini", source: "fastpath" as const,
    }));
    const custom: FinalLine = { id: "c", utteranceId: 2, item: ok(editAmount(customItem("Sofa set"), "125000")), original: customItem("Sofa set"), displayName: "Sofa set", source: "manual" };
    const built = buildFinalBill([...spoken, custom], []);
    if (!built.ok) throw new Error(built.error);
    const bill: ReceiptBill = { receiptNumber: "59", customerName: "Ramesh", totalPaise: built.totalPaise, finalizedAt: "2026-10-04T12:45:00.000Z", createdAt: "2026-10-04T12:44:00.000Z" };
    return buildReceipt(bill, built.items, { ...shop, billLanguage });
  }
  const measure: Measure = (text, font) => [...text].length * font.size * 0.6;

  it("the receipt model: rows, rate and TOTAL", () => {
    const r = receipt();
    expect(r.total).toBe("₹1,26,520");
    expect(r.rows.map((x) => x.amount)).toEqual(["₹1,520", "₹1,25,000"]);
  });
  it("hi and both receipts group the same", () => {
    for (const l of ["hi", "both"] as const) expect(receipt(l).total, l).toBe("₹1,26,520");
  });
  it("the WhatsApp text", () => {
    const t = receiptText(receipt());
    expect(t).toContain("*TOTAL ₹1,26,520*");
    expect(t).toContain("₹1,25,000");
    expect(t).not.toMatch(/₹\d{4,}/);
  });
  it("the SMS text: 'Rs.1,26,520'", () => {
    const t = smsText(receipt());
    expect(t).toContain("TOTAL Rs.1,26,520");
    expect(t).toContain("Rs.1,25,000");
  });
  it("the share image and the PDF (the layout's drawing steps)", () => {
    const drawn = layoutReceipt(receipt(), measure, 384).ops.filter((o): o is DrawText => o.kind === "text").map((o) => o.text);
    expect(drawn).toContain("₹1,26,520");
    expect(drawn).toContain("₹1,25,000");
    expect(drawn.some((x) => /₹\d{4,}/.test(x))).toBe(false);
  });
  it("the screens' helpers: an amount, a rate, a price drift line", () => {
    expect(formatAmount(152000)).toBe("₹1,520");
    expect(formatRate({ rate: 152000, rateUnit: "kg", unit: "kg" })).toBe("₹1,520");
    expect(priceDriftText("Besan", "kg", 152000, 4, 140000)).toBe("Besan: ₹1,520 / kg on 4 bills (now ₹1,400)");
  });
  it("a flag's sentence", () => {
    const items = parseUtterance("2 kilo chini 1500 wala", SEED_PARSER_CATALOG)!;
    const said = evaluateReviewFlags("2 kilo chini 1500 wala", items, SEED_PARSER_CATALOG.entries).map((f) => f.message).join(" ");
    expect(said).toMatch(/₹1,500/);
    expect(said).not.toMatch(/₹\d{4,}/);
  });
});
