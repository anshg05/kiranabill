import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { customItem, editAmount } from "./billEdit";
import { buildReceipt, UNKNOWN_CELL, type Receipt, type ReceiptBill, type ReceiptShop } from "./receipt";
import { layoutReceipt, printStyle, RECEIPT_PADDING, SCREEN_STYLE, type DrawText, type Measure } from "./receiptLayout";

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

// KB-408 (owner, D110 item 8.10): any bill can be reprinted any time; the printed copy carries a "REPRINT" line, so it can never pass
// as a second, separate sale. The screen's receipt never shows it.
describe("layoutReceipt - a reprint", () => {
  it("draws REPRINT once, centred and bold under the date, before the bill number; nothing else moves out of order", () => {
    const r = { ...receipt(), reprint: "REPRINT" };
    const t = texts(layoutReceipt(r, measure).ops);
    const reprint = t.filter((x) => x.role === "reprint");
    expect(reprint).toHaveLength(1);
    expect(reprint[0]).toMatchObject({ text: "REPRINT", align: "center", weight: 600 });
    const at = (role: string) => t.findIndex((x) => x.role === role);
    expect(at("date-time")).toBeLessThan(at("reprint"));
    expect(at("reprint")).toBeLessThan(at("bill-no-label"));
    expect(t.filter((x) => x.role !== "reprint").map((x) => x.text)).toEqual(texts(layoutReceipt(receipt(), measure).ops).map((x) => x.text));
  });

  it("an ordinary receipt (no reprint, or null) has no REPRINT line", () => {
    expect(texts(layoutReceipt(receipt(), measure).ops).some((x) => x.role === "reprint")).toBe(false);
    expect(texts(layoutReceipt({ ...receipt(), reprint: null }, measure).ops).some((x) => x.role === "reprint")).toBe(false);
  });

  it("a cancelled bill's reprint shows both lines", () => {
    const t = texts(layoutReceipt({ ...receipt({ status: "cancelled" }), reprint: "REPRINT" }, measure).ops).map((x) => x.role);
    expect(t).toContain("cancelled");
    expect(t).toContain("reprint");
  });
});

// KB-408 S3: the printer's paper width - the same layout with its own padding (printProfile in escpos.ts).
describe("layoutReceipt - padding", () => {
  it("defaults to RECEIPT_PADDING; a narrower padding moves every edge and keeps everything inside", () => {
    const narrow = layoutReceipt(receipt(), measure, 279, 4);
    const t = texts(narrow.ops);
    expect(Math.min(...t.map(left))).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(Math.max(...t.map(right))).toBeLessThanOrEqual(279 - 4 + 1e-9);
    expect(Math.min(...t.map(left))).toBeLessThan(RECEIPT_PADDING);
    expect(layoutReceipt(receipt(), measure, 384, RECEIPT_PADDING)).toEqual(layoutReceipt(receipt(), measure));
  });
});

