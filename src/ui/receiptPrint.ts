import { printProfile, toMonoBitmap, type MonoBitmap } from "@/domain/escpos";
import type { Receipt } from "@/domain/receipt";
import { layoutReceipt, type FontSpec } from "@/domain/receiptLayout";
import { cssFont, loadFonts, paintReceipt } from "./receiptImage";

// KB-408 S3 (owner, D110 item 8.6): the receipt as the thermal printer's dots - today's receipt (the share image's layout and painter),
// at the paper's width (printProfile), in pure black: a printer has no grey. Browser only (canvas).

/** All black: the printer has one ink. The light row rule becomes a dotted line, so it still reads lighter than the header rule. */
export const PRINT_PALETTE = { ink: "#000000", inkSoft: "#000000", line: "#000000", muted: "#000000", lightDash: [1, 2], border: false } as const;

export interface PrintImage {
  /** The rendered pixels before black-and-white (previews, the threshold fixtures). */
  readonly rgba: Uint8ClampedArray;
  readonly bitmap: MonoBitmap;
}

export async function renderReceiptForPrint(receipt: Receipt, dots: number): Promise<PrintImage> {
  await loadFonts(receipt);
  const profile = printProfile(dots);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas");
  const measure = (text: string, font: FontSpec) => {
    ctx.font = cssFont(font);
    return ctx.measureText(text).width;
  };
  const layout = layoutReceipt(receipt, measure, profile.layoutWidth, profile.padding);
  canvas.width = profile.dots;
  canvas.height = Math.ceil(layout.height * profile.scale);
  ctx.scale(profile.scale, profile.scale);
  paintReceipt(ctx, layout, PRINT_PALETTE);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: data, bitmap: toMonoBitmap(data, canvas.width, canvas.height) };
}
