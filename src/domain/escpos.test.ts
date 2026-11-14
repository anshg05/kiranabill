import { describe, expect, it } from "vitest";
import { PRINT_BAND_ROWS, PRINT_THRESHOLD, decodeEscPos, encodeReceiptImage, printProfile, toMonoBitmap, type MonoBitmap } from "./escpos";
import { printStyle } from "./receiptLayout";

// KB-408 S3 (D111): the receipt goes to the printer as an IMAGE - cheap ESC/POS printers have no Devanagari font. Only standard
// commands, so ANY ESC/POS Bluetooth printer prints it: ESC @, GS v 0 in bands, ESC d, GS V; ESC * for printers without GS v 0.

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

/** A bitmap from rows of "#" (black) and "." (white). */
function bitmap(rows: string[]): MonoBitmap {
  const width = rows[0]!.length;
  const data = new Uint8Array((width / 8) * rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => c === "#" && (data[y * (width / 8) + (x >> 3)]! |= 0x80 >> (x & 7))));
  return { width, height: rows.length, data };
}

describe("toMonoBitmap - RGBA to printer dots", () => {
  const rgba = (pixels: [number, number, number, number][]) => new Uint8Array(pixels.flat());

  it("dark is a dot, light is paper; packed 8 dots per byte, leftmost dot = the high bit", () => {
    const px: [number, number, number, number][] = [
      [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255],
      [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255],
    ];
    expect(toMonoBitmap(rgba(px), 8, 1)).toEqual({ width: 8, height: 1, data: new Uint8Array([0b1010_0001]) });
  });

  it("the cut-off is PRINT_THRESHOLD on luminance (R 0.299, G 0.587, B 0.114): darker than it prints", () => {
    const grey = (v: number): [number, number, number, number] => [v, v, v, 255];
    const row = [grey(PRINT_THRESHOLD - 1), grey(PRINT_THRESHOLD), grey(0), grey(255), grey(255), grey(255), grey(255), grey(255)];
    expect(toMonoBitmap(rgba(row), 8, 1).data[0]).toBe(0b1010_0000);
    // weighted, not an average: at a cut-off of 128 pure green (luma 150) stays paper, pure blue (29) prints - (0+255+0)/3 would print both
    const colours = rgba([[0, 255, 0, 255], [0, 0, 255, 255], ...Array(6).fill([255, 255, 255, 255])]);
    expect(toMonoBitmap(colours, 8, 1, 128).data[0]).toBe(0b0100_0000);
  });

  it("a transparent pixel is paper, whatever its colour", () => {
    expect(toMonoBitmap(rgba([[0, 0, 0, 0], ...Array(7).fill([255, 255, 255, 255])]), 8, 1).data[0]).toBe(0);
  });

  it("a width that is not a multiple of 8 is padded with paper on the right", () => {
    const img = toMonoBitmap(rgba(Array(10).fill([0, 0, 0, 255])), 10, 1);
    expect(img.width).toBe(16);
    expect([...img.data]).toEqual([0xff, 0b1100_0000]);
  });

  it("refuses a size that does not match the pixels", () => {
    expect(() => toMonoBitmap(new Uint8Array(4 * 7), 8, 1)).toThrow();
  });
});

describe("encodeReceiptImage - GS v 0 raster (the default)", () => {
  const img = bitmap(["#.......", "........", ".......#"]);

  it("exact bytes: ESC @, one band of GS v 0, feed, cut", () => {
    expect(hex(encodeReceiptImage(img, { feedLines: 3, cut: true }))).toBe(
      ["1b 40", "1d 76 30 00 01 00 03 00 80 00 01", "1b 64 03", "1d 56 42 00"].join(" "),
    );
  });

  it("no cut when asked (a 58 mm printer without a cutter), no feed when 0", () => {
    expect(hex(encodeReceiptImage(img, { feedLines: 0, cut: false }))).toBe("1b 40 1d 76 30 00 01 00 03 00 80 00 01");
  });

  it("tall images go in bands, each its own GS v 0 with its own height - small printer buffers never overflow", () => {
    const tall = bitmap(Array.from({ length: 5 }, (_, i) => (i % 2 ? "#......." : "........")));
    expect(hex(encodeReceiptImage(tall, { bandRows: 2, feedLines: 0, cut: false }))).toBe(
      ["1b 40", "1d 76 30 00 01 00 02 00 00 80", "1d 76 30 00 01 00 02 00 00 80", "1d 76 30 00 01 00 01 00 00"].join(" "),
    );
  });

  it("width and height go little-endian: 576 dots = 72 bytes a row", () => {
    const wide: MonoBitmap = { width: 576, height: 300, data: new Uint8Array(72 * 300) };
    const out = encodeReceiptImage(wide, { bandRows: 300, feedLines: 0, cut: false });
    expect(hex(out.slice(2, 10))).toBe("1d 76 30 00 48 00 2c 01");
    expect(out.length).toBe(2 + 8 + 72 * 300);
  });

  it("refuses what no printer can take: a width that is not whole bytes, a band of 0 rows or over 255 feed lines", () => {
    expect(() => encodeReceiptImage({ width: 10, height: 1, data: new Uint8Array(2) })).toThrow();
    expect(() => encodeReceiptImage(img, { bandRows: 0 })).toThrow();
    expect(() => encodeReceiptImage(img, { feedLines: 256 })).toThrow();
  });
});

