import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "./db";
import { VOICE_TIMINGS_KEEP, listVoiceTimings, recordVoiceTiming, type VoiceTimingRow } from "./voiceTimings";

// KB-352: the split of stop -> transcript for each voice turn, kept on this phone only (the meta table - never synced, no migration).

let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`voicet-${crypto.randomUUID()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const row = (over: Partial<VoiceTimingRow> = {}): VoiceTimingRow => ({
  at: "2026-10-28T10:00:00.000Z", audioBytes: 24_000, audioType: "audio/webm;codecs=opus", stopToBlobMs: 40, requestMs: 1900, bodyMs: 3, totalMs: 2100,
  server: { auth: 210, limit: 5, form: 9, groq: 420, total: 700 }, region: "us-east-2", groqRegion: null, ...over,
});

describe("voice timings (device-only)", () => {
  it("rows are kept in order, whole numbers only", async () => {
    await recordVoiceTiming(db, row({ requestMs: 1900.6 }));
    await recordVoiceTiming(db, row({ at: "2026-10-28T10:01:00.000Z", requestMs: 1200 }));
    const rows = await listVoiceTimings(db);
    expect(rows.map((r) => r.requestMs)).toEqual([1901, 1200]);
  });

  it("only the last turns are kept", async () => {
    for (let i = 0; i < VOICE_TIMINGS_KEEP + 3; i++) await recordVoiceTiming(db, row({ at: `2026-10-28T10:${String(i % 60).padStart(2, "0")}:00.000Z`, totalMs: i }));
    const rows = await listVoiceTimings(db);
    expect(rows).toHaveLength(VOICE_TIMINGS_KEEP);
    expect(rows[0]!.totalMs).toBe(3);
  });

  it("not a number is dropped (NaN, negative); junk in the store reads as nothing; a failed write is swallowed", async () => {
    await recordVoiceTiming(db, row({ stopToBlobMs: Number.NaN, bodyMs: -1, server: { auth: Number.NaN, total: 650 } }));
    const [r] = await listVoiceTimings(db);
    expect(r).not.toHaveProperty("stopToBlobMs");
    expect(r).not.toHaveProperty("bodyMs");
    expect(r!.server).toEqual({ total: 650 });
    await db.meta.put({ key: "voiceTimings", value: "{nope" });
    expect(await listVoiceTimings(db)).toEqual([]);
    db.close();
    await expect(recordVoiceTiming(db, row())).resolves.toBeUndefined();
  });

  it("no transcript, no name and no URL can be kept: only the fields of a row are written", async () => {
    await recordVoiceTiming(db, { ...row(), transcript: "do kilo chini", url: "https://x" } as never);
    const text = JSON.stringify(await listVoiceTimings(db));
    expect(text).not.toContain("chini");
    expect(text).not.toContain("https");
  });
});
