import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteBillsWritten, subscribeBillsPull } from "./billsPullStatus";

// KB-324: History re-reads when pulled bills land - the first page at once (a cleared phone
// should show bills in well under a second), then at most every 2 s (a 36,000-bill backfill is 180 pages).
describe("billsPullStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the first write notifies at once; a burst after it notifies once, 2 s later; quiet again after", () => {
    const seen = vi.fn();
    const off = subscribeBillsPull("db-x", seen);
    noteBillsWritten("db-x");
    expect(seen).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) noteBillsWritten("db-x");
    expect(seen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(seen).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(seen).toHaveBeenCalledTimes(2); // nothing pending - no more
    noteBillsWritten("db-x");
    expect(seen).toHaveBeenCalledTimes(3);
    off();
  });
});
