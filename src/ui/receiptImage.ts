import type { Receipt } from "@/domain/receipt";
import { layoutReceipt, type FontSpec } from "@/domain/receiptLayout";
import { jpegPdf } from "./onePagePdf";
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-309: the receipt as a PNG (2x: 768 px wide, Q4) and the same pixels as a
// one-page PDF (JPEG inside, 58 mm wide). Drawn with fillText from
// layoutReceipt's steps - no HTML anywhere (hard rule 9). Browser only
// (canvas); checked in a real browser, the layout itself is unit-tested.

const WIDTH = 384;
const SCALE = 2;
const FAMILY = `"IBM Plex Mono", Mukta, monospace`;
const cssFont = (f: FontSpec) => `${f.weight} ${f.size}px ${FAMILY}`;

/** Owner: Plex and Mukta are split by unicode-range and a canvas doesn't
 * trigger those subsets - load every face/weight with the receipt's ACTUAL
 * strings first, or the first image after a reload draws in a fallback. */
async function loadFonts(receipt: Receipt): Promise<void> {
  const r = receipt;
  const strings = [r.shopName.toUpperCase(), r.shopPhone ?? "", r.dateTime, r.billNoLabel, r.receiptNumber, r.customerLabel, r.customer ?? "",
    ...Object.values(r.headers), ...r.rows.flatMap((x) => [x.name, x.qty, x.rate, x.amount]), r.totalLabel, r.total, r.thanks];
  const sample = [...new Set(strings.join(""))].join("");
  await Promise.all([400, 600].flatMap((w) => [`${w} 14px "IBM Plex Mono"`, `${w} 14px Mukta`].map((font) => document.fonts.load(font, sample))));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`toBlob ${type} failed`))), type, quality));
}

export const renderReceiptFiles: RenderReceiptFiles = async (receipt) => {
  await loadFonts(receipt);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  const measure = (text: string, font: FontSpec) => {
    ctx.font = cssFont(font);
    return ctx.measureText(text).width;
  };
  const layout = layoutReceipt(receipt, measure, WIDTH);
  canvas.width = WIDTH * SCALE;
  canvas.height = layout.height * SCALE;

  const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const ink = token("--color-ink", "#1A1A1F");
  const inkSoft = token("--color-ink-soft", "#5A5A66");
  const line = token("--color-line", "#E4E0D6");
  const muted = token("--color-muted", "#9A9689");

  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, WIDTH, layout.height);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, WIDTH - 1, layout.height - 1);
  ctx.textBaseline = "top";
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = cssFont(op);
      ctx.fillStyle = op.muted ? inkSoft : ink;
      ctx.textAlign = op.align;
      // The glyph sits in the middle of its line box, as in CSS (leading-snug).
      ctx.fillText(op.text, op.x, op.y + op.size * 0.1875);
    } else {
      ctx.beginPath();
      ctx.setLineDash(op.style === "dashed" ? [3, 3] : []);
      ctx.strokeStyle = op.style === "dashed" ? muted : op.style === "dark" ? inkSoft : line;
      ctx.lineWidth = op.style === "dark" ? 1.5 : 1;
      ctx.moveTo(op.x1, op.y + 0.5);
      ctx.lineTo(op.x2, op.y + 0.5);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  const png = await toBlob(canvas, "image/png");
  const jpeg = await toBlob(canvas, "image/jpeg", 0.92);
  const pdf = new Blob([jpegPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height)], { type: "application/pdf" });
  return { png, pdf };
};
