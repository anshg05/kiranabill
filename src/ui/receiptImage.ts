import type { Receipt } from "@/domain/receipt";
import { layoutReceipt, type FontSpec, type ReceiptLayout } from "@/domain/receiptLayout";
import { jpegPdf } from "./onePagePdf";
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-309: the receipt as a PNG (2x: 768 px wide, Q4) and the same pixels as a
// one-page PDF (JPEG inside, 58 mm wide). Drawn with fillText from
// layoutReceipt's steps - no HTML anywhere (hard rule 9). Browser only
// (canvas); checked in a real browser, the layout itself is unit-tested.
// KB-408 S3: the printer's image (receiptPrint.ts) is painted by the same paintReceipt.

// KB-413 step 4: laid out at 13's 320 px paper, painted at 2.4x - the same 768 px wide image as before (Q4)
const WIDTH = 320;
const SCALE = 2.4;
const FAMILY = `"IBM Plex Mono", Mukta, monospace`;
export const cssFont = (f: FontSpec) => `${f.weight} ${f.size}px ${FAMILY}`;

/** Owner: Plex and Mukta are split by unicode-range and a canvas doesn't
 * trigger those subsets - load every face/weight with the receipt's ACTUAL
 * strings first, or the first image after a reload draws in a fallback. */
export async function loadFonts(receipt: Receipt, weights: readonly number[] = [400, 600]): Promise<void> {
  const r = receipt;
  const strings = [r.shopName.toUpperCase(), r.shopPhone ?? "", r.dateTime, r.billNoLabel, r.receiptNumber, r.customerLabel, r.customer ?? "",
    ...Object.values(r.headers), ...r.rows.flatMap((x) => [x.name, x.qty, x.rate, x.amount]), r.totalLabel, r.total, r.thanks, r.cancelled ?? "", r.replaces ?? "", r.reprint ?? ""];
  const sample = [...new Set(strings.join(""))].join("");
  await Promise.all(weights.flatMap((w) => [`${w} 14px "IBM Plex Mono"`, `${w} 14px Mukta`].map((font) => document.fonts.load(font, sample))));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`toBlob ${type} failed`))), type, quality));
}

export interface ReceiptPalette {
  readonly ink: string;
  readonly inkSoft: string;
  readonly line: string;
  readonly muted: string;
  /** Dash pattern of the light rule under each row; null = solid. */
  readonly lightDash: readonly number[] | null;
  readonly dash: readonly number[];
  /** Line widths: dashed, the dark header rule, the light row rule. */
  readonly widths: { readonly dashed: number; readonly dark: number; readonly light: number };
  /** 13's darker grey (KB-413 step 4): qty, rate and the rule under the header. None (the printer) = ink / inkSoft, as before. */
  readonly strong?: string;
  /** Whole-dot painting (the printer): text and rules sit exactly on the dot grid. */
  readonly snap: boolean;
  readonly border: boolean;
}

/** Paints a layout on a context already scaled to layout px. */
export function paintReceipt(ctx: CanvasRenderingContext2D, layout: ReceiptLayout, p: ReceiptPalette): void {
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, layout.width, layout.height);
  if (p.border) {
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, layout.width - 1, layout.height - 1);
  }
  ctx.textBaseline = "top";
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = cssFont(op);
      ctx.letterSpacing = `${op.tracking ?? 0}px`;
      ctx.fillStyle = op.muted ? p.inkSoft : p.strong && (op.role === "qty" || op.role === "rate") ? p.strong : p.ink;
      ctx.textAlign = op.align;
      // The glyph sits in the middle of its line box, as in CSS (leading-snug).
      ctx.fillText(op.text, op.x, p.snap ? op.y + Math.round(op.size * 0.1875) : op.y + op.size * 0.1875);
    } else {
      ctx.beginPath();
      ctx.setLineDash(op.style === "dashed" ? [...p.dash] : op.style === "light" && p.lightDash ? [...p.lightDash] : []);
      ctx.strokeStyle = op.style === "dashed" ? p.muted : op.style === "dark" ? (p.strong ?? p.inkSoft) : p.line;
      ctx.lineWidth = p.widths[op.style];
      // an odd whole width is centred on a half dot, an even one on a whole dot: the line covers whole dots exactly
      const y = p.snap ? op.y + (p.widths[op.style] % 2) / 2 : op.y + 0.5;
      ctx.moveTo(op.x1, y);
      ctx.lineTo(op.x2, y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

/** KB-413 step 4 (owner, 16 Nov 2026): the share image / PDF in design 13's receipt colours, on plain white - no border, no torn edge. */
export const SHARE_PALETTE: ReceiptPalette = {
  ink: "#263238", // --color-kb-ink
  inkSoft: "#6B7580", // --color-kb-receipt-sub: date, phone, thanks
  line: "#ECE8E1", // --color-kb-receipt-row
  muted: "#C9C2B8", // --color-kb-receipt-rule: the dashed rules
  strong: "#4B5560", // --color-kb-receipt-strong
  lightDash: null,
  dash: [3, 3],
  widths: { dashed: 1, dark: 2, light: 1 },
  snap: false,
  border: false,
};

export const renderReceiptFiles: RenderReceiptFiles = async (receipt) => {
  await loadFonts(receipt, [400, 700]);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  const measure = (text: string, font: FontSpec) => {
    ctx.font = cssFont(font);
    ctx.letterSpacing = `${font.tracking ?? 0}px`;
    return ctx.measureText(text).width;
  };
  const layout = layoutReceipt(receipt, measure, WIDTH);
  canvas.width = WIDTH * SCALE;
  canvas.height = layout.height * SCALE;

  ctx.scale(SCALE, SCALE);
  paintReceipt(ctx, layout, SHARE_PALETTE);

  const png = await toBlob(canvas, "image/png");
  const jpeg = await toBlob(canvas, "image/jpeg", 0.92);
  const pdf = new Blob([jpegPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height)], { type: "application/pdf" });
  return { png, pdf };
};
