import { describe, expect, it } from "vitest";
import config from "../vite.config";

// Owner, 17 Oct 2026: the official VERIFY run caps the test workers at 3. With the default (one per core) the 117-file suite
// times out UI tests on a busy machine - a different handful each run, all passing alone and with 3 workers (docs 10, 19, 20).
describe("the vitest config", () => {
  it("caps the workers at 3 (the official VERIFY run)", () => {
    expect(config.test?.maxWorkers).toBe(3);
  });
  it("still runs perf alone, after unit (D35)", () => {
    const groups = Object.fromEntries((config.test?.projects ?? []).map((p) => [(p as { test: { name: string; sequence?: { groupOrder: number } } }).test.name, (p as { test: { sequence?: { groupOrder: number } } }).test.sequence?.groupOrder]));
    expect(groups["unit"]).toBeLessThan(groups["perf"]!);
  });
});
