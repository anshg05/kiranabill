import { describe, expect, it } from "vitest";
import { DAILY_STOP, pacificDay, transcribeTokens, waitMs, type Sent } from "./quota.js";

// KB-370 (owner, 1 Nov 2026, AI Studio): gemini-3.5-transcribe on Tier 1 = 10 requests a minute, 10,000 tokens a minute, 100 a day
// (reset at midnight Pacific), shared with production - the bake-off stops at 90 a day.

const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + s * 1000);

describe("the transcribe quota", () => {
  it("a call's tokens: 32 a second of audio plus the answer (a 76 s clip is about 2.4K audio tokens)", () => {
    expect(transcribeTokens(76)).toBe(76 * 32 + 76 * 8);
  });

  it("no wait when the last minute is quiet", () => {
    expect(waitMs([], at(0), 3_000)).toBe(0);
  });

  it("at 9 calls in the last minute (10 RPM less a 10% margin) the next waits until the oldest leaves the window", () => {
    const sent: Sent[] = Array.from({ length: 9 }, (_, i) => ({ at: at(i), tokens: 100 }));
    expect(waitMs(sent, at(10), 100)).toBe(50_000 + 1); // the first left at 60 s after 0, i.e. at 60 s; now is 10 s
  });

  it("tokens: a call that fits in the minute's 9,000 (10K less 10%) goes at once", () => {
    const sent: Sent[] = [{ at: at(0), tokens: 2_000 }, { at: at(20), tokens: 2_000 }];
    expect(waitMs(sent, at(25), 3_040)).toBe(0); // 7,040 <= 9,000
  });

  it("... waits when the window would exceed 9,000 tokens", () => {
    const sent: Sent[] = [{ at: at(0), tokens: 4_000 }, { at: at(20), tokens: 4_000 }];
    expect(waitMs(sent, at(25), 3_000)).toBe(35_000 + 1); // the 0 s call must leave first (at 60 s)
  });

  it("the day is the Pacific day (the quota resets at midnight Pacific = 13:30 IST)", () => {
    expect(pacificDay(new Date("2026-11-01T07:59:00Z"))).toBe("2026-11-01"); // 00:59 PDT
    expect(pacificDay(new Date("2026-11-01T06:59:00Z"))).toBe("2026-10-31"); // 23:59 PDT the day before
  });

  it("the bake-off's daily stop leaves production room", () => {
    expect(DAILY_STOP).toBe(90);
  });
});
