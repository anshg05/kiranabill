import { describe, expect, it } from "vitest";
import { syncChip } from "./syncChip";
import type { SyncStatusState } from "@/data/syncStatus";

// KB-313 (05 §7): the header chip. Never blocks billing; offline first, then "no session", then failing, then syncing.
const status = (over: Partial<SyncStatusState> = {}): SyncStatusState => ({ syncing: false, consecutiveFailures: 0, noSession: false, lastAttemptAt: null, lastOkAt: null, ...over });
const counts = (pending = 0, conflict = 0) => ({ pending, conflict });

describe("syncChip", () => {
  it("nothing to say: no chip", () => {
    expect(syncChip({ online: true, status: status(), unsynced: counts() })).toBeNull();
  });

  it("offline: a grey 'Offline' chip, whatever else is going on", () => {
    expect(syncChip({ online: false, status: status({ consecutiveFailures: 5, noSession: true }), unsynced: counts(2, 1) })).toEqual({ kind: "offline", label: "Offline" });
  });

  it("online but no live session: 'Not syncing — sign in again' (the offline-session indicator)", () => {
    expect(syncChip({ online: true, status: status({ noSession: true }), unsynced: counts(1) })).toEqual({ kind: "nosession", label: "Not syncing — sign in again" });
  });

  it("amber 'Sync failing' after 3 failures in a row", () => {
    expect(syncChip({ online: true, status: status({ consecutiveFailures: 2 }), unsynced: counts(1) })).toBeNull();
    expect(syncChip({ online: true, status: status({ consecutiveFailures: 3 }), unsynced: counts(1) })).toEqual({ kind: "failing", label: "Sync failing" });
  });

  it("amber when a bill is in a permanent conflict, even with no failures", () => {
    expect(syncChip({ online: true, status: status(), unsynced: counts(0, 1) })).toEqual({ kind: "failing", label: "Sync failing" });
  });

  it("'Syncing…' only while a cycle runs AND something is waiting - an idle shop never flickers", () => {
    expect(syncChip({ online: true, status: status({ syncing: true }), unsynced: counts(0) })).toBeNull();
    expect(syncChip({ online: true, status: status({ syncing: true }), unsynced: counts(2) })).toEqual({ kind: "syncing", label: "Syncing…" });
  });
});
