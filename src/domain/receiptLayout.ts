import { numberChunks, type Receipt } from "./receipt.js";

// KB-309 (owner, 4 Oct 2026): the receipt as drawing steps, for the share
// image (a canvas - ui/receiptImage.ts). The same D57 layout as Receipt.tsx,
// from the same buildReceipt, in CSS px at 1x (the canvas scales). Pure: the
// text measurer is injected, so it is tested without a browser.
// - a step never runs past the padding: names and labels wrap on spaces (a
//   word wider than its column breaks between graphemes); the number breaks
//   only after a hyphen (Q1 A); qty, rate and amount never wrap.

export const RECEIPT_PADDING = 16;

export interface FontSpec {
  readonly size: number;
  readonly weight: 400 | 600;
}
export type Measure = (text: string, font: FontSpec) => number;

export interface DrawText extends FontSpec {
  readonly kind: "text";
  readonly text: string;
  /** Top of the line box; x is the left, centre or right edge per align. */
  readonly x: number;
  readonly y: number;
  readonly align: "left" | "center" | "right";
  readonly muted: boolean;
  /** What the text is (tests, and the painter's colour). */
  readonly role: string;
}
export interface DrawRule {
  readonly kind: "rule";
  readonly y: number;
  readonly x1: number;
  readonly x2: number;
  readonly style: "dashed" | "dark" | "light";
}
export interface ReceiptLayout {
  readonly width: number;
  readonly height: number;
  readonly ops: readonly (DrawText | DrawRule)[];
}

// Receipt.tsx's sizes at its 14 px base (1.4em, 0.85em, 1.15em; leading-snug).
const BASE: FontSpec = { size: 14, weight: 400 };
const BOLD: FontSpec = { size: 14, weight: 600 };
const TITLE: FontSpec = { size: 19.6, weight: 600 };
const SMALL: FontSpec = { size: 11.9, weight: 400 };
const TOTAL: FontSpec = { size: 16.1, weight: 600 };
const LEADING = 1.375;
const TOP = 20;
const GAP = 8;

interface Token {
  readonly text: string;
  readonly font: FontSpec;
  readonly role: string;
}

// A base character with its combining marks (Devanagari matras, virama stay
// attached). ponytail: not full grapheme clusters - a conjunct (क्ष) can split
// after its virama; only reached by a single word wider than its column.
// Intl.Segmenter when the lib target reaches ES2022.
const graphemes = (s: string) => s.match(/\P{M}\p{M}*/gu) ?? [];
/** "a b c" -> ["a ", "b ", "c"]: a break is allowed after each space. */
const words = (s: string) => s.split(/(?<= )/).filter(Boolean);

