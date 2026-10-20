import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_PULL_EVERY_MS, changedTables, planPull, startSyncLoop, stopSyncLoop, type SyncNowOptions, type VisibilitySource } from "./sync";

// KB-345 (owner, 20 Oct 2026; D90): the sync loop asks ONE cheap question every 15 s (sync_probe) and pulls only what
// moved, plus a full cycle about every 5 minutes; it stops while the app is hidden (one last push first) and runs at once
// on return. Measured before: 12 requests per cycle = ~2,900 requests an hour per open phone, idle.

const T0 = "2026-10-20T10:00:00.000Z";
const T1 = "2026-10-20T10:00:05.000Z";
const snap = (over: Record<string, unknown> = {}) => ({
  bills: T0, bill_cancellations: null, bill_metrics: T0, shop_products: T0, shops: T0, receipt_number_blocks: [1, 50], learning: T0, ...over,
});

describe("changedTables - what the probe says moved", () => {
  it("no baseline (the first cycle): everything", () => {
    expect([...changedTables(null, snap())].sort()).toEqual(["bill_cancellations", "bill_metrics", "bills", "learning", "receipt_number_blocks", "shop_products", "shops"]);
  });
  it("nothing moved: nothing", () => {
    expect([...changedTables(snap(), snap())]).toEqual([]);
  });
  it("only the tables whose stamp moved", () => {
    expect([...changedTables(snap(), snap({ bills: T1 }))]).toEqual(["bills"]);
    expect([...changedTables(snap(), snap({ bill_cancellations: T1, learning: T1 }))].sort()).toEqual(["bill_cancellations", "learning"]);
  });
  it("a new receipt-number block (count or highest block_end) is a change", () => {
    expect([...changedTables(snap(), snap({ receipt_number_blocks: [2, 100] }))]).toEqual(["receipt_number_blocks"]);
  });
  it("a table that appears in the answer for the first time (null -> stamp) is a change", () => {
    expect([...changedTables(snap(), snap({ bill_cancellations: T1 }))]).toEqual(["bill_cancellations"]);
  });
});

describe("planPull - full pull, some tables, or none", () => {
  const base = { prev: snap(), next: snap(), lastFullAt: 1_000_000, now: 1_000_000 + 15_000, probeBlockedUntil: 0 };
  it("a quiet cycle pulls nothing (one request, the probe)", () => {
    expect(planPull(base)).toEqual({ kind: "some", tables: new Set() });
  });
  it("a moved table is pulled alone", () => {
    expect(planPull({ ...base, next: snap({ bills: T1 }) })).toEqual({ kind: "some", tables: new Set(["bills"]) });
  });
  it("every ~5 minutes a full pull runs even when nothing moved (a late-committing row carries an older stamp)", () => {
    expect(planPull({ ...base, now: base.lastFullAt + FULL_PULL_EVERY_MS }).kind).toBe("all");
    expect(planPull({ ...base, now: base.lastFullAt + FULL_PULL_EVERY_MS - 1 }).kind).toBe("some");
    expect(FULL_PULL_EVERY_MS).toBe(5 * 60_000);
  });
  it("no baseline yet, or the probe failed: a full pull (the old behaviour)", () => {
    expect(planPull({ ...base, prev: null }).kind).toBe("all");
    expect(planPull({ ...base, next: null }).kind).toBe("all");
  });
  it("a probe that is known to be missing on the server is not asked again for a while", () => {
    expect(planPull({ ...base, next: null, now: base.now, probeBlockedUntil: base.now + 1 }).kind).toBe("all");
  });
});

describe("the loop's schedule", () => {
  const options = { localDb: {} as never, shopId: "s", deviceId: "d" } as SyncNowOptions;
  let hidden: boolean;
  let listeners: Array<() => void>;
  let doc: VisibilitySource;
  let calls: Array<{ pull: string | undefined; at: number }>;
  const cycle = vi.fn(async (o: SyncNowOptions) => {
    calls.push({ pull: o.pull, at: Date.now() });
    return { anyTransientFailure: false };
  });
  const online = { addEventListener: () => {}, removeEventListener: () => {} };
  const setHidden = (v: boolean) => {
    hidden = v;
    listeners.forEach((l) => l());
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    listeners = [];
    calls = [];
    cycle.mockClear();
    doc = {
      get hidden() {
        return hidden;
      },
      addEventListener: (_t: "visibilitychange", l: () => void) => void listeners.push(l),
      removeEventListener: (_t: "visibilitychange", l: () => void) => void (listeners = listeners.filter((x) => x !== l)),
    };
  });
  afterEach(() => {
    stopSyncLoop();
    vi.useRealTimers();
  });

  it("open and idle: a probe cycle at once and then every 15 s", async () => {
    startSyncLoop(options, online, doc, { cycle });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.map((c) => c.at - calls[0]!.at)).toEqual([0, 15_000, 30_000, 45_000, 60_000]);
    expect(calls.every((c) => c.pull === "probe")).toBe(true);
  });

  it("hidden: ONE last push (no pull), then nothing at all for an hour", async () => {
    startSyncLoop(options, online, doc, { cycle });
    await vi.advanceTimersByTimeAsync(20_000);
    const before = calls.length;
    setHidden(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.slice(before).map((c) => c.pull)).toEqual(["none"]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls.length).toBe(before + 1);
  });

  it("back in view: a cycle at once, then every 15 s again", async () => {
    startSyncLoop(options, online, doc, { cycle });
    await vi.advanceTimersByTimeAsync(5_000);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(600_000);
    const before = calls.length;
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(before + 1);
    expect(calls[before]!.pull).toBe("probe");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.length).toBe(before + 3);
  });

  it("started while hidden: nothing runs until it is shown", async () => {
    hidden = true;
    startSyncLoop(options, online, doc, { cycle });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.filter((c) => c.pull === "probe")).toHaveLength(0);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.pull === "probe")).toHaveLength(1);
  });

  it("stopping removes the visibility listener", async () => {
    startSyncLoop(options, online, doc, { cycle });
    expect(listeners).toHaveLength(1);
    stopSyncLoop();
    expect(listeners).toHaveLength(0);
  });

  it("requests per phone per hour, idle: the old loop ~2,900; now ~390 open, 0 hidden", () => {
    const FULL_COST = 12; // measured: 12 requests in a full cycle (20 Oct 2026)
    const ticks = (3_600_000 / 15_000);
    const before = ticks * FULL_COST;
    const fulls = 3_600_000 / FULL_PULL_EVERY_MS;
    const after = ticks * 1 + fulls * FULL_COST;
    expect(before).toBe(2880);
    expect(after).toBe(384);
    expect(after / before).toBeLessThan(0.15);
  });
});
