// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/testNumbers";
import { listPhases } from "@/data/phaseTimings";
import { setReviewCapture, listReviewCapture } from "@/data/reviewCapture";
import type { BillRow } from "./useBillLines";
import { useMetricsWiring, type WiringInput } from "./useMetricsWiring";

// KB-404 (D80): the billing screen's measurement wiring, end to end without the screen: turns from the mic, the stop ->
// transcript time handed to the next utterance's report, activity, the Bill Banao snapshot, and the row written AFTER the
// receipt is on screen. A write-only sink: nothing it holds is ever read back into the bill.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`wiring-${crypto.randomUUID()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));
const rowsOf = (t: string): BillRow[] => lines(t).map((l) => ({ id: l.id, utteranceId: 1, item: l.item, original: l.original, displayName: l.displayName, source: "fastpath" as const }));

function setup(over: Partial<WiringInput> = {}) {
  const billLocalId = crypto.randomUUID();
  const base: WiringInput = { localDb: db, shopId, deviceId, billLocalId, ready: true, rows: rowsOf("2 kilo chini"), flags: [], removed: 0, saved: null, ...over };
  return { billLocalId, ...renderHook((p: WiringInput) => useMetricsWiring(p), { initialProps: base }), base };
}
async function save(billLocalId: string) {
  await finaliseBill(db, { localId: billLocalId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [] });
}

describe("one voice bill, end to end", () => {
  it("a turn, its stop -> transcript time, the utterance report, Bill Banao, the receipt: ONE row with all of it", async () => {
    const { billLocalId, result, rerender, base } = setup();
    act(() => result.current.onTurn());
    act(() => result.current.onTranscribed(912));
    act(() => result.current.onUtterance({ path: "fastpath", transcript: "do kilo chini", transcriptToItemsMs: 140, lines: [{ name: "Chini", qty: 2, unit: "kg", rate: 4500, total: 9000 }] }));
    act(() => result.current.beforeFinalise());
    await save(billLocalId);
    rerender({ ...base, saved: { localId: billLocalId } });
    await waitFor(async () => expect(await db.billMetrics.count()).toBe(1));
    const row = (await db.billMetrics.get(billLocalId))!;
    expect(row).toMatchObject({ turns: 1, voiceLines: 1, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, syncStatus: "pending", deviceId, shopId });
    expect(row.utterances).toEqual([{ path: "fastpath", stopToTranscriptMs: 912, transcriptToItemsMs: 140 }]);
    expect(Number.isInteger(row.finaliseToReceiptMs)).toBe(true);
    expect(Number.isInteger(row.secondsToBill)).toBe(true);
    expect(row.numberMs).toBeNull(); // no server number for this bill
  });

  it("KB-352: the paint phase is written with the save's phases (number wait, local write, receipt read) - device-only, per bill", async () => {
    const { billLocalId, result, rerender, base } = setup();
    act(() => result.current.beforeFinalise());
    await save(billLocalId);
    rerender({ ...base, saved: { localId: billLocalId, phases: { numberWaitMs: 170, writeMs: 12, readMs: 4, savedAtMs: performance.now() } } });
    await waitFor(async () => expect((await listPhases(db)).length).toBe(1));
    const row = (await listPhases(db))[0]!;
    expect(row).toMatchObject({ billLocalId, number: 170, write: 12, read: 4 });
    expect(Number.isFinite(row.paint) && row.paint! >= 0).toBe(true);
  });

  it("KB-351: the server round trip for the bill number is written with the bill's row (number_ms); an offline-numbered bill has none", async () => {
    const { billLocalId, result, rerender, base } = setup();
    act(() => result.current.beforeFinalise());
    await save(billLocalId);
    rerender({ ...base, saved: { localId: billLocalId, numberMs: 123.4 } });
    await waitFor(async () => expect(await db.billMetrics.count()).toBe(1));
    expect((await db.billMetrics.get(billLocalId))!.numberMs).toBe(123); // a whole number of ms
  });

  it("a failed utterance is counted as one that never reached the bill, and the stop time is not reused by the next utterance", async () => {
    const { billLocalId, result, rerender, base } = setup();
    act(() => result.current.onTurn());
    act(() => result.current.onTranscribed(800));
    act(() => result.current.onUtterance({ path: "failed", transcript: "x", transcriptToItemsMs: null, lines: [] }));
    act(() => result.current.onTurn());
    act(() => result.current.onUtterance({ path: "fastpath", transcript: "y", transcriptToItemsMs: 100, lines: [] })); // no onTranscribed this time
    act(() => result.current.beforeFinalise());
    await save(billLocalId);
    rerender({ ...base, saved: { localId: billLocalId } });
    await waitFor(async () => expect(await db.billMetrics.count()).toBe(1));
    const row = (await db.billMetrics.get(billLocalId))!;
    expect(row.turns).toBe(2);
    expect(row.notAdded).toBe(1);
    expect(row.utterances.map((u) => [u.path, u.stopToTranscriptMs])).toEqual([["failed", 800], ["fastpath", null]]);
  });

  it("nothing is written before the receipt is on screen, and never for a bill that was not finalised through here", async () => {
    const { billLocalId, result } = setup();
    act(() => result.current.onTurn());
    await new Promise((r) => setTimeout(r, 60));
    expect(await db.billMetrics.count()).toBe(0);
    act(() => result.current.beforeFinalise());
    await new Promise((r) => setTimeout(r, 60));
    expect(await db.billMetrics.count()).toBe(0); // Bill Banao tapped but the bill is not saved yet
    expect(await db.bills.get(billLocalId)).toBeUndefined();
  });

  it("a saved bill that is not the one Bill Banao was tapped for writes nothing", async () => {
    const { result, rerender, base } = setup();
    act(() => result.current.beforeFinalise());
    const other = crypto.randomUUID();
    await save(other);
    rerender({ ...base, saved: { localId: other } });
    await new Promise((r) => setTimeout(r, 80));
    expect(await db.billMetrics.count()).toBe(0);
  });

  it("the snapshot reads the rows at the Bill Banao tap: hand lines are counted, not voice lines", async () => {
    const hand: BillRow[] = rowsOf("2 kilo chini").map((r) => ({ ...r, source: "manual" as const }));
    const { billLocalId, result, rerender, base } = setup({ rows: hand });
    act(() => result.current.onUtterance({ path: "fastpath", transcript: "t", transcriptToItemsMs: 1, lines: [] }));
    act(() => result.current.beforeFinalise());
    await save(billLocalId);
    rerender({ ...base, rows: hand, saved: { localId: billLocalId } });
    await waitFor(async () => expect(await db.billMetrics.count()).toBe(1));
    expect(await db.billMetrics.get(billLocalId)).toMatchObject({ voiceLines: 0, manualLines: 1 });
  });
});

