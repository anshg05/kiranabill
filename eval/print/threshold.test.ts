import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PRINT_THRESHOLD, toMonoBitmap } from "@/domain/escpos";

// KB-408 (owner, 13-14 Nov 2026): the black-and-white cut-off is tuned on REAL receipt text, Devanagari included - not on Latin alone.
// The fixtures are the grey pixels of the owner's real Bill 514 (src/ui/devPrintBills.ts, 38 lines) exactly as the browser engine
// rendered the PRINT layout at 576 and 384 dots (/__dev/print). Re-measured 14 Nov 2026 after fix 2 (the bill laid out in whole dots,
// semi-bold or bolder):
//   cut-off            96      128     144     160     176     192
//   384: merged        0       0       0       0       1       27
//   384: hairlines     2.27%   1.56%   1.40%   1.03%   0.68%   -
//   576: merged        0       0       0       0       1       26
//   576: hairlines     1.23%   0.77%   0.71%   0.56%   0.41%   -
// "merged" = separate strokes run together (a blotted mark); "hairlines" = ink in strokes only 1 dot wide, which thermal paper prints
// faint or broken (the S6 printout had 16% / 12%). Lighter cut-offs leave more hairlines, darker ones blot. 160 = the darkest with no blot.

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
  const dot = (i: number) => i >= 0 && i < w * h && (mono.data[Math.floor(i / w) * (w / 8) + ((i % w) >> 3)]! & (0x80 >> (i % w & 7))) !== 0;
  const text = components((i) => grey[i]! < INK, w, h).list.filter((px) => px.length >= 3 && !isRule(px, w));
  const printed = components(dot, w, h).label;
  const shape = components((i) => grey[i]! < 128, w, h).label; // the glyphs' true shape: 50 % ink coverage
  const lost = text.filter((px) => !px.some(dot)).length;
  const joined = new Map<number, Set<number>>();
  for (let i = 0; i < w * h; i++) if (printed[i] && shape[i]) (joined.get(printed[i]!) ?? joined.set(printed[i]!, new Set()).get(printed[i]!)!).add(shape[i]!);
  const merged = [...joined.values()].filter((s) => s.size > 1).length;
  // hairlines: dots in a stroke only 1 dot wide (or high) that runs 3 dots or more
  const run = (i: number, step: number, sameRow: boolean) => {
    let n = 1;
    for (let k = i - step; dot(k) && (!sameRow || Math.floor(k / w) === Math.floor(i / w)); k -= step) n++;
    for (let k = i + step; dot(k) && (!sameRow || Math.floor(k / w) === Math.floor(i / w)); k += step) n++;
    return n;
  };
  let black = 0;
  let hair = 0;
  for (let i = 0; i < w * h; i++) {
    if (!dot(i)) continue;
    black++;
    const x = i % w;
    const alone = { across: !(x > 0 && dot(i - 1)) && !(x < w - 1 && dot(i + 1)), down: !dot(i - w) && !dot(i + w) };
    if ((alone.across && run(i, w, false) >= 3) || (alone.down && run(i, 1, true) >= 3)) hair++;
  }
  return { textMarks: text.length, lost, merged, hairlinePercent: (100 * hair) / black };
}

describe("PRINT_THRESHOLD on the real Bill 514 (the print layout, Devanagari included)", () => {
  it.each([384, 576] as const)("%i dots: no mark is lost, no mark blots, and almost no stroke is only 1 dot wide", (dots) => {
    const m = measure(dots, PRINT_THRESHOLD);
    expect(m.textMarks).toBeGreaterThan(2500); // the fixture is the whole 38-line bill
    expect(m.lost).toBe(0);
    expect(m.merged).toBe(0);
    expect(m.hairlinePercent).toBeLessThan(dots === 384 ? 1.2 : 0.7); // measured 1.03 / 0.56; the S6 printout had 16 / 12
  });

  it("the fixtures are the expected renders (a new font or layout means re-measuring, not loosening the bounds)", () => {
    expect(fixture(384).h).toBe(2127);
    expect(fixture(576).h).toBe(2056);
  });
});
