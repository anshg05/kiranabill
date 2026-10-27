import { describe, expect, it } from "vitest";
import {
  IDLE_CAP_MS,
  MIN_TYPED_BASELINE,
  WINDOW_BILLS,
  activeSeconds,
  compareBill,
  gateReport,
  median,
  percentile,
  type BillMetricsRow,
  type GateInput,
} from "./billMetrics";

// KB-404 (D80): the definitions behind the release gate, as pure functions. Numbers only - no customer field exists on
// a metrics row, and nothing here is ever read back into a bill.

describe("activeSeconds - first activity to Bill Banao, an idle gap capped at 60 s", () => {
  it("sums the gaps in seconds", () => {
    expect(activeSeconds([0, 10_000, 25_000])).toBe(25);
  });
  it("a gap over 60 s counts as 60 s - a draft left open an hour is not an hour", () => {
    expect(IDLE_CAP_MS).toBe(60_000);
    expect(activeSeconds([0, 5_000, 5_000 + 3_600_000, 5_000 + 3_600_000 + 4_000])).toBe(5 + 60 + 4);
  });
  it("a gap of exactly 60 s counts as 60; one activity or none is 0 seconds", () => {
    expect(activeSeconds([0, 60_000])).toBe(60);
    expect(activeSeconds([123])).toBe(0);
    expect(activeSeconds([])).toBe(0);
  });
  it("rounds to a whole second (nearest), never negative for out-of-order stamps", () => {
    expect(activeSeconds([0, 1_400])).toBe(1);
    expect(activeSeconds([0, 1_600])).toBe(2);
    expect(activeSeconds([5_000, 1_000])).toBe(0);
  });
});

describe("median and percentile", () => {
  it("median of odd and even counts; null for none", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("nearest-rank percentile", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });
});

let n = 0;
function row(over: Partial<BillMetricsRow> = {}): BillMetricsRow {
  n += 1;
  return {
    billLocalId: `bill-${n}`, deviceId: "dev-a", receiptNumber: `KB-${String(n).padStart(6, "0")}`, totalPaise: 9000, lineCount: 2,
    turns: 1, secondsToBill: 12, utterances: [{ path: "fastpath", stopToTranscriptMs: 900, transcriptToItemsMs: 120 }], finaliseToReceiptMs: 200, numberMs: 120,
    voiceLines: 2, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0, recordedAt: "2026-10-16T10:00:00.000Z", ...over,
  };
}
let t = 0;
const bill = (over: Partial<BillMetricsRow> = {}, extra: Partial<GateInput> = {}): GateInput => {
  t += 1;
  return { metrics: row(over), status: "final", finalizedAt: new Date(Date.UTC(2026, 9, 16, 10, 0, t)).toISOString(), isReissue: false, ...extra };
};

