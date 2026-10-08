import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAILURE_THRESHOLD, cycleEnded, cycleStarted, getSyncStatus, isSyncFailing, resetSyncStatus, subscribeSyncStatus } from "./syncStatus";

// KB-313: what the sync loop is doing, kept for the header chip (05 §7). The loop used to expose nothing.
describe("syncStatus", () => {
  beforeEach(() => resetSyncStatus());

  it("starts idle: not syncing, no failures, never tried", () => {
    expect(getSyncStatus()).toEqual({ syncing: false, consecutiveFailures: 0, noSession: false, lastAttemptAt: null, lastOkAt: null });
  });

  it("a cycle is 'syncing' from its start to its end", () => {
    cycleStarted();
    expect(getSyncStatus().syncing).toBe(true);
    cycleEnded({ anyTransientFailure: false });
    expect(getSyncStatus().syncing).toBe(false);
  });

  it("failures count in a row; one clean cycle clears them; the chip turns failing at the threshold, not before", () => {
    for (let i = 1; i < FAILURE_THRESHOLD; i++) {
      cycleStarted();
      cycleEnded({ anyTransientFailure: true });
      expect(isSyncFailing(getSyncStatus())).toBe(false);
    }
    cycleStarted();
    cycleEnded({ anyTransientFailure: true });
    expect(getSyncStatus().consecutiveFailures).toBe(FAILURE_THRESHOLD);
    expect(isSyncFailing(getSyncStatus())).toBe(true);
    cycleStarted();
    cycleEnded({ anyTransientFailure: false });
    expect(getSyncStatus().consecutiveFailures).toBe(0);
    expect(isSyncFailing(getSyncStatus())).toBe(false);
    expect(getSyncStatus().lastOkAt).not.toBeNull();
  });

  it("a cycle skipped for want of a live session is 'no session' - not a failure (the offline-session indicator, D38)", () => {
    cycleStarted();
    cycleEnded({ anyTransientFailure: true, skippedNoSession: true });
    expect(getSyncStatus()).toMatchObject({ noSession: true, consecutiveFailures: 0 });
    cycleStarted();
    cycleEnded({ anyTransientFailure: false });
    expect(getSyncStatus().noSession).toBe(false);
  });

  it("a cycle skipped because the browser is offline changes nothing but 'not syncing' - not a failure, not a success", () => {
    cycleStarted();
    cycleEnded({ anyTransientFailure: true });
    cycleStarted();
    cycleEnded({ anyTransientFailure: false, skippedOffline: true });
    expect(getSyncStatus()).toMatchObject({ syncing: false, consecutiveFailures: 1, lastOkAt: null });
  });

  it("listeners hear every change, and stop hearing after unsubscribe", () => {
    const heard = vi.fn();
    const off = subscribeSyncStatus(heard);
    cycleStarted();
    cycleEnded({ anyTransientFailure: false });
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    cycleStarted();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("getSyncStatus returns the same object until something changes (useSyncExternalStore needs that)", () => {
    const a = getSyncStatus();
    expect(getSyncStatus()).toBe(a);
    cycleStarted();
    expect(getSyncStatus()).not.toBe(a);
  });
});
