import { numberChunks, type Receipt } from "./receipt.js";

// KB-309 (owner, 4 Oct 2026): the receipt as drawing steps, for the share
// image (a canvas - ui/receiptImage.ts). The same D57 layout as Receipt.tsx,
// from the same buildReceipt, in CSS px at 1x (the canvas scales). Pure: the
// text measurer is injected, so it is tested without a browser.
// - a step never runs past the padding: names and labels wrap on spaces (a
//   word wider than its column breaks between graphemes); the number breaks
//   only after a hyphen (Q1 A); qty, rate and amount never wrap.
// KB-408 (owner's S6, 14 Nov 2026): the PRINTED bill uses the same steps with its own ReceiptStyle, in the printer's dots.

export const RECEIPT_PADDING = 16;

export interface FontSpec {
  readonly size: number;
  readonly weight: 400 | 600 | 700;
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

/** Sizes, weights and spacing of one rendering of the receipt - the content and its order never depend on it. */
export interface ReceiptStyle {
  readonly title: FontSpec;
  /** Phone, date, "Replaces", thanks. */
  readonly small: FontSpec;
  /** "Bill No.", the customer line. */
  readonly label: FontSpec;
  readonly number: FontSpec;
  readonly header: FontSpec;
  readonly name: FontSpec;
  /** Qty and rate. */
  readonly cell: FontSpec;
  readonly amount: FontSpec;
  /** TOTAL, CANCELLED, REPRINT. */
  readonly total: FontSpec;
  readonly leading: number;
  /** The shop name's own line spacing. */
  readonly titleLeading: number;
  readonly top: number;
  /** Around the dashed rules. */
  readonly gap: number;
  /** Between two table columns - at least this much between Qty, Rate and Amt on every row. */
  readonly colGap: number;
  /** Above and below a row's text; under the header. */
  readonly rowPad: number;
  readonly afterTotal: number;
  /**
   * The narrowest the item column may get. Narrower (58 mm paper with long numbers): each name takes its own full-width line and the
   * numbers go on the line below, so nothing overlaps or is cut. 0 = never (the screen).
   */
  readonly minItem: number;
  /** Whole-unit positions and line heights (the printer's dots); the screen keeps fractions. */
  readonly snap: boolean;
}

// Receipt.tsx's sizes at its 14 px base (1.4em, 0.85em, 1.15em; leading-snug).
const BASE: FontSpec = { size: 14, weight: 400 };
const BOLD: FontSpec = { size: 14, weight: 600 };
export const SCREEN_STYLE: ReceiptStyle = {
  title: { size: 19.6, weight: 600 },
  small: { size: 11.9, weight: 400 },
  label: BASE,
  number: BOLD,
  header: BOLD,
  name: BASE,
  cell: BASE,
  amount: BOLD,
  total: { size: 16.1, weight: 600 },
  leading: 1.375,
  titleLeading: 1.25,
  top: 20,
  gap: 8,
  colGap: 8,
  rowPad: 4,
  afterTotal: 12,
  minItem: 0,
  snap: false,
};

/**
 * KB-408 fix 2 (owner's S6, 14 Nov 2026): the printed bill, in printer dots. Thin 1-dot strokes print faint or broken on thermal
 * paper, so nothing is lighter than semi-bold; amounts, headers and TOTAL are bold. Numbers and labels are IBM Plex Mono at sizes
 * whose character width (0.6 em) is a whole number of dots - 20 -> 12 dots, 25 -> 15, 30 -> 18 - so every character lands on the dot
 * grid the same way (sharp, never fuzzy). 20 dots = 48 characters across 80 mm (576 dots), 32 across 58 mm (384).
 * "wide" (80 mm) gives names more size and columns more air; "narrow" (58 mm) keeps the table inside 384 dots.
 */
export function printStyle(paper: "wide" | "narrow"): ReceiptStyle {
  const semi = (size: number): FontSpec => ({ size, weight: 600 });
  const bold = (size: number): FontSpec => ({ size, weight: 700 });
  return {
    title: bold(30),
    small: semi(20),
    label: semi(20),
    number: bold(20),
    header: bold(20),
    name: semi(paper === "wide" ? 26 : 22),
    cell: semi(20),
    amount: bold(20),
    total: bold(25),
    leading: 1.3,
    titleLeading: 1.3,
    top: 16,
    gap: 12,
    colGap: paper === "wide" ? 24 : 12,
    rowPad: 6,
    afterTotal: 16,
    minItem: 96,
    snap: true,
  };
}

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

export function layoutReceipt(r: Receipt, measure: Measure, width = 384, padding = RECEIPT_PADDING, style: ReceiptStyle = SCREEN_STYLE): ReceiptLayout {
  const P = padding;
  const S = style;
  const inner = width - 2 * P;
  const ops: (DrawText | DrawRule)[] = [];
  let y = S.top;

  /** A whole dot when printing; as it is on the screen. */
  const at = (v: number) => (S.snap ? Math.round(v) : v);
  const text = (t: string, x: number, font: FontSpec, align: DrawText["align"], role: string, muted = false) =>
    ops.push({ kind: "text", text: t, x: at(x), y: at(y), align, muted, role, ...font });
  const rule = (kind: DrawRule["style"]) => ops.push({ kind: "rule", y: at(y), x1: P, x2: width - P, style: kind });
  const lineHeight = (font: FontSpec, leading = S.leading) => (S.snap ? Math.ceil(font.size * leading) : font.size * leading);

  /** Wrapped lines, each drawn as runs of one role, starting at the left (or centred). */
  const paragraph = (tokens: Token[], align: "left" | "center", leading = S.leading, muted = false) => {
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
    y += S.gap;
    rule("dashed");
    y += S.gap;
  };

  // Header: name large and bold, then the small muted lines (D57).
  paragraph(plain(r.shopName.toUpperCase(), S.title, "shop-name"), "center", S.titleLeading);
  if (r.shopPhone) {
    y += S.rowPad;
    paragraph(plain(r.shopPhone, S.small, "shop-phone"), "center", S.leading, true);
  }
  y += S.rowPad;
  paragraph(plain(r.dateTime, S.small, "date-time"), "center", S.leading, true);
  // KB-325 (D79): a cancelled bill is marked on the image / PDF too - never shared as if it were valid.
  if (r.cancelled) {
    y += S.gap;
    paragraph(plain(r.cancelled, S.total, "cancelled"), "center", S.leading);
  }
  if (r.reprint) {
    y += S.gap;
    paragraph(plain(r.reprint, S.total, "reprint"), "center", S.leading);
  }
  dashed();

  // Bill No. <number> - the number breaks only after a hyphen.
  paragraph([...plain(`${r.billNoLabel} `, S.label, "bill-no-label"), ...numberChunks(r.receiptNumber).map((c): Token => ({ text: c, font: S.number, role: "number" }))], "left");
  if (r.replaces) paragraph(plain(r.replaces, S.small, "replaces"), "left", S.leading, true);
  if (r.customer) paragraph(plain(`${r.customerLabel} ${r.customer}`, S.label, "customer"), "left");
  dashed();

  // The table: qty, rate and amount as wide as their widest cell (header words
  // may wrap), the item column takes the rest. S.colGap between columns, so two cells never touch.
  const colWidth = (cells: readonly string[], header: string, font: FontSpec) =>
    Math.max(...cells.map((c) => measure(c, font)), ...words(header).map((w) => measure(w.trimEnd(), S.header)));
  const qtyW = colWidth(r.rows.map((x) => x.qty), r.headers.qty, S.cell);
  const rateW = colWidth(r.rows.map((x) => x.rate), r.headers.rate, S.cell);
  const amtW = colWidth(r.rows.map((x) => x.amount), r.headers.amount, S.amount);
  const tableItemW = inner - qtyW - rateW - amtW - 3 * S.colGap;
  // KB-408: no room left for names -> each name on its own full-width line, the numbers on the line below (never an overlap, never a cut)
  const stacked = S.minItem > 0 && tableItemW < S.minItem;
  const itemW = stacked ? inner : tableItemW;
  const amtRight = width - P;
  const qtyX = stacked ? P : amtRight - amtW - S.colGap - rateW - S.colGap - qtyW;
  // Stacked, the three numbers share one line when they fit; else Qty + Rate, then Amt; else one each. Never an overlap.
  const oneLine = !stacked || qtyW + rateW + amtW + 2 * S.colGap <= inner;
  const twoLines = !oneLine && qtyW + S.colGap + rateW <= inner;
  const rateRight = oneLine ? amtRight - amtW - S.colGap : amtRight;
  const rateLine = oneLine || twoLines ? 0 : 1;
  const amtLine = oneLine ? 0 : rateLine + 1;

  const cell = (s: string, colW: number, font: FontSpec) => wrap(plain(s, font, ""), colW, measure).map((l) => l.map((t) => t.text).join(""));
  const itemHeader = cell(r.headers.item, itemW, S.header);
  const numberHeaders = [
    { lines: cell(r.headers.qty, qtyW, S.header), x: qtyX, align: "left" as const, line: 0 },
    { lines: cell(r.headers.rate, rateW, S.header), x: rateRight, align: "right" as const, line: rateLine },
    { lines: cell(r.headers.amount, amtW, S.header), x: amtRight, align: "right" as const, line: amtLine },
  ];
  const headerTop = y;
  for (const l of itemHeader) {
    text(l, P, S.header, "left", "header");
    y += lineHeight(S.header);
  }
  // In the table the number headers share the item header's line; stacked, they go on the line below it.
  const numbersTop = stacked ? y : headerTop;
  for (const h of numberHeaders) {
    y = numbersTop + h.line * lineHeight(S.header);
    for (const l of h.lines) {
      text(l, h.x, S.header, h.align, "header");
      y += lineHeight(S.header);
    }
  }
  const headerLines = Math.max(...numberHeaders.map((h) => h.line + h.lines.length), stacked ? 0 : itemHeader.length);
  y = numbersTop + headerLines * lineHeight(S.header) + S.rowPad;
  rule("dark");

  for (const row of r.rows) {
    const rowTop = y + S.rowPad;
    y = rowTop;
    const names = cell(row.name, itemW, S.name);
    for (const n of names) {
      text(n, P, S.name, "left", "item-name");
      y += lineHeight(S.name);
    }
    const namesBottom = y;
    // In a table row the numbers sit on the first name line, centred in its (taller) line box; stacked, on their own line below.
    const numbersY = stacked ? namesBottom : rowTop + (lineHeight(S.name) - lineHeight(S.cell)) / 2;
    y = numbersY;
    text(row.qty, qtyX, S.cell, "left", "qty");
    y = numbersY + rateLine * lineHeight(S.cell);
    text(row.rate, rateRight, S.cell, "right", "rate");
    y = numbersY + amtLine * lineHeight(S.cell);
    text(row.amount, amtRight, S.amount, "right", "amount");
    y = (stacked ? namesBottom + (amtLine + 1) * lineHeight(S.cell) : namesBottom) + S.rowPad;
    rule("light");
  }

  // TOTAL between dashed rules, larger and bold; then the thanks.
  rule("dashed");
  y += S.gap;
  text(r.totalLabel, P, S.total, "left", "total-label");
  text(r.total, amtRight, S.total, "right", "total");
  y += lineHeight(S.total) + S.gap;
  rule("dashed");
  y += S.afterTotal;
  paragraph(plain(r.thanks, S.small, "thanks"), "center", S.leading, true);

  return { width, height: Math.ceil(y + S.top), ops };
}
