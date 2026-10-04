import { describe, expect, it } from "vitest";
import { jpegPdf, PAGE_WIDTH_PT } from "./onePagePdf";

// KB-309 (owner, Q1 A): our own one-image PDF, no dependency - one page 58 mm
// wide (the thermal roll, 164.41 pt), its height in proportion, the receipt's
// JPEG scaled to fill it. The bytes are checked structurally: header, the
// image object, a cross-reference table whose offsets really point at the
// objects, trailer, %%EOF.

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
// A stand-in JPEG body: SOI ... EOI with bytes a text encoder would mangle.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x80, 0x0a, 0x0d, 0x25, 0xc3, 0xff, 0xd9]);

describe("jpegPdf - one page, one image", () => {
  const pdf = jpegPdf(JPEG, 768, 1000);
  const text = latin1(pdf);

  it("58 mm wide (164.41 pt), height in proportion; the image fills the page", () => {
    expect(PAGE_WIDTH_PT).toBe(164.41);
    const h = ((164.41 * 1000) / 768).toFixed(2);
    expect(text).toContain(`/MediaBox [0 0 164.41 ${h}]`);
    expect(text).toContain(`164.41 0 0 ${h} 0 0 cm /Im0 Do`);
  });

  it("the image object: the JPEG's size, DCTDecode, its exact bytes as the stream", () => {
    expect(text).toMatch(/\/Type \/XObject \/Subtype \/Image \/Width 768 \/Height 1000 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 12 >>\nstream\n/);
    const start = text.indexOf("/DCTDecode /Length 12 >>\nstream\n") + "/DCTDecode /Length 12 >>\nstream\n".length;
    expect(Array.from(pdf.slice(start, start + JPEG.length))).toEqual(Array.from(JPEG));
    expect(text.slice(start + JPEG.length, start + JPEG.length + 11)).toBe("\nendstream\n");
  });

  it("header, xref offsets that point at each object, trailer, %%EOF", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 5)).toBe("xref\n");
    const table = /xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)/.exec(text.slice(startxref))!;
    const count = Number(table[1]);
    expect(count).toBe(6);
    const offsets = table[2]!.trim().split("\n").map((l) => Number(l.slice(0, 10)));
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain("trailer\n<< /Size 6 /Root 1 0 R >>");
  });
});