/** Greedy line breaking; a token wider than `max` on its own is split between graphemes. */
function wrap(tokens: readonly Token[], max: number, measure: Measure): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  const width = (ts: readonly Token[]) => ts.reduce((w, t, i) => w + measure(i === ts.length - 1 ? t.text.trimEnd() : t.text, t.font), 0);
  for (const token of tokens) {
    if (line.length > 0 && width([...line, token]) > max) {
      lines.push(line);
      line = [];
    }
    if (width([token]) > max) {
      let piece = "";
      for (const g of graphemes(token.text)) {
        if (piece && measure((piece + g).trimEnd(), token.font) > max) {
          lines.push([{ ...token, text: piece }]);
          piece = "";
        }
        piece += g;
      }
      line = [{ ...token, text: piece }];
    } else {
      line.push(token);
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.map((l) => l.map((t, i) => (i === l.length - 1 ? { ...t, text: t.text.trimEnd() } : t)));
}

export function layoutReceipt(r: Receipt, measure: Measure, width = 384): ReceiptLayout {
  const P = RECEIPT_PADDING;
  const inner = width - 2 * P;
  const ops: (DrawText | DrawRule)[] = [];
  let y = TOP;

  const text = (t: string, x: number, font: FontSpec, align: DrawText["align"], role: string, muted = false) =>
    ops.push({ kind: "text", text: t, x, y, align, muted, role, ...font });
  const rule = (style: DrawRule["style"]) => ops.push({ kind: "rule", y, x1: P, x2: width - P, style });
  const lineHeight = (font: FontSpec, leading = LEADING) => font.size * leading;

  /** Wrapped lines, each drawn as runs of one role, starting at the left (or centred). */
  const paragraph = (tokens: Token[], align: "left" | "center", leading = LEADING, muted = false) => {
    for (const line of wrap(tokens, inner, measure)) {
      const runs: Token[] = [];
      for (const t of line) {
        const last = runs[runs.length - 1];
        if (last && last.role === t.role && last.font === t.font) runs[runs.length - 1] = { ...last, text: last.text + t.text };
        else runs.push(t);
      }
      const total = runs.reduce((w, t) => w + measure(t.text, t.font), 0);
      let x = align === "center" ? (width - total) / 2 : P;
      for (const run of runs) {
        if (align === "center" && runs.length === 1) text(run.text, width / 2, run.font, "center", run.role, muted);
        else text(run.text, x, run.font, "left", run.role, muted);
        x += measure(run.text, run.font);
      }
      y += Math.max(...line.map((t) => lineHeight(t.font, leading)));
    }
  };
  const plain = (s: string, font: FontSpec, role: string) => words(s).map((w): Token => ({ text: w, font, role }));
  const dashed = () => {
    y += GAP;
    rule("dashed");
    y += GAP;
  };

  // Header: name large and bold, then the small muted lines (D57).
  paragraph(plain(r.shopName.toUpperCase(), TITLE, "shop-name"), "center", 1.25);
  if (r.shopPhone) {
    y += 4;
    paragraph(plain(r.shopPhone, SMALL, "shop-phone"), "center", LEADING, true);
  }
  y += 4;
  paragraph(plain(r.dateTime, SMALL, "date-time"), "center", LEADING, true);
  dashed();

  // Bill No. <number> - the number breaks only after a hyphen.
  paragraph([...plain(`${r.billNoLabel} `, BASE, "bill-no-label"), ...numberChunks(r.receiptNumber).map((c): Token => ({ text: c, font: BOLD, role: "number" }))], "left");
  if (r.customer) paragraph(plain(`${r.customerLabel} ${r.customer}`, BASE, "customer"), "left");
  dashed();

  // The table: qty, rate and amount as wide as their widest cell (header words
  // may wrap), the item column takes the rest.
  const colWidth = (cells: readonly string[], header: string, font: FontSpec) =>
    Math.max(...cells.map((c) => measure(c, font)), ...words(header).map((w) => measure(w.trimEnd(), BOLD)));
  const qtyW = colWidth(r.rows.map((x) => x.qty), r.headers.qty, BASE);
  const rateW = colWidth(r.rows.map((x) => x.rate), r.headers.rate, BASE);
  const amtW = colWidth(r.rows.map((x) => x.amount), r.headers.amount, BOLD);
  const itemW = inner - qtyW - rateW - amtW - 3 * GAP;
  const qtyX = P + itemW + GAP;
  const rateRight = qtyX + qtyW + GAP + rateW;
  const amtRight = width - P;

  const cell = (s: string, colW: number, font: FontSpec) => wrap(plain(s, font, ""), colW, measure).map((l) => l.map((t) => t.text).join(""));
  const header = [
    { lines: cell(r.headers.item, itemW, BOLD), x: P, align: "left" as const },
    { lines: cell(r.headers.qty, qtyW, BOLD), x: qtyX, align: "left" as const },
    { lines: cell(r.headers.rate, rateW, BOLD), x: rateRight, align: "right" as const },
    { lines: cell(r.headers.amount, amtW, BOLD), x: amtRight, align: "right" as const },
  ];
  const top = y;
  for (const h of header) {
    y = top;
    for (const l of h.lines) {
      text(l, h.x, BOLD, h.align, "header");
      y += lineHeight(BOLD);
    }
  }
  y = top + Math.max(...header.map((h) => h.lines.length)) * lineHeight(BOLD) + 4;
  rule("dark");

  for (const row of r.rows) {
    const rowTop = y + 4;
    y = rowTop;
    const names = cell(row.name, itemW, BASE);
    for (const n of names) {
      text(n, P, BASE, "left", "item-name");
      y += lineHeight(BASE);
    }
    y = rowTop;
    text(row.qty, qtyX, BASE, "left", "qty");
    text(row.rate, rateRight, BASE, "right", "rate");
    text(row.amount, amtRight, BOLD, "right", "amount");
    y = rowTop + names.length * lineHeight(BASE) + 4;
    rule("light");
  }

  // TOTAL between dashed rules, larger and bold; then the thanks.
  rule("dashed");
  y += GAP;
  text(r.totalLabel, P, TOTAL, "left", "total-label");
  text(r.total, amtRight, TOTAL, "right", "total");
  y += lineHeight(TOTAL) + GAP;
  rule("dashed");
  y += 12;
  paragraph(plain(r.thanks, SMALL, "thanks"), "center", LEADING, true);

  return { width, height: Math.ceil(y + TOP), ops };
}
