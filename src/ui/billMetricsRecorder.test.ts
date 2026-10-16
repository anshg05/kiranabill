import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "@/data/db";
import { IDLE_CAP_MS, activeSeconds } from "@/domain/billMetrics";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { editRate } from "@/domain/billEdit";
import { BillMetricsRecorder, finaliseSnapshot, loadRecorder, saveRecorder } from "./billMetricsRecorder";
import type { BillRow } from "./useBillLines";

// KB-404 (D80): one bill's measurements, accumulated in memory and kept with the draft (a reload mid-bill loses nothing).
// Definitions: a turn = a recording that reached transcription (success or failure); Retry is not a turn; seconds-to-bill =
// first activity to Bill Banao with any idle gap capped at 60 s.

describe("BillMetricsRecorder", () => {
  it("seconds follow the same idle-cap rule as activeSeconds, event by event", () => {
    const r = new BillMetricsRecorder("b1");
    const stamps = [0, 4_000, 4_000 + 3_600_000, 4_000 + 3_600_000 + 6_000];
    for (const t of stamps) r.touch(t);
    expect(r.seconds(stamps.at(-1)!)).toBe(activeSeconds(stamps));
    expect(r.seconds(stamps.at(-1)!)).toBe(4 + 60 + 6);
  });

  it("the Bill Banao tap counts: seconds(now) includes the last gap, capped", () => {
    const r = new BillMetricsRecorder("b1");
    r.touch(0);
    expect(r.seconds(10_000)).toBe(10);
    expect(r.seconds(10 * IDLE_CAP_MS)).toBe(60);
  });

  it("nothing yet: 0 seconds; one touch alone: 0", () => {
    const r = new BillMetricsRecorder("b1");
    expect(r.seconds(5_000)).toBe(0);
    r.touch(1_000);
    expect(r.seconds(1_000)).toBe(0);
  });

  it("turns: one per recording that reached transcription - a failed transcription counts, a Retry (not a turn call) does not", () => {
    const r = new BillMetricsRecorder("b1");
    r.turn(1_000);
    r.turn(2_000); // transcription failed: still a turn
    expect(r.state.turns).toBe(2);
    r.notAddedSeen(); // Retry / dismiss of a not-added entry is not a turn
    expect(r.state.turns).toBe(2);
    expect(r.state.notAdded).toBe(1);
  });

  it("utterances are kept in order; every call is also activity", () => {
    const r = new BillMetricsRecorder("b1");
    r.utterance({ path: "fastpath", stopToTranscriptMs: 900, transcriptToItemsMs: 120 }, 1_000);
    r.utterance({ path: "failed", stopToTranscriptMs: 1_100, transcriptToItemsMs: null }, 5_000);
    expect(r.state.utterances.map((u) => u.path)).toEqual(["fastpath", "failed"]);
    expect(r.seconds(5_000)).toBe(4);
  });

  it("serialises to numbers and enums only - no text of any kind", () => {
    const r = new BillMetricsRecorder("b1");
    r.turn(1);
    r.utterance({ path: "voice", stopToTranscriptMs: 1500, transcriptToItemsMs: 2200 }, 2);
    expect(Object.keys(r.state).sort()).toEqual(["activeMs", "billLocalId", "firstAt", "lastAt", "notAdded", "turns", "utterances"]);
    for (const u of r.state.utterances) expect(Object.keys(u).sort()).toEqual(["path", "stopToTranscriptMs", "transcriptToItemsMs"]);
  });
});

describe("kept with the draft", () => {
  let db: KiranaBillDB;
  beforeEach(() => {
    db = new KiranaBillDB(`recorder-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("save then load gives the same state for the same bill; a different bill starts fresh", async () => {
    const r = new BillMetricsRecorder("bill-1");
    r.turn(1_000);
    r.utterance({ path: "fastpath", stopToTranscriptMs: 800, transcriptToItemsMs: 90 }, 3_000);
    await saveRecorder(db, "shop-1", r);
    const back = await loadRecorder(db, "shop-1", "bill-1");
    expect(back.state).toEqual(r.state);
    expect((await loadRecorder(db, "shop-1", "bill-2")).state).toEqual(new BillMetricsRecorder("bill-2").state);
  });

  it("per shop: another shop's saved recorder is never loaded", async () => {
    const r = new BillMetricsRecorder("bill-1");
    r.turn(1);
    await saveRecorder(db, "shop-1", r);
    expect((await loadRecorder(db, "shop-2", "bill-1")).state.turns).toBe(0);
  });

  it("damaged stored text is ignored, not fatal", async () => {
    await db.meta.put({ key: "billMetricsDraft:shop-1", value: "{not json" });
    expect((await loadRecorder(db, "shop-1", "bill-1")).state.turns).toBe(0);
  });
});

// What the screen counts at Bill Banao - from the rows as they stand, never from anything a metric produced.
describe("finaliseSnapshot", () => {
  const item = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG)![0]!;
  const row = (id: string, source: BillRow["source"], t = "2 kilo chini", edit = false): BillRow => {
    const original = item(t);
    const edited = edit ? (() => { const r = editRate(original, "48"); if (!r.ok) throw new Error(r.error); return r.item; })() : original;
    return { id, utteranceId: 1, item: edited, original, displayName: "Chini", source };
  };

  it("voice lines (fast path or Layer 2), hand lines, edited voice lines, removed lines, flags", () => {
    const rows = [row("a", "fastpath"), row("b", "voice", "2 kilo chini", true), row("c", "manual"), row("d", "manual", "2 kilo chini", true)];
    expect(finaliseSnapshot(rows, [{ acknowledged: true }, { acknowledged: false }, { acknowledged: true }], 2, 1)).toEqual({
      voiceLines: 2, editedLines: 1, manualLines: 2, removedLines: 2, notAdded: 1, flagsRaised: 3, flagsAcknowledged: 2,
    });
  });

  it("an untouched all-voice bill has no edits, no hand lines, nothing removed", () => {
    expect(finaliseSnapshot([row("a", "fastpath"), row("b", "fastpath")], [], 0, 0)).toEqual({
      voiceLines: 2, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0,
    });
  });

  it("an edit on a HAND line is not counted as a voice edit (hand lines are out of the zero-edit count)", () => {
    expect(finaliseSnapshot([row("a", "manual", "2 kilo chini", true)], [], 0, 0).editedLines).toBe(0);
  });
});
