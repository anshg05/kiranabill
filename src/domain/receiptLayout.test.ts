import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { customItem, editAmount } from "./billEdit";
import { buildReceipt, type ReceiptBill, type ReceiptShop } from "./receipt";
import { layoutReceipt, RECEIPT_PADDING, type DrawText, type Measure } from "./receiptLayout";

// KB-309 (owner, 4 Oct 2026): the receipt as drawing steps for the share image
// (a canvas) - the D57 layout of Receipt.tsx, from the same buildReceipt. Pure:
// the text measurer is injected; here a monospace stub (0.6 em per code point).

const measure: Measure = (text, font) => [...text].length * font.size * 0.6;
const LONG = "बासमती चावल प्रीमियम पुराना लंबा दाना";
const FALLBACK = "KB-e62b8260-8f83-4472-adb9-b76bbb58e260-3";

const shop: ReceiptShop = { name: "Sharma Kirana", phone: "9876543210", logoUrl: null, billLanguage: "en" };
const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};

function receipt(over: Partial<ReceiptBill> = {}, shopOver: Partial<ReceiptShop> = {}) {
  const spoken: FinalLine[] = ["2 kilo chini", "500 gram chini", "chini 30 rupay"].flatMap((t, u) =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
      id: `l${u}-${i}`, utteranceId: u, item, original: item,
      displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
    })),
  );
  const custom: FinalLine = { id: "c", utteranceId: 9, item: ok(editAmount(customItem(LONG), "240")), original: customItem(LONG), displayName: LONG, source: "manual" };
  const built = buildFinalBill([...spoken, custom], []);
  if (!built.ok) throw new Error(built.error);
  const bill: ReceiptBill = { receiptNumber: FALLBACK, customerName: "Ramesh", totalPaise: built.totalPaise, finalizedAt: "2026-10-04T12:45:00.000Z", createdAt: "2026-10-04T12:44:00.000Z", ...over };
  return buildReceipt(bill, built.items, { ...shop, ...shopOver });
}

const texts = (ops: readonly { kind: string }[]) => ops.filter((o): o is DrawText => o.kind === "text");
const left = (t: DrawText) => (t.align === "left" ? t.x : t.align === "right" ? t.x - measure(t.text, t) : t.x - measure(t.text, t) / 2);
const right = (t: DrawText) => left(t) + measure(t.text, t);

describe("layoutReceipt - the share image's drawing steps (D57 layout)", () => {
  for (const width of [384, 288]) {
    it(`width ${width}: every text step stays inside the padding - nothing drawn past the edge`, () => {
      const layout = layoutReceipt(receipt(), measure, width);
      expect(layout.width).toBe(width);
      expect(texts(layout.ops).length).toBeGreaterThan(20); // never vacuous
      for (const t of texts(layout.ops)) {
        expect(left(t), t.text).toBeGreaterThanOrEqual(RECEIPT_PADDING - 0.01);
        expect(right(t), t.text).toBeLessThanOrEqual(width - RECEIPT_PADDING + 0.01);
      }
      expect(Math.max(...layout.ops.map((o) => ("y" in o ? o.y : 0)))).toBeLessThanOrEqual(layout.height);
    });
  }

  it("every value is drawn: shop name (upper case, bold), phone, date | time, labels, rows, total, thanks", () => {
    const r = receipt();
    const all = texts(layoutReceipt(r, measure, 384).ops).map((t) => t.text).join("\n");
    for (const v of ["SHARMA KIRANA", "98765 43210", r.dateTime, "Bill No.", "Customer: Ramesh", "Item", "Qty", "Rate", "Amt", "2 kg", "₹45", "₹90", "500 gm", "₹45/kg", "₹22.50", "₹30", "₹240", "TOTAL", "₹382.50", "Thank You!"]) {
      expect(all, v).toContain(v);
    }
    const name = texts(layoutReceipt(r, measure, 384).ops).find((t) => t.text === "SHARMA KIRANA")!;
    expect([name.align, name.weight]).toEqual(["center", 600]);
  });

  it("the long Hindi name wraps inside its column, on word boundaries, and joins back exactly", () => {
    const layout = layoutReceipt(receipt(), measure, 288);
    const nameLines = texts(layout.ops).filter((t) => t.role === "item-name" && LONG.includes(t.text));
    expect(nameLines.length).toBeGreaterThan(1);
    expect(nameLines.map((t) => t.text).join(" ")).toBe(LONG);
    const qtyX = Math.min(...texts(layout.ops).filter((t) => t.role === "qty").map(left));
    for (const t of nameLines) expect(right(t)).toBeLessThanOrEqual(qtyX);
  });

  it("the fallback number breaks only after a hyphen and joins back to the exact string", () => {
    const layout = layoutReceipt(receipt(), measure, 288);
    const parts = texts(layout.ops).filter((t) => t.role === "number");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((t) => t.text).join("")).toBe(FALLBACK);
    for (const p of parts.slice(0, -1)) expect(p.text.endsWith("-")).toBe(true);
  });

  it("columns: qty left, rate and amount right-aligned in order; amount bold", () => {
    const ops = texts(layoutReceipt(receipt(), measure, 384).ops);
    const row = (role: string) => ops.filter((t) => t.role === role);
    expect([row("qty").length, row("rate").length, row("amount").length]).toEqual([4, 4, 4]);
    expect(row("qty").every((t) => t.align === "left")).toBe(true);
    expect(row("rate").every((t) => t.align === "right")).toBe(true);
    expect(row("amount").every((t) => t.align === "right" && t.weight === 600)).toBe(true);
    expect(Math.max(...row("qty").map(right))).toBeLessThan(Math.min(...row("rate").map(left)));
    expect(Math.max(...row("rate").map(right))).toBeLessThan(Math.min(...row("amount").map(left)));
  });

  it("rules: dashed between sections, a dark rule under the header, a light rule under each item", () => {
    const rules = layoutReceipt(receipt(), measure, 384).ops.filter((o) => o.kind === "rule");
    expect(rules.filter((r) => "style" in r && r.style === "dark")).toHaveLength(1);
    expect(rules.filter((r) => "style" in r && r.style === "light")).toHaveLength(4);
    expect(rules.filter((r) => "style" in r && r.style === "dashed").length).toBeGreaterThanOrEqual(4);
  });

  it("Cash: no customer line; the customer's mobile is in no step (it isn't an input)", () => {
    expect(texts(layoutReceipt(receipt(), measure, 384).ops).some((t) => t.text === "Customer: Ramesh")).toBe(true);
    const cash = layoutReceipt(receipt({ customerName: "Cash" }), measure, 384);
    expect(texts(cash.ops).some((t) => t.text.includes("Customer") || t.text.includes("Cash"))).toBe(false);
    const withMobile = layoutReceipt(receipt({ customerMobile: "9123456789" } as Partial<ReceiptBill>), measure, 384);
    expect(JSON.stringify(withMobile)).not.toContain("9123456789");
  });

  it("hi: Hindi labels and units are drawn", () => {
    const all = texts(layoutReceipt(receipt({}, { billLanguage: "hi" }), measure, 384).ops).map((t) => t.text).join("\n");
    for (const v of ["बिल नं.", "ग्राहक: Ramesh", "सामान", "रकम", "2 किलो", "₹45/किलो", "कुल", "धन्यवाद!"]) expect(all, v).toContain(v);
  });
});