describe("the review capture rides on the same reports", () => {
  it("off by default: no pair is kept; on: the heard words and the billed lines are", async () => {
    const { billLocalId, result } = setup();
    act(() => result.current.onUtterance({ path: "fastpath", transcript: "do kilo chini", transcriptToItemsMs: 1, lines: [{ name: "Chini", qty: 2, unit: "kg", rate: 4500, total: 9000 }] }));
    await new Promise((r) => setTimeout(r, 40));
    expect(await listReviewCapture(db, shopId)).toEqual([]);
    await act(async () => setReviewCapture(db, shopId, true));
    act(() => result.current.onUtterance({ path: "fastpath", transcript: "ek kilo besan", transcriptToItemsMs: 1, lines: [] }));
    await waitFor(async () => expect(await listReviewCapture(db, shopId)).toHaveLength(1));
    expect((await listReviewCapture(db, shopId))[0]).toMatchObject({ transcript: "ek kilo besan", billLocalId, path: "fastpath" });
  });

  it("reviewOn follows the switch (the billing screen's badge)", async () => {
    const { result } = setup();
    expect(result.current.reviewOn).toBe(false);
    await act(async () => setReviewCapture(db, shopId, true));
    await waitFor(() => expect(result.current.reviewOn).toBe(true));
    await act(async () => setReviewCapture(db, shopId, false));
    await waitFor(() => expect(result.current.reviewOn).toBe(false));
  });

  it("a capture older than 30 days is purged when the screen starts", async () => {
    await db.reviewCapture.add({ shopId, billLocalId: "b", capturedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(), transcript: "old", path: "voice", lines: [] });
    await db.reviewCapture.add({ shopId, billLocalId: "b", capturedAt: new Date().toISOString(), transcript: "new", path: "voice", lines: [] });
    setup();
    await waitFor(async () => expect((await db.reviewCapture.toArray()).map((r) => r.transcript)).toEqual(["new"]));
  });
});

describe("a listener failure never reaches the bill", () => {
  it("with no database (offline-session edge) every call is a harmless no-op", () => {
    const { result } = setup({ localDb: null, shopId: null, deviceId: null });
    expect(() => {
      act(() => result.current.onTurn());
      act(() => result.current.onUtterance({ path: "failed", transcript: "t", transcriptToItemsMs: null, lines: [] }));
      act(() => result.current.beforeFinalise());
    }).not.toThrow();
  });
});
