import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AFTER_SAVE_STEP_CAP_MS, runAfterSave } from "./afterSave";

// KB-352 (owner, 28 Oct 2026): on the phone a VOICE bill took 19.3 s from Bill Banao to the receipt. Everything that is not the number, the
// one local write and the receipt - learning, the catalog reload, sync - now runs AFTER the receipt has painted, one step at a time,
// each in idle time, never awaited by finalise. A step that hangs or fails never stops the next, and each is timed for the panel.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const noYield = () => Promise.resolve();

describe("runAfterSave", () => {
  it("nothing runs synchronously - the first step waits for an idle moment", async () => {
    const learn = vi.fn(async () => 1);
    const idle = vi.fn(() => new Promise<void>(() => {})); // never idle
    void runAfterSave({ learn, reload: () => {}, sync: async () => {} }, () => {}, idle);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(learn).not.toHaveBeenCalled();
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("learning, then the catalog reload, then sync - in that order, each after its own idle moment", async () => {
    const seen: string[] = [];
    const idle = vi.fn(async () => void seen.push("idle"));
    await runAfterSave(
      { learn: async () => void seen.push("learn"), reload: () => void seen.push("reload"), sync: async () => void seen.push("sync") },
      () => {},
      idle,
    );
    expect(seen).toEqual(["idle", "learn", "idle", "reload", "idle", "sync"]);
  });

  it("each step's time is recorded: learning, reload, sync", async () => {
    const got: Record<string, number> = {};
    await runAfterSave(
      { learn: async () => {}, reload: () => {}, sync: async () => {} },
      (p) => Object.assign(got, p),
      noYield,
    );
    expect(Object.keys(got).sort()).toEqual(["learning", "reload", "sync"]);
    expect(Object.values(got).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });

  it("a failing step never stops the next ones", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();
    const sync = vi.fn(async () => {});
    await runAfterSave({ learn: async () => Promise.reject(new Error("boom")), reload, sync }, () => {}, noYield);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a step that NEVER finishes is given up on after the cap - the reload and the sync still run", async () => {
    const reload = vi.fn();
    const sync = vi.fn(async () => {});
    const got: Record<string, number> = {};
    const p = runAfterSave({ learn: () => new Promise(() => {}), reload, sync }, (x) => Object.assign(got, x), noYield);
    await vi.advanceTimersByTimeAsync(AFTER_SAVE_STEP_CAP_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(got.learning).toBeGreaterThanOrEqual(AFTER_SAVE_STEP_CAP_MS);
  });
});
