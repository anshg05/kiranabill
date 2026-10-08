// KB-313 (05 §7): what the sync loop is doing, for the header chip. The loop used to expose nothing - a cycle
// returned a result and it was forgotten. Plain module state with subscribe, read by React through
// useSyncExternalStore (so getSyncStatus returns the SAME object until something changes).

export interface SyncStatusState {
  /** A cycle is running right now. */
  syncing: boolean;
  /** Transient failures in a row (a clean cycle, or a "no live session" skip, does not add to it). */
  consecutiveFailures: number;
  /** The last cycle was skipped for want of a live session - the offline-session mode of D38. */
  noSession: boolean;
  lastAttemptAt: string | null;
  lastOkAt: string | null;
}

/** 05 §7: the chip turns amber after this many failures in a row. */
export const FAILURE_THRESHOLD = 3;

const IDLE: SyncStatusState = { syncing: false, consecutiveFailures: 0, noSession: false, lastAttemptAt: null, lastOkAt: null };
let state: SyncStatusState = IDLE;
const listeners = new Set<() => void>();

function set(next: SyncStatusState): void {
  state = next;
  listeners.forEach((l) => l());
}

export const getSyncStatus = (): SyncStatusState => state;

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const isSyncFailing = (s: SyncStatusState): boolean => s.consecutiveFailures >= FAILURE_THRESHOLD;

export function cycleStarted(): void {
  set({ ...state, syncing: true });
}

export function cycleEnded(result: { anyTransientFailure: boolean; skippedNoSession?: boolean; skippedOffline?: boolean }): void {
  const now = new Date().toISOString();
  if (result.skippedOffline) {
    set({ ...state, syncing: false }); // nothing was tried: neither a failure nor a success
  } else if (result.skippedNoSession) {
    set({ ...state, syncing: false, noSession: true, lastAttemptAt: now });
  } else if (result.anyTransientFailure) {
    set({ ...state, syncing: false, noSession: false, consecutiveFailures: state.consecutiveFailures + 1, lastAttemptAt: now });
  } else {
    set({ syncing: false, noSession: false, consecutiveFailures: 0, lastAttemptAt: now, lastOkAt: now });
  }
}

/** A cycle that threw (e.g. the database was closed by sign-out): not syncing any more, and counted as a failure. */
export function cycleThrew(): void {
  set({ ...state, syncing: false, consecutiveFailures: state.consecutiveFailures + 1, lastAttemptAt: new Date().toISOString() });
}

export function resetSyncStatus(): void {
  set(IDLE);
}
