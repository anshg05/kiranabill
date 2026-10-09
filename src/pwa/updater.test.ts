import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdater, RELOAD_GUARD_MS, SETTLE_MS, UPDATE_CHECK_MIN_GAP_MS, type UpdaterDeps } from "./updater";

// KB-401 (D67 - owner, 9 Oct 2026): a waiting service worker does NOT take over on a plain reload while the page is
// its only client. Normal mode never activates on its own: at a SAFE moment the page tells the waiting worker to
// skipWaiting, then reloads ONCE on controllerchange (with a guard against reload loops).
function setup(over: Partial<UpdaterDeps> = {}) {
  let safe = true;
  const gateListeners = new Set<() => void>();
  const store = new Map<string, string>();
  const waiting = { postMessage: vi.fn() };
  const deps: UpdaterDeps = {
    isSafe: () => safe,
    onSafetyChange: (fn) => {
      gateListeners.add(fn);
      return () => gateListeners.delete(fn);
    },
    reload: vi.fn(),
    guard: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    now: () => Date.now(),
    checkForUpdate: vi.fn(() => Promise.resolve()),
    ...over,
  };
  const updater = createUpdater(deps);
  return {
    updater,
    deps,
    waiting,
    store,
    setSafe(v: boolean) {
      safe = v;
      gateListeners.forEach((fn) => fn());
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("applying a waiting update", () => {
  it("waits for a settled safe moment, then asks the waiting worker to skipWaiting - once", () => {
    const s = setup();
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(s.waiting.postMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.waiting.postMessage).toHaveBeenCalledTimes(1);
    expect(s.waiting.postMessage).toHaveBeenCalledWith({ type: "kb-skip-waiting" });
    vi.advanceTimersByTime(60_000);
    expect(s.waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the bill is busy, however long it waits", () => {
    const s = setup();
    s.setSafe(false);
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(60 * 60_000);
    expect(s.waiting.postMessage).not.toHaveBeenCalled();
    expect(s.deps.reload).not.toHaveBeenCalled();
  });

  it("starts the settle time when the bill becomes empty, and a new busy moment cancels it", () => {
    const s = setup();
    s.setSafe(false);
    s.updater.waitingFound(s.waiting);
    s.setSafe(true);
    vi.advanceTimersByTime(SETTLE_MS - 1000);
    s.setSafe(false); // a new bill is started inside the settle time
    vi.advanceTimersByTime(60_000);
    expect(s.waiting.postMessage).not.toHaveBeenCalled();
    s.setSafe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(s.waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it("a foreground event during the settle time does not push the update back", () => {
    const s = setup();
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS - 1000);
    s.updater.foreground();
    vi.advanceTimersByTime(1000);
    expect(s.waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it("re-checks at the moment of acting, not only when told the bill changed", () => {
    let safe = true;
    const s = setup({ isSafe: () => safe });
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    safe = false; // nobody told the updater
    vi.advanceTimersByTime(1);
    expect(s.waiting.postMessage).not.toHaveBeenCalled();
  });

  it("does nothing when no update is waiting", () => {
    const s = setup();
    s.setSafe(false);
    s.setSafe(true);
    vi.advanceTimersByTime(60_000);
    expect(s.deps.reload).not.toHaveBeenCalled();
  });
});

describe("controllerchange", () => {
  it("does not reload when the page did not ask for an update (first install's clients.claim())", () => {
    const s = setup();
    s.updater.controllerChanged();
    expect(s.deps.reload).not.toHaveBeenCalled();
  });

  it("reloads exactly once after the page applied an update", () => {
    const s = setup();
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS);
    s.updater.controllerChanged();
    s.updater.controllerChanged();
    expect(s.deps.reload).toHaveBeenCalledTimes(1);
  });

  it("holds the reload while the bill is busy and does it at the next safe moment", () => {
    const s = setup();
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS);
    s.setSafe(false); // the shopkeeper started a bill just as the new worker took over
    s.updater.controllerChanged();
    vi.advanceTimersByTime(10 * 60_000);
    expect(s.deps.reload).not.toHaveBeenCalled();
    s.setSafe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(s.deps.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads twice in a row: a reload stamp inside the guard window blocks it (no reload loop)", () => {
    const s = setup();
    s.store.set("kbSwReloadAt", String(Date.now() - 1000)); // 1 s ago; still inside the window after the settle time
    expect(RELOAD_GUARD_MS).toBeGreaterThan(SETTLE_MS + 1000);
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS);
    s.updater.controllerChanged();
    expect(s.deps.reload).not.toHaveBeenCalled();
  });

  it("an old reload stamp does not block", () => {
    const s = setup();
    s.store.set("kbSwReloadAt", String(Date.now() - RELOAD_GUARD_MS - 1000));
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS);
    s.updater.controllerChanged();
    expect(s.deps.reload).toHaveBeenCalledTimes(1);
  });

  it("stamps the reload so the next page can see it", () => {
    const s = setup();
    s.updater.waitingFound(s.waiting);
    vi.advanceTimersByTime(SETTLE_MS);
    s.updater.controllerChanged();
    expect(s.store.get("kbSwReloadAt")).toBe(String(Date.now()));
  });
});

describe("force mode", () => {
  it("a kb-force message reloads at once, even with a bill on screen (the draft restores it)", () => {
    const s = setup();
    s.setSafe(false);
    s.updater.message({ type: "kb-force", cache: "kb-abc" });
    expect(s.deps.reload).toHaveBeenCalledTimes(1);
  });

  it("is still guarded against a reload loop", () => {
    const s = setup();
    s.store.set("kbSwReloadAt", String(Date.now() - 1000));
    s.updater.message({ type: "kb-force", cache: "kb-abc" });
    expect(s.deps.reload).not.toHaveBeenCalled();
  });

  it("ignores any other message", () => {
    const s = setup();
    s.updater.message({ type: "something-else" });
    s.updater.message(null);
    s.updater.message("kb-force");
    expect(s.deps.reload).not.toHaveBeenCalled();
  });
});

describe("checking for a new version", () => {
  it("asks the browser at most once per gap", () => {
    const s = setup();
    s.updater.foreground();
    s.updater.foreground();
    expect(s.deps.checkForUpdate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_MIN_GAP_MS - 1);
    s.updater.foreground();
    expect(s.deps.checkForUpdate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    s.updater.foreground();
    expect(s.deps.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it("a failing check (offline) is swallowed", async () => {
    const s = setup({ checkForUpdate: vi.fn(() => Promise.reject(new Error("offline"))) });
    expect(() => s.updater.foreground()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
