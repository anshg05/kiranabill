// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssFont, loadFonts } from "./receiptImage";
import { DEV_PRINT_BILLS } from "./devPrintBills";

// KB-429 (owner + reviewer, 18 Nov 2026, option A): the share image / PDF and the PRINTED bill (receiptPrint.ts paints with the same
// cssFont) draw Devanagari in Noto Sans Devanagari beside IBM Plex Mono - no Mukta. A canvas does not trigger a font's unicode-range
// subsets by itself, so loadFonts must ask for Noto with the receipt's real strings, or the first image after a reload draws in a
// fallback. Fallback agreed: if the paper test shows faint or broken Hindi, option B (Mukta 400 / 600 for print + share only).

afterEach(() => vi.unstubAllGlobals());

describe("the receipt image's font (share image, PDF, printed bill)", () => {
  it("Plex Mono for Latin and digits, Noto Sans Devanagari for Hindi - never Mukta", () => {
    expect(cssFont({ weight: 600, size: 14 } as never)).toBe('600 14px "IBM Plex Mono", "Noto Sans Devanagari Variable", monospace');
    expect(cssFont({ weight: 400, size: 12 } as never)).not.toMatch(/mukta/i);
  });

  it("loads Plex AND Noto, at every weight it paints, with the bill's own Hindi letters", async () => {
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, "fonts", { configurable: true, value: { load } });
    await loadFonts(DEV_PRINT_BILLS.bill514, [400, 600]);
    const fonts = (load.mock.calls as unknown as [string, string][]).map(([f]) => f).sort();
    expect(fonts).toEqual(['400 14px "IBM Plex Mono"', '400 14px "Noto Sans Devanagari Variable"', '600 14px "IBM Plex Mono"', '600 14px "Noto Sans Devanagari Variable"']);
    const sample = (load.mock.calls as unknown as [string, string][])[0]![1];
    expect(sample).toContain("च"); // चावल - the bill's Devanagari is in the sample
    expect(sample).toContain("₹");
  });
});