describe("gateReport - the last 20 ELIGIBLE voice bills", () => {
  it("window = the latest 20 eligible voice bills by finalised time; older ones are not in it", () => {
    expect(WINDOW_BILLS).toBe(20);
    const inputs = Array.from({ length: 25 }, (_, i) => bill({ turns: i < 5 ? 3 : 1 })); // the 5 oldest have 3 turns
    const g = gateReport(inputs, []);
    expect(g.voice.n).toBe(20);
    expect(g.turns.median).toBe(1); // the 5 old 3-turn bills fell out of the window
  });

  it("cancelled bills and reissue replacements are excluded from every line", () => {
    const inputs = [bill({ turns: 5 }, { status: "cancelled" }), bill({ turns: 5 }, { isReissue: true }), bill({ turns: 1 }), bill({ turns: 1 }), bill({ turns: 3 })];
    const g = gateReport(inputs, []);
    expect(g.voice.n).toBe(3);
    expect(g.turns.median).toBe(1);
  });

  it("turns: the median over voice bills; a hand-only bill (0 turns) is not a voice bill", () => {
    const g = gateReport([bill({ turns: 1 }), bill({ turns: 1 }), bill({ turns: 2 }), bill({ turns: 0, voiceLines: 0, manualLines: 3, utterances: [] })], []);
    expect(g.voice.n).toBe(3);
    expect(g.turns.median).toBe(1);
  });

  it("fast-path coverage = fastpath / (fastpath + voice); failed utterances are counted apart, never hidden", () => {
    const u = (path: "fastpath" | "voice" | "failed") => ({ path, stopToTranscriptMs: 800, transcriptToItemsMs: path === "failed" ? null : 100 });
    const g = gateReport([bill({ utterances: [u("fastpath"), u("fastpath"), u("voice"), u("failed")] }), bill({ utterances: [u("fastpath"), u("voice")] })], []);
    expect(g.coverage).toEqual({ fastpath: 3, llm: 2, failed: 1, pct: 60 });
  });

  it("zero-edit: no edited, hand, removed or not-added line; a bill with hand lines is OUT of the denominator and shown on its own line", () => {
    const g = gateReport(
      [bill(), bill(), bill({ editedLines: 1 }), bill({ removedLines: 1 }), bill({ notAdded: 1 }), bill({ manualLines: 1, voiceLines: 1 })],
      [],
    );
    expect(g.zeroEdit).toEqual({ zero: 2, of: 5, pct: 40, needingHands: 1 });
  });

  it("latencies: stop -> transcript, and transcript -> items per path (medians and p95)", () => {
    const u = (path: "fastpath" | "voice", stop: number, items: number) => ({ path, stopToTranscriptMs: stop, transcriptToItemsMs: items });
    const g = gateReport([bill({ utterances: [u("fastpath", 1000, 100), u("fastpath", 1200, 300), u("voice", 1500, 2500)] })], []);
    expect(g.latency.stopToTranscript).toEqual({ median: 1200, p95: 1500, n: 3 });
    expect(g.latency.fastpathToItems).toEqual({ median: 200, p95: 300, n: 2 });
    expect(g.latency.llmToItems).toEqual({ median: 2500, p95: 2500, n: 1 });
  });

  it("finalise -> receipt median", () => {
    const g = gateReport([bill({ finaliseToReceiptMs: 100 }), bill({ finaliseToReceiptMs: 300 }), bill({ finaliseToReceiptMs: null })], []);
    expect(g.finaliseToReceipt).toEqual({ median: 200, p95: 300, n: 2 });
  });

  it("an empty window says so: nothing is invented", () => {
    const g = gateReport([], []);
    expect(g.voice.n).toBe(0);
    expect(g.turns.median).toBeNull();
    expect(g.coverage.pct).toBeNull();
    expect(g.zeroEdit.pct).toBeNull();
  });
});

describe("gateReport - voice vs typing (a)", () => {
  const typed = (secs: number) => bill({ turns: 0, voiceLines: 0, manualLines: 2, utterances: [], secondsToBill: secs });
  it("typing = eligible hand-only bills (0 turns), timed by the SAME seconds-to-bill rule; both medians with their counts", () => {
    const g = gateReport([bill({ secondsToBill: 10 }), bill({ secondsToBill: 20 }), typed(40), typed(60), typed(50)], []);
    expect(g.seconds.voice).toEqual({ median: 15, n: 2 });
    expect(g.seconds.typed).toEqual({ median: 50, n: 3 });
  });
  it(`with fewer than ${MIN_TYPED_BASELINE} hand-only bills the verdict says so plainly - never a guess`, () => {
    expect(MIN_TYPED_BASELINE).toBe(10);
    const g = gateReport([...Array.from({ length: 12 }, () => bill({ secondsToBill: 10 })), typed(40), typed(50)], []);
    expect(g.seconds.verdict).toBe("Only 2 hand-only bills so far (10 needed) - type a baseline set during the pilot");
  });
  it("with 10+ on both sides: faster / not faster, stated from the medians", () => {
    const fast = gateReport([...Array.from({ length: 10 }, () => bill({ secondsToBill: 10 })), ...Array.from({ length: 10 }, () => typed(40))], []);
    expect(fast.seconds.verdict).toBe("Voice is faster: 10 s against 40 s typing");
    const slow = gateReport([...Array.from({ length: 10 }, () => bill({ secondsToBill: 50 })), ...Array.from({ length: 10 }, () => typed(40))], []);
    expect(slow.seconds.verdict).toBe("Voice is NOT faster: 50 s against 40 s typing");
  });
  it("fewer than 10 voice bills also stops the verdict", () => {
    const g = gateReport([bill({ secondsToBill: 10 }), ...Array.from({ length: 10 }, () => typed(40))], []);
    expect(g.seconds.verdict).toMatch(/Only 1 voice bill/);
  });
  it("a voice bill that also needed a hand-added line is NOT a typing sample", () => {
    const g = gateReport([bill({ secondsToBill: 10, manualLines: 1 }), typed(40)], []);
    expect(g.seconds.typed).toEqual({ median: 40, n: 1 });
  });
  it("a cancelled hand-only bill or a reissue never counts as a typing sample", () => {
    const g = gateReport([typed(10), { ...typed(10), status: "cancelled" as const }, { ...typed(10), isReissue: true }], []);
    expect(g.seconds.typed.n).toBe(1);
  });
});

