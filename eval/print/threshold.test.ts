import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PRINT_THRESHOLD, toMonoBitmap } from "@/domain/escpos";

// KB-408 S3 (owner, 13 Nov 2026): the black-and-white cut-off is tuned on REAL receipt text, Devanagari included - not on Latin alone.
// The fixtures are the grey pixels of Bill 514 (src/ui/devPrintBills.ts, 38 rows: ि ी ् ँ ं, क्ष, द्ध, a wrapped name) exactly as the
// browser engine rendered them at 576 and 384 dots (/__dev/print). Measured 13 Nov 2026 - text strokes broken / strokes run together:
//   cut-off   128      144      160      176      192      208
//   384 dots  74 / 0   74 / 0   73 / 1   63 / 11  47 / 42  40 / 47
//   576 dots  69 / 0   59 / 10  57 / 12  50 / 19  46 / 23  13 / 56
// Lighter breaks more strokes; darker blots conjuncts and fills counters. 160 keeps both low (thermal dots also spread a little on paper).

const INK = 235; // any visible ink on white paper

function fixture(dots: 384 | 576) {
  const grey = gunzipSync(readFileSync(path.join(__dirname, "fixtures", `bill514-${dots}.grey.gz`)));
  return { grey, w: dots, h: grey.length / dots };
}

/** 8-connected components of a mask: a label per pixel (0 = none), and each component's pixel list. */
function components(mask: (i: number) => boolean, w: number, h: number) {
  const label = new Int32Array(w * h);
  const list: number[][] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] || !mask(s)) continue;
    const px: number[] = [];
    list.push(px);
    label[s] = list.length;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      px.push(i);
      const x = i % w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const j = i + dy * w + dx;
          if (nx < 0 || nx >= w || j < 0 || j >= w * h || label[j] || !mask(j)) continue;
          label[j] = list.length;
          stack.push(j);
        }
    }
  }
  return { label, list };
}

/** A rule (dashes, dots, the header line) is a few rows high and much wider - not text. */
const isRule = (px: number[], w: number) => {
  const ys = new Set(px.map((i) => Math.floor(i / w)));
  const xs = new Set(px.map((i) => i % w));
  return ys.size <= 4 && xs.size >= 6 * ys.size;
};

function measure(dots: 384 | 576, threshold: number) {
  const { grey, w, h } = fixture(dots);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < grey.length; i++) rgba.set([grey[i]!, grey[i]!, grey[i]!, 255], i * 4);
  const mono = toMonoBitmap(rgba, w, h, threshold);
  const dot = (i: number) => (mono.data[Math.floor(i / w) * (w / 8) + ((i % w) >> 3)]! & (0x80 >> (i % w & 7))) !== 0;
  const text = components((i) => grey[i]! < INK, w, h).list.filter((px) => px.length >= 3 && !isRule(px, w));
  const printed = components(dot, w, h).label;
  const shape = components((i) => grey[i]! < 128, w, h).label; // the glyphs' true shape: 50 % ink coverage
  const lost = text.filter((px) => !px.some(dot)).length;
  const broken = text.filter((px) => new Set(px.filter(dot).map((i) => printed[i])).size > 1).length;
  const joined = new Map<number, Set<number>>();
  for (let i = 0; i < w * h; i++) if (printed[i] && shape[i]) (joined.get(printed[i]!) ?? joined.set(printed[i]!, new Set()).get(printed[i]!)!).add(shape[i]!);
  const merged = [...joined.values()].filter((s) => s.size > 1).length;
  return { textMarks: text.length, lost, broken, merged };
}

describe("PRINT_THRESHOLD on the real Bill 514 text (Devanagari included)", () => {
  it.each([384, 576] as const)("%i dots: no visible mark is lost, strokes do not break, separate strokes do not run together", (dots) => {
    const m = measure(dots, PRINT_THRESHOLD);
    expect(m.textMarks).toBeGreaterThan(3000); // the fixture is the whole 38-row bill
    expect(m.lost).toBe(0);
    // measured at 160 (13 Nov 2026): 384 -> 73 broken / 1 merged; 576 -> 57 / 12. The bounds keep that, with a small margin.
    expect(m.broken).toBeLessThanOrEqual(dots === 384 ? 78 : 62);
    expect(m.merged).toBeLessThanOrEqual(dots === 384 ? 4 : 15);
  });

  it("the fixtures are the expected renders (a new font or layout means re-measuring, not loosening the bounds)", () => {
    expect(fixture(384).h).toBe(1817);
    expect(fixture(576).h).toBe(1952);
  });
});
