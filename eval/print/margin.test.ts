import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PRINT_THRESHOLD, decodeEscPos, encodeReceiptImage, printProfile, toMonoBitmap } from "@/domain/escpos";

// KB-408 (owner + reviewer, 14 Nov 2026): on the REAL rendered pixels (the browser engine's, /__dev/print) no ink may sit in the side
// margins - 8 dots each side on 58 mm (384), 16 on 80 mm (576). The 58 mm print once had ink on dot 0 and dot 383: a printer a dot
// narrower, slightly offset or weak at its edge would have cut the first letter of names and the last digit of amounts.
// src/ui/printMargin.test.ts checks the same on the layout's steps, where a planted bug in the code is caught.

const DIR = path.join(__dirname, "fixtures");
/** For one render: the blank columns each side at a darkness limit, and the darkest pixel inside each margin. */
function sides(file: string) {
  const dots = Number(/-(\d+)\.grey\.gz$/.exec(file)![1]);
  const grey = gunzipSync(readFileSync(path.join(DIR, file)));
  const h = grey.length / dots;
  const darkest = (x: number) => {
    let d = 255;
    for (let y = 0; y < h; y++) d = Math.min(d, grey[y * dots + x]!);
    return d;
  };
  const blank = (limit: number, fromRight: boolean) => {
    let n = 0;
    while (n < dots && darkest(fromRight ? dots - 1 - n : n) >= limit) n++;
    return n;
  };
  const margin = printProfile(dots).padding;
  const inMargin = Array.from({ length: margin }, (_, x) => Math.min(darkest(x), darkest(dots - 1 - x)));
  return { dots, h, margin, blank, darkestInMargin: Math.min(...inMargin) };
}

const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".grey.gz")).sort();

describe("the printed image keeps its side margins (real renders)", () => {
  it("covers every 58 mm job the owner listed, and Bill 514 on 80 mm", () => {
    expect(fixtures).toEqual([
      "bill514-384.grey.gz",
      "bill514-576.grey.gz",
      "longtest-384.grey.gz",
      "testprint-384.grey.gz",
      "three-384.grey.gz",
      "three-reprint-384.grey.gz",
      "wide-384.grey.gz",
    ]);
  });

  it.each(fixtures)("%s: the printer gets no dot in either margin", (file) => {
    const { dots, h, margin, blank } = sides(file);
    expect(Number.isInteger(h)).toBe(true);
    // what prints: a pixel darker than the cut-off
    expect(blank(PRINT_THRESHOLD, false), "blank printed dots on the left").toBeGreaterThanOrEqual(margin);
    expect(blank(PRINT_THRESHOLD, true), "blank printed dots on the right").toBeGreaterThanOrEqual(margin);
    expect(blank(PRINT_THRESHOLD, false)).toBeLessThan(dots / 4); // not an empty image
  });

  it.each(fixtures)("%s: the margins are pure white but for the innermost column, whose faint edge shade is far too light to print", (file) => {
    const { margin, blank, darkestInMargin } = sides(file);
    // a bold letter's anti-aliased edge may shade the one column next to the text (measured 14 Nov 2026: luma 204 on 58 mm, 178 on 80 mm)
    expect(blank(255, false), "pure white columns on the left").toBeGreaterThanOrEqual(margin - 1);
    expect(blank(255, true), "pure white columns on the right").toBeGreaterThanOrEqual(margin - 1);
    expect(darkestInMargin).toBeGreaterThanOrEqual(PRINT_THRESHOLD + 15);
  });
});

// Owner, 14 Nov 2026: Compatible mode sends the SAME image as ESC * bit image (older printers without GS v 0). Read back from those
// bytes, it must be the image dot for dot - margins included - on both papers.
describe("Compatible mode (ESC *): the printer draws exactly the image (real renders)", () => {
  it.each(["bill514-384.grey.gz", "bill514-576.grey.gz", "wide-384.grey.gz"])("%s", (file) => {
    const dots = Number(/-(\d+)\.grey\.gz$/.exec(file)![1]);
    const grey = gunzipSync(readFileSync(path.join(DIR, file)));
    const h = grey.length / dots;
    const rgba = new Uint8Array(dots * h * 4);
    for (let i = 0; i < grey.length; i++) rgba.set([grey[i]!, grey[i]!, grey[i]!, 255], i * 4);
    const img = toMonoBitmap(rgba, dots, h);
    const back = decodeEscPos(encodeReceiptImage(img, { mode: "bitimage" }));
    expect(back.width).toBe(dots);
    expect(back.height).toBe(Math.ceil(h / 24) * 24); // ESC * prints whole 24-dot bands
    expect(Buffer.from(back.data.subarray(0, img.data.length)).equals(Buffer.from(img.data))).toBe(true);
    expect(back.data.subarray(img.data.length).every((b) => b === 0)).toBe(true);
    // the margins survive: no dot in the outer columns
    const margin = printProfile(dots).padding;
    const dot = (x: number, y: number) => (back.data[y * (dots / 8) + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
    for (let y = 0; y < back.height; y++) for (let x = 0; x < margin; x++) expect(dot(x, y) || dot(dots - 1 - x, y), `dot in the margin at ${x}, ${y}`).toBe(false);
  });
});
