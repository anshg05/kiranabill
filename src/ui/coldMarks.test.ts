import { beforeEach, describe, expect, it } from "vitest";
import { coldPhases, markCold, resetColdMarks } from "./coldMarks";

// KB-352 (owner, 28 Oct 2026): app cold start was 3.4 s median / 28 s p95 (budget 2 s). The milestones of a page load are marked as they happen
// (ms since the page began) so the phone can say where the time went: the page, the JS, the sign-in check, the local database, the catalog, the mic.

beforeEach(() => resetColdMarks());

describe("cold start marks", () => {
  it("a milestone is marked once - the FIRST time it happens (a later re-render or a second auth event must not move it)", () => {
    markCold("auth");
    const first = coldPhases().auth;
    expect(typeof first).toBe("number");
    const t = performance.now();
    while (performance.now() - t < 5); // a few ms later
    markCold("auth");
    expect(coldPhases().auth).toBe(first);
  });

  it("only the milestones that happened are present; nothing is invented", () => {
    markCold("js");
    markCold("db");
    expect(Object.keys(coldPhases()).sort()).toEqual(["db", "js"]);
  });

  it("whole milliseconds since the page began, never negative, never NaN", () => {
    for (const m of ["js", "auth", "db", "shop", "catalog", "mic"] as const) markCold(m);
    for (const v of Object.values(coldPhases())) expect(Number.isInteger(v) && v >= 0).toBe(true);
  });
});
