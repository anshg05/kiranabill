// KB-408 S3 (D111, owner rulings D110 item 8.6 / 8.10): the receipt goes to a thermal printer as an IMAGE - cheap printers have no
// Devanagari font. Only standard ESC/POS commands, so ANY ESC/POS printer prints it. Pure: pixels in, bytes out (and back, for previews).

/** 1 bit a dot, rows packed 8 dots a byte, the leftmost dot in the high bit; 1 = black. width is a multiple of 8. */
export interface MonoBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * Luminance below this prints as a dot. Tuned on the real Bill 514 text, Devanagari included (eval/print/threshold.test.ts): high
 * enough that thin, anti-aliased marks (ि ी ् ँ ं, क्ष, द्ध) keep their dots, low enough that strokes do not merge.
 */
export const PRINT_THRESHOLD = 160;

/** RGBA pixels (a canvas's ImageData) -> printer dots. Transparent counts as paper; the width is padded to whole bytes with paper. */
export function toMonoBitmap(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, threshold = PRINT_THRESHOLD): MonoBitmap {
  if (rgba.length !== width * height * 4) throw new Error(`toMonoBitmap: ${rgba.length} bytes is not ${width} x ${height} RGBA`);
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = (299 * rgba[i]! + 587 * rgba[i + 1]! + 114 * rgba[i + 2]!) / 1000;
      const onPaper = 255 - (rgba[i + 3]! * (255 - luma)) / 255; // composited over white paper
      if (onPaper < threshold) data[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width: rowBytes * 8, height, data };
}

export interface EncodeOptions {
  /** "raster" = GS v 0 (most printers); "bitimage" = ESC * 24-dot (older printers that print garbage for GS v 0). */
  readonly mode?: "raster" | "bitimage";
  /** Rows per GS v 0 command: small printer buffers overflow on one huge image. */
  readonly bandRows?: number;
  /** Blank lines fed after the image (ESC d), so the end clears the tear bar. */
  readonly feedLines?: number;
  /** GS V partial cut - printers without a cutter ignore it. */
  readonly cut?: boolean;
}

const ESC = 0x1b;
const GS = 0x1d;

/** The whole print job for one receipt image. */
export function encodeReceiptImage(img: MonoBitmap, { mode = "raster", bandRows = 64, feedLines = 4, cut = true }: EncodeOptions = {}): Uint8Array {
  if (img.width % 8 !== 0 || img.width <= 0 || img.data.length !== (img.width / 8) * img.height) throw new Error("encodeReceiptImage: not a packed bitmap");
  if (!Number.isInteger(bandRows) || bandRows < 1) throw new Error("encodeReceiptImage: bandRows must be a whole number >= 1");
  if (!Number.isInteger(feedLines) || feedLines < 0 || feedLines > 255) throw new Error("encodeReceiptImage: feedLines must be 0-255");
  const rowBytes = img.width / 8;
  const out: number[] = [ESC, 0x40]; // ESC @ - a clean start
  const push = (bytes: ArrayLike<number>) => {
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
  };
  if (mode === "raster") {
    for (let top = 0; top < img.height; top += bandRows) {
      const rows = Math.min(bandRows, img.height - top);
      push([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8]);
      push(img.data.subarray(top * rowBytes, (top + rows) * rowBytes));
    }
  } else {
    const dot = (x: number, y: number) => y < img.height && (img.data[y * rowBytes + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
    push([ESC, 0x33, 24]); // line spacing = one 24-dot band, so bands touch
    for (let top = 0; top < img.height; top += 24) {
      push([ESC, 0x2a, 33, img.width & 0xff, img.width >> 8]); // ESC * m=33: 24-dot double density
      for (let x = 0; x < img.width; x++) {
        for (let k = 0; k < 3; k++) {
          let b = 0;
          for (let bit = 0; bit < 8; bit++) if (dot(x, top + k * 8 + bit)) b |= 0x80 >> bit;
          out.push(b);
        }
      }
      out.push(0x0a);
    }
    push([ESC, 0x32]); // default line spacing again
  }
  if (feedLines > 0) push([ESC, 0x64, feedLines]);
  if (cut) push([GS, 0x56, 0x42, 0x00]);
  return Uint8Array.from(out);
}

/** Reads a print job back into the image the printer draws (previews, tests). Throws on any command this encoder never sends. */
export function decodeEscPos(bytes: Uint8Array): MonoBitmap {
  let width = 0;
  const rows: Uint8Array[] = [];
  let i = 0;
  const need = (n: number) => {
    if (i + n > bytes.length) throw new Error(`decodeEscPos: cut short at ${i}`);
  };
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === ESC && bytes[i + 1] === 0x40) i += 2;
    else if (b === ESC && bytes[i + 1] === 0x33) i += 3;
    else if (b === ESC && bytes[i + 1] === 0x32) i += 2;
    else if (b === ESC && bytes[i + 1] === 0x64) i += 3;
    else if (b === GS && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42) i += 4;
    else if (b === GS && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
      need(8);
      const rb = bytes[i + 4]! | (bytes[i + 5]! << 8);
      const h = bytes[i + 6]! | (bytes[i + 7]! << 8);
      i += 8;
      need(rb * h);
      width = rb * 8;
      for (let y = 0; y < h; y++) rows.push(bytes.slice(i + y * rb, i + (y + 1) * rb));
      i += rb * h;
    } else if (b === ESC && bytes[i + 1] === 0x2a && bytes[i + 2] === 33) {
      need(5);
      const w = bytes[i + 3]! | (bytes[i + 4]! << 8);
      i += 5;
      need(w * 3 + 1);
      width = Math.ceil(w / 8) * 8;
      const band = Array.from({ length: 24 }, () => new Uint8Array(width / 8));
      for (let x = 0; x < w; x++) {
        for (let k = 0; k < 3; k++) {
          const v = bytes[i + x * 3 + k]!;
          for (let bit = 0; bit < 8; bit++) if (v & (0x80 >> bit)) band[k * 8 + bit]![x >> 3]! |= 0x80 >> (x & 7);
        }
      }
      i += w * 3;
      if (bytes[i] !== 0x0a) throw new Error(`decodeEscPos: no line feed after a bit image at ${i}`);
      i += 1;
      rows.push(...band);
    } else throw new Error(`decodeEscPos: unknown command 0x${b.toString(16)} at ${i}`);
  }
  const data = new Uint8Array((width / 8) * rows.length);
  rows.forEach((r, y) => data.set(r, y * (width / 8)));
  return { width, height: rows.length, data };
}

export interface PrintProfile {
  /** Dots a line - the image's width. */
  readonly dots: number;
  /** The receipt layout's width in its own px (receiptLayout.ts); drawn `scale` times as large. */
  readonly layoutWidth: number;
  readonly padding: number;
  readonly scale: number;
}

/**
 * The receipt at a paper width (owner, D110 item 8.6). 80 mm and wider: today's 384 px receipt exactly, scaled to the dots. Narrower
 * (58 mm, 384 dots): the same table with a small margin and a 19.25-dot font - about 32 monospace characters a line.
 */
export function printProfile(requestedDots: number): PrintProfile {
  const dots = Math.floor(requestedDots / 8) * 8;
  if (!Number.isFinite(dots) || dots < 256 || dots > 1024) throw new Error(`printProfile: ${requestedDots} dots is not a receipt printer`);
  if (dots >= 512) return { dots, layoutWidth: 384, padding: 16, scale: dots / 384 };
  const scale = 1.375;
  return { dots, layoutWidth: dots / scale, padding: 4, scale };
}