describe("encodeReceiptImage - ESC * bit image (for printers without GS v 0)", () => {
  it("exact bytes: 24-dot line spacing, ESC * 33 per 24-row band (3 bytes a column, top dot = high bit), LF, spacing reset", () => {
    const img = bitmap(["#.......", ...Array(22).fill("........"), "........", "#......."]);
    const out = encodeReceiptImage(img, { mode: "bitimage", feedLines: 0, cut: false });
    const band1 = ["1b 2a 21 08 00", "80 00 00", ...Array(7).fill("00 00 00"), "0a"];
    const band2 = ["1b 2a 21 08 00", "80 00 00", ...Array(7).fill("00 00 00"), "0a"];
    expect(hex(out)).toBe(["1b 40", "1b 33 18", ...band1, ...band2, "1b 32"].join(" "));
  });
});

describe("decodeEscPos - what the printer will draw, read back from the bytes", () => {
  const img = bitmap(["#..#....", ".##.....", "........", "#######.", "......##"]);

  it.each([
    ["raster", { mode: "raster" as const, bandRows: 2 }],
    ["bit image", { mode: "bitimage" as const }],
  ])("%s: the decoded image is the original, dot for dot", (_n, opts) => {
    const back = decodeEscPos(encodeReceiptImage(img, { ...opts, feedLines: 4, cut: true }));
    expect(back.width).toBe(8);
    expect([...back.data.slice(0, img.data.length)]).toEqual([...img.data]);
    expect(back.height).toBeGreaterThanOrEqual(img.height); // ESC * prints whole 24-dot bands
    expect(back.data.slice(img.data.length).every((b) => b === 0)).toBe(true);
  });

  it("an unknown command is an error, never silently skipped (garbage on paper would be)", () => {
    expect(() => decodeEscPos(new Uint8Array([0x1b, 0x40, 0x1b, 0x45, 0x01]))).toThrow();
  });
});

describe("printProfile - the paper width (laid out in the printer's own dots, nothing scaled)", () => {
  // a monospace measure, 0.6 em a character (IBM Plex Mono's advance)
  const chars = (n: number, size: number) => n * 0.6 * size;

  it("80 mm (576 dots): the wide style with a margin", () => {
    expect(printProfile(576)).toEqual({ dots: 576, padding: 16, style: printStyle("wide") });
  });

  it("58 mm (384 dots): the narrow style on every dot - exactly 32 characters of the number size fit, 33 do not", () => {
    const p = printProfile(384);
    expect(p).toEqual({ dots: 384, padding: 0, style: printStyle("narrow") });
    const inner = p.dots - 2 * p.padding;
    expect(chars(32, p.style.cell.size)).toBeLessThanOrEqual(inner);
    expect(chars(33, p.style.cell.size)).toBeGreaterThan(inner);
  });

  it("a custom width is cut down to whole bytes; narrow paper is treated like 58 mm, wide like 80 mm", () => {
    expect(printProfile(436).dots).toBe(432);
    expect(printProfile(432).style).toEqual(printStyle("narrow"));
    expect(printProfile(512).style).toEqual(printStyle("wide"));
  });

  it("refuses a width no receipt fits (under 2 inches of dots, or absurd)", () => {
    expect(() => printProfile(200)).toThrow();
    expect(() => printProfile(5000)).toThrow();
  });
});

describe("PRINT_BAND_ROWS", () => {
  it("is 24 rows: a lost byte spoils 3 mm of paper, not the rest of the bill", () => {
    expect(PRINT_BAND_ROWS).toBe(24);
    const img: MonoBitmap = { width: 8, height: 50, data: new Uint8Array(50) };
    const out = encodeReceiptImage(img, { feedLines: 0, cut: false });
    expect(hex(out.slice(2, 10))).toBe("1d 76 30 00 01 00 18 00"); // the first band is 24 rows
    expect(out.length).toBe(2 + 3 * 8 + 50); // 24 + 24 + 2 rows = three commands
  });
});