describe("gateReport - escaped errors (cancelled for wrong item / price / quantity)", () => {
  it("counts cancellations with those reasons; 'customer cancelled' and 'other' are not errors", () => {
    const inputs = [bill(), bill(), bill()];
    const at = inputs[0]!.finalizedAt;
    const g = gateReport(inputs, [
      { reason: "wrong_price", billFinalizedAt: at },
      { reason: "wrong_quantity", billFinalizedAt: at },
      { reason: "wrong_item", billFinalizedAt: at },
      { reason: "customer_cancelled", billFinalizedAt: at },
      { reason: "other", billFinalizedAt: at },
    ]);
    expect(g.escapedErrors).toBe(3);
  });
  it("until the window holds 20 bills, EVERY error cancellation counts - a cancelled bill older than the first eligible one is not forgotten", () => {
    const g = gateReport([bill()], [{ reason: "wrong_price", billFinalizedAt: "2020-01-01T00:00:00.000Z" }]);
    expect(g.escapedErrors).toBe(1);
  });
  it("with a full window, only cancellations of bills finalised since its first bill count", () => {
    const inputs = Array.from({ length: 20 }, () => bill());
    const first = inputs[0]!.finalizedAt;
    const g = gateReport(inputs, [
      { reason: "wrong_price", billFinalizedAt: first },
      { reason: "wrong_price", billFinalizedAt: "2020-01-01T00:00:00.000Z" },
    ]);
    expect(g.escapedErrors).toBe(1);
  });
});

describe("compareBill - 'no bill lost or corrupted' (b)", () => {
  const local = { receiptNumber: "KB-000007", totalPaise: 9000, lineCount: 2, status: "final" as const, syncStatus: "synced" as const };
  const server = { receiptNumber: "KB-000007", totalPaise: 9000, lineCount: 2, status: "final" as const };
  it("equal on the server: no problem", () => expect(compareBill(local, server)).toEqual([]));
  it("missing on the server", () => expect(compareBill(local, null)).toEqual(["is not on the server"]));
  it("a different receipt number, total, item count or status", () => {
    expect(compareBill(local, { ...server, receiptNumber: "KB-000008" })).toEqual(["receipt number differs (KB-000007 here, KB-000008 on the server)"]);
    expect(compareBill(local, { ...server, totalPaise: 9100 })).toEqual(["total differs (9000 paise here, 9100 on the server)"]);
    expect(compareBill(local, { ...server, lineCount: 1 })).toEqual(["item count differs (2 here, 1 on the server)"]);
    expect(compareBill(local, { ...server, status: "cancelled" })).toEqual(["status differs (final here, cancelled on the server)"]);
  });
  it("stuck unsynced is a problem even if the server happens to match", () => {
    expect(compareBill({ ...local, syncStatus: "pending" }, server)).toEqual(["is still waiting to sync"]);
    expect(compareBill({ ...local, syncStatus: "conflict" }, null)).toEqual(["the server refused it (conflict)", "is not on the server"]);
  });
});
