// KB-324: tells History - per shop database (by name) - that the bills pull moved:
// bills landed (at most every 2 s) or the first pull ended. History re-reads its list
// and the saved pull state (sync_state `bills:<shop>`).

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const cooldowns = new Map<string, { pending: boolean; timer: ReturnType<typeof setTimeout> }>();
const THROTTLE_MS = 2000;

export function subscribeBillsPull(dbName: string, listener: Listener): () => void {
  const set = listeners.get(dbName) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(dbName, set);
  return () => {
    set.delete(listener);
  };
}

/**
 * Bills were written - tell History. The first write notifies at once (a cleared phone should show
 * bills in well under a second); writes inside the next 2 s are folded into one notice at its end
 * (a 36,000-bill backfill is 180 pages).
 */
export function noteBillsWritten(dbName: string): void {
  const cooling = cooldowns.get(dbName);
  if (cooling) {
    cooling.pending = true;
    return;
  }
  emitBillsPull(dbName);
  const state = { pending: false, timer: setTimeout(() => endCooldown(dbName), THROTTLE_MS) };
  cooldowns.set(dbName, state);
}

function endCooldown(dbName: string): void {
  const state = cooldowns.get(dbName);
  cooldowns.delete(dbName);
  if (state?.pending) noteBillsWritten(dbName); // one notice for the burst, and a new cooldown
}

export function emitBillsPull(dbName: string): void {
  listeners.get(dbName)?.forEach((l) => l());
}
