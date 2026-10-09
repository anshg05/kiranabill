// KB-401 (docs/07-DECISIONS.md D67 - owner, 9 Oct 2026): a waiting service worker does NOT take over on a plain
// reload while the page is its only client. So, in normal mode, at a SAFE moment (the bill is empty, nothing is open,
// and that has held for SETTLE_MS) the page posts kb-skip-waiting to the waiting worker, then reloads ONCE on
// controllerchange. Nothing activates on its own. The half-built bill survives a reload (D65) but is not relied on:
// "safe" means there is nothing to restore.

export const SETTLE_MS = 5_000;
/** A second reload inside this window is refused: a worker that keeps flapping must not loop the page. */
export const RELOAD_GUARD_MS = 30_000;
export const UPDATE_CHECK_MIN_GAP_MS = 10 * 60_000;
const STAMP_KEY = "kbSwReloadAt";

export interface UpdaterDeps {
  isSafe: () => boolean;
  onSafetyChange: (fn: () => void) => () => void;
  reload: () => void;
  /** Survives a reload (sessionStorage). */
  guard: { get: (key: string) => string | null; set: (key: string, value: string) => void };
  now: () => number;
  checkForUpdate: () => Promise<unknown>;
}

export interface Updater {
  /** A new version finished installing and is waiting. */
  waitingFound: (worker: { postMessage: (message: unknown) => void }) => void;
  controllerChanged: () => void;
  /** A message from the worker (force mode's kb-force). */
  message: (data: unknown) => void;
  /** The app came to the foreground: re-check the safe moment and, at most every 10 minutes, ask for a new version. */
  foreground: () => void;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  let waiting: { postMessage: (message: unknown) => void } | null = null;
  let applying = false; // this page asked the waiting worker to take over
  let pendingReload = false; // ...and the worker did, but the bill was busy at that moment
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCheck = Number.NEGATIVE_INFINITY;

  function reloadOnce(): void {
    const raw = deps.guard.get(STAMP_KEY);
    const last = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(last) && deps.now() - last < RELOAD_GUARD_MS) return;
    deps.guard.set(STAMP_KEY, String(deps.now()));
    deps.reload();
  }

  function evaluate(): void {
    const hasWork = pendingReload || (waiting !== null && !applying);
    if (!hasWork || !deps.isSafe()) {
      if (timer) clearTimeout(timer); // a busy moment starts the settle time over
      timer = null;
      return;
    }
    if (timer) return; // already settling: a foreground event must not push it back
    timer = setTimeout(() => {
      timer = null;
      if (!deps.isSafe()) return;
      if (pendingReload) {
        pendingReload = false;
        reloadOnce();
      } else if (waiting && !applying) {
        applying = true;
        waiting.postMessage({ type: "kb-skip-waiting" });
      }
    }, SETTLE_MS);
  }
  deps.onSafetyChange(evaluate);

  return {
    waitingFound(worker) {
      waiting = worker;
      applying = false;
      pendingReload = false;
      evaluate();
    },
    controllerChanged() {
      if (!applying) return; // the first install's clients.claim(), or another tab's update: not ours to reload for
      if (!deps.isSafe()) {
        pendingReload = true;
        return;
      }
      reloadOnce();
    },
    message(data) {
      if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "kb-force") reloadOnce();
    },
    foreground() {
      evaluate();
      const t = deps.now();
      if (t - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
      lastCheck = t;
      try {
        deps.checkForUpdate().catch(() => undefined); // offline is fine: nothing to learn
      } catch {
        // a throwing check is the same as an offline one
      }
    },
  };
}
