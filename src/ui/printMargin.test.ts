import { describe, expect, it } from "vitest";
import { printProfile } from "@/domain/escpos";
import type { Receipt } from "@/domain/receipt";
import { layoutReceipt, type DrawText, type Measure } from "@/domain/receiptLayout";
import { DEV_PRINT_BILLS, WIDE_NUMBERS_BILL } from "./devPrintBills";
import { longTestReceipt, testReceipt } from "./PrinterSection";

// KB-408 (owner + reviewer, 14 Nov 2026): the 58 mm print had NO side margin - ink on dot 0 and dot 383. A printer whose printable
// width is a dot or two narrower, slightly offset, or weak on its edge dots would cut the first letter of a name and the last digit of
// an amount. We print on ANY ESC/POS 58 mm printer, so both papers keep a blank margin: 8 dots (1 mm) on 58 mm, 16 on 80 mm.
// Here: every drawing step of the layout stays inside the margins (a monospace measure, wider than real Devanagari). The same is
// checked on the real rendered pixels in eval/print/margin.test.ts.

const measure: Measure = (text, font) => [...text].length * font.size * 0.6;
const shop = { name: "Gupta Kirana Store", phone: "9876543210", billLanguage: "en" as const };
const at = new Date("2026-11-14T06:30:00.000Z");

const BILLS: readonly [string, Receipt][] = [
  ["the real Bill 514 (38 lines)", DEV_PRINT_BILLS.bill514],
  ["a 3-item bill", DEV_PRINT_BILLS.three],
  ["a REPRINT", { ...DEV_PRINT_BILLS.three, reprint: "REPRINT" }],
  ["the test print", testReceipt(shop, at)],
  ["the long test print (60 lines)", longTestReceipt(shop, at)],
  ["a 6-digit total with the widest qty and rate", WIDE_NUMBERS_BILL],
];

const left = (t: DrawText) => (t.align === "left" ? t.x : t.align === "right" ? t.x - measure(t.text, t) : t.x - measure(t.text, t) / 2);
const right = (t: DrawText) => left(t) + measure(t.text, t);

describe.each([
  [384, 8],
  [576, 16],
])("%i dots: a blank margin of %i dots on BOTH sides", (dots, margin) => {
  const profile = printProfile(dots);

  it("the profile's margin", () => {
    expect(profile.padding).toBe(margin);
  });

  it.each(BILLS)("%s: no text and no rule reaches into either margin; nothing overlaps on a row", (_name, receipt) => {
    const { ops } = layoutReceipt(receipt, measure, profile.dots, profile.padding, profile.style);
    const texts = ops.filter((o): o is DrawText => o.kind === "text");
    expect(texts.length).toBeGreaterThan(8);
    for (const t of texts) {
      expect(left(t), `left of "${t.text}"`).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(right(t), `right of "${t.text}"`).toBeLessThanOrEqual(dots - margin + 1e-6);
    }
    for (const r of ops.filter((o) => o.kind === "rule")) {
      expect(r.x1).toBeGreaterThanOrEqual(margin);
      expect(r.x2).toBeLessThanOrEqual(dots - margin);
    }
    // texts sharing a line never overlap
    const lines = new Map<number, DrawText[]>();
    for (const t of texts) lines.set(t.y, [...(lines.get(t.y) ?? []), t]);
    for (const line of lines.values()) {
      const sorted = [...line].sort((a, b) => left(a) - left(b));
      for (let i = 1; i < sorted.length; i++) expect(left(sorted[i]!), `"${sorted[i - 1]!.text}" | "${sorted[i]!.text}"`).toBeGreaterThanOrEqual(right(sorted[i - 1]!) - 1e-6);
    }
  });
});

describe("58 mm with the margin: ordinary bills keep the table", () => {
  it("Bill 514's numbers leave the names their column (no stacked rows on a normal bill)", () => {
    const p = printProfile(384);
    const texts = layoutReceipt(DEV_PRINT_BILLS.bill514, measure, p.dots, p.padding, p.style).ops.filter((o): o is DrawText => o.kind === "text");
    const firstName = texts.find((t) => t.role === "item-name")!;
    const firstQty = texts.find((t) => t.role === "qty")!;
    expect(Math.abs(firstQty.y - firstName.y)).toBeLessThan(10); // the numbers sit on the name's own line
  });
});