// KB-408 fix 2 (owner's S6, 14 Nov 2026): the PRINTED bill is laid out in the printer's own dots - nothing is scaled, every position is
// a whole dot, text is semi-bold or bolder (a 1-dot stroke prints faint), and the columns keep a guaranteed gap. The content and the
// table are today's bill exactly; the screen and the share image keep SCREEN_STYLE, untouched.
describe("layoutReceipt - the print style (whole dots)", () => {
  const P80 = printStyle("wide");
  const P58 = printStyle("narrow");
  const rows514 = (): Receipt => ({
    ...receipt({ customerName: "Cash" }),
    rows: [
      { name: "सौंफ", qty: "50 gm", rate: "₹500/kg", amount: "₹25" },
      { name: "एक्सपर्ट बार साबुन", qty: "12 pc", rate: UNKNOWN_CELL, amount: "₹55" },
      { name: "बासमती चावल प्रीमियम पुराना लंबा दाना", qty: "0.25 kg", rate: "₹1,250/kg", amount: "₹2,216" },
      { name: "दही", qty: UNKNOWN_CELL, rate: UNKNOWN_CELL, amount: "₹40" },
    ],
  });
  const lay = (dots: number, pad: number, style = dots >= 512 ? P80 : P58, r: Receipt = rows514()) => layoutReceipt(r, measure, dots, pad, style);

  it.each([[576, 16], [384, 0]])("%i dots: every position and the height are whole dots", (dots, pad) => {
    const l = lay(dots, pad);
    expect(Number.isInteger(l.height)).toBe(true);
    for (const op of l.ops) {
      if (op.kind === "text") expect([op.x, op.y].every(Number.isInteger), `${op.role} ${op.text}`).toBe(true);
      else expect([op.x1, op.x2, op.y].every(Number.isInteger)).toBe(true);
    }
  });

  it("weights: names, qty and rate semi-bold; amount, header, number, shop name, REPRINT and TOTAL bold; nothing lighter than semi-bold", () => {
    const t = texts(lay(576, 16, P80, { ...rows514(), reprint: "REPRINT" }).ops);
    const w = (role: string) => [...new Set(t.filter((x) => x.role === role).map((x) => x.weight))];
    for (const role of ["item-name", "qty", "rate", "date-time", "thanks", "bill-no-label"]) expect(w(role), role).toEqual([600]);
    for (const role of ["amount", "header", "number", "shop-name", "reprint", "total", "total-label"]) expect(w(role), role).toEqual([700]);
    expect(Math.min(...t.map((x) => x.weight))).toBe(600);
  });

  it("names are a little bigger than the numbers - more so on 80 mm, which has the room", () => {
    const size = (style: typeof P80, role: string) => texts(lay(576, 16, style).ops).find((x) => x.role === role)!.size;
    expect(size(P80, "item-name")).toBeGreaterThan(size(P80, "qty"));
    expect(size(P58, "item-name")).toBeGreaterThan(size(P58, "qty"));
    expect(size(P80, "item-name")).toBeGreaterThan(size(P58, "item-name"));
    expect(size(P80, "qty")).toBe(size(P58, "qty")); // the same crisp number size on both papers
  });

  it("monospace text sits on the dot grid: every number / label size gives a whole-dot character width (0.6 em)", () => {
    for (const style of [P80, P58])
      for (const f of [style.title, style.small, style.label, style.number, style.header, style.cell, style.amount, style.total]) expect(Number.isInteger(Math.round(f.size * 0.6 * 1e6) / 1e6), `${f.size}`).toBe(true);
  });

  it.each([[576, 16], [384, 0]])("%i dots: Qty, Rate and Amt never touch - at least the column gap between them on every row ('₹500/kg' and '₹25')", (dots, pad) => {
    const style = dots >= 512 ? P80 : P58;
    const l = lay(dots, pad);
    const t = texts(l.ops);
    const rowsY = [...new Set(t.filter((x) => x.role === "amount").map((x) => x.y))];
    expect(rowsY).toHaveLength(4);
    for (const y of rowsY) {
      const at = (role: string) => t.find((x) => x.role === role && x.y === y)!;
      expect(right(at("qty")) + style.colGap).toBeLessThanOrEqual(left(at("rate")) + 1e-6);
      expect(right(at("rate")) + style.colGap).toBeLessThanOrEqual(left(at("amount")) + 1e-6);
    }
    expect(style.colGap).toBeGreaterThanOrEqual(12); // one whole character at least
  });

  it.each([[576, 16], [384, 0]])("%i dots: nothing is cut - every text stays inside the paper, long names wrap and join back whole", (dots, pad) => {
    const l = lay(dots, pad);
    const t = texts(l.ops);
    expect(Math.min(...t.map(left))).toBeGreaterThanOrEqual(pad - 1e-6);
    expect(Math.max(...t.map(right))).toBeLessThanOrEqual(dots - pad + 1e-6);
    const names = t.filter((x) => x.role === "item-name").map((x) => x.text).join(" ");
    for (const row of rows514().rows) for (const word of row.name.split(" ")) expect(names).toContain(word);
  });

  it("58 mm table: a name never runs under the numbers (the item column ends before Qty starts)", () => {
    const usual: Receipt = { ...rows514(), rows: rows514().rows.filter((x) => x.rate !== "₹1,250/kg") };
    const t = texts(lay(384, 0, P58, usual).ops);
    const qtyLeft = Math.min(...t.filter((x) => x.role === "qty").map(left));
    expect(Math.max(...t.filter((x) => x.role === "item-name").map(right)) + P58.colGap).toBeLessThanOrEqual(qtyLeft + 1e-6);
  });

  it("when the numbers leave no room for names (58 mm, a very long rate): each name gets its own full-width line and the numbers go on the line below - still no overlap, nothing cut", () => {
    const wide: Receipt = { ...rows514(), rows: [{ name: "काजू कतली मिठाई डिब्बा", qty: "12 packet", rate: "₹1,250/packet", amount: "₹15,000" }] };
    const t = texts(lay(384, 0, P58, wide).ops);
    const name = t.filter((x) => x.role === "item-name");
    const qty = t.find((x) => x.role === "qty")!;
    const rate = t.find((x) => x.role === "rate")!;
    const amount = t.find((x) => x.role === "amount")!;
    expect(Math.max(...name.map((x) => x.y))).toBeLessThan(qty.y); // numbers below the name
    expect([qty.y, rate.y, amount.y].every((y) => y === qty.y)).toBe(true);
    expect(right(qty) + P58.colGap).toBeLessThanOrEqual(left(rate) + 1e-6);
    expect(right(rate) + P58.colGap).toBeLessThanOrEqual(left(amount) + 1e-6);
    expect(left(qty)).toBeGreaterThanOrEqual(0);
    expect(right(amount)).toBeLessThanOrEqual(384);
    expect(name.map((x) => x.text).join(" ")).toBe("काजू कतली मिठाई डिब्बा");
  });

  it("numbers too wide even for one line (absurd, but never an overlap): Qty and Rate share a line, Amt goes below; all inside the paper", () => {
    const huge: Receipt = { ...rows514(), rows: [{ name: "काजू कतली", qty: "12 packet", rate: "₹12,500/packet", amount: "₹1,50,000" }] };
    const t = texts(lay(384, 0, P58, huge).ops);
    const [qty, rate, amount] = ["qty", "rate", "amount"].map((role) => t.find((x) => x.role === role)!);
    expect(qty!.y).toBe(rate!.y);
    expect(amount!.y).toBeGreaterThan(rate!.y);
    expect(right(qty!) + P58.colGap).toBeLessThanOrEqual(left(rate!) + 1e-6);
    for (const x of [qty!, rate!, amount!]) {
      expect(left(x)).toBeGreaterThanOrEqual(0);
      expect(right(x)).toBeLessThanOrEqual(384);
    }
    const ys = t.map((x) => x.y);
    expect(Math.max(...ys.slice(0, ys.indexOf(amount!.y) + 1))).toBe(amount!.y); // nothing drawn above is below it: lines keep their order
  });

  it("the same content, in the same order, as the screen's receipt (only size, weight, position and line breaks differ)", () => {
    const content = (ops: readonly { kind: string }[]) => texts(ops).map((x) => x.text).join("").replace(/\s+/g, "");
    expect(content(lay(576, 16).ops)).toBe(content(layoutReceipt(rows514(), measure).ops));
    expect(content(lay(384, 0).ops)).toBe(content(layoutReceipt(rows514(), measure).ops));
  });

  it("the screen and the share image are untouched: the default style is SCREEN_STYLE", () => {
    expect(layoutReceipt(rows514(), measure, 384, RECEIPT_PADDING, SCREEN_STYLE)).toEqual(layoutReceipt(rows514(), measure));
    expect(SCREEN_STYLE.snap).toBe(false);
  });

  it("SCREEN_STYLE is today's receipt, value for value (Receipt.tsx's sizes at 14 px) - printing changes must never move the screen or the share image", () => {
    const base = { size: 14, weight: 400 };
    const bold = { size: 14, weight: 600 };
    expect(SCREEN_STYLE).toEqual({
      title: { size: 19.6, weight: 600 }, small: { size: 11.9, weight: 400 }, label: base, number: bold, header: bold, name: base, cell: base, amount: bold,
      total: { size: 16.1, weight: 600 }, leading: 1.375, titleLeading: 1.25, top: 20, gap: 8, colGap: 8, rowPad: 4, afterTotal: 12, minItem: 0, snap: false,
    });
  });
});
