import { printProfile, toMonoBitmap, type MonoBitmap } from "@/domain/escpos";
import type { Receipt } from "@/domain/receipt";
import { layoutReceipt, type FontSpec } from "@/domain/receiptLayout";
import { cssFont, loadFonts, paintReceipt, type ReceiptPalette } from "./receiptImage";

// KB-408 S3 + fix 2 (owner's S6, 14 Nov 2026): the receipt as the thermal printer's dots - today's receipt (the share image's layout
// steps and painter) laid out in the printer's OWN dots (printProfile): nothing is scaled, every position is a whole dot, in pure
// black - a printer has no grey. Browser only (canvas).

/**
 * All black: the printer has one ink. No line thinner than 2 dots (a 1-dot line prints faint): dashed rules 2, the header rule 3, and
 * the light row rule 2 dots dotted, so it still reads lighter than the header rule.
 */
export const PRINT_PALETTE: ReceiptPalette = {
  ink: "#000000",
  inkSoft: "#000000",
  line: "#000000",
  muted: "#000000",
  lightDash: [2, 4],
  dash: [6, 6],
  widths: { dashed: 2, dark: 3, light: 2 },
  snap: true,
  border: false,
};

export interface PrintImage {
  /** The rendered pixels before black-and-white (previews, the threshold fixtures). */
  readonly rgba: Uint8ClampedArray;
  readonly bitmap: MonoBitmap;
}

export async function renderReceiptForPrint(receipt: Receipt, dots: number): Promise<PrintImage> {
  await loadFonts(receipt, [600, 700]);
  const profile = printProfile(dots);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas");
  const measure = (text: string, font: FontSpec) => {
    ctx.font = cssFont(font);
    return ctx.measureText(text).width;
  };
  const layout = layoutReceipt(receipt, measure, profile.dots, profile.padding, profile.style);
  canvas.width = profile.dots;
  canvas.height = layout.height;
  paintReceipt(ctx, layout, PRINT_PALETTE);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: data, bitmap: toMonoBitmap(data, canvas.width, canvas.height) };
}
