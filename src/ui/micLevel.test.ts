import { describe, expect, it } from "vitest";
import { BARS, pushScale, rmsOf, scaleOf, stillScales } from "./micLevel";

// KB-413 step 2 (owner, answer 5): 09's bars follow the real mic level - the sums that turn a frame of sound into a bar.
describe("micLevel", () => {
  it("rmsOf: silence (all 128) is 0; a full-scale square wave is ~1; an empty frame is 0", () => {
    expect(rmsOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsOf(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 255)))).toBeGreaterThan(0.99);
    expect(rmsOf(new Uint8Array(0))).toBe(0);
  });
  it("scaleOf: .35 for silence (the file's low point), 1 at a loud voice and above, in between proportionally; never outside", () => {
    expect(scaleOf(0)).toBe(0.35);
    expect(scaleOf(0.2)).toBe(1);
    expect(scaleOf(5)).toBe(1);
    expect(scaleOf(-1)).toBe(0.35);
    expect(scaleOf(0.1)).toBeCloseTo(0.675);
  });
  it("pushScale: the newest on the right, the oldest drops off the left, the length stays", () => {
    const s = pushScale(stillScales(), 1);
    expect(s).toHaveLength(BARS);
    expect(s.at(-1)).toBe(1);
    expect(s[0]).toBe(0.35);
    expect(pushScale([1, 2, 3], 4)).toEqual([2, 3, 4]);
  });
});
