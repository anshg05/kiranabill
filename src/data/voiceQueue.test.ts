import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "./db";
import { audioOf, blockingForBill, clearBilled, enqueueRecording, markAppended, recordingsForBill, removeRecording, saveOutcome, unsentRecordings } from "./voiceQueue";

// KB-385 step 3 (owner, 10 Nov 2026; doc 25 §6; D33 - a phone database change, additive): the recording is kept ON THE PHONE until its
// bill exists. Retry resends the same recording; offline, it waits here and is sent when the phone is back online; it is added to its
// bill ONCE (a retry, a double tap or a reload never adds the lines twice); a recording not yet in the bill blocks Bill Banao until it is
// sent, typed by hand or removed by the shopkeeper; after Bill Banao the phone's copy is deleted.

const dbs: KiranaBillDB[] = [];
const open = (name = `vq-${crypto.randomUUID()}`) => {
  const db = new KiranaBillDB(name);
  dbs.push(db);
  return db;
};
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

const SHOP = "shop-1";
const rec = (billLocalId = "bill-1", bytes = [1, 2, 3]) => ({ recordingId: crypto.randomUUID(), shopId: SHOP, billLocalId, audio: new Blob([new Uint8Array(bytes)], { type: "audio/webm;codecs=opus" }), recordedMs: 42_000 });

describe("the phone's voice queue", () => {
  it("is version 8 of the phone database, additive", async () => {
    const db = open();
    await db.open();
    expect(db.verno).toBe(8);
    expect(db.tables.map((t) => t.name)).toContain("voiceQueue");
  });

  it("keeps the recording's bytes and type, and survives the app being closed and reopened", async () => {
    const name = `vq-${crypto.randomUUID()}`;
    const r = rec();
    await enqueueRecording(open(name), r);
    dbs[0]!.close();
    const again = open(name);
    const [row] = await recordingsForBill(again, "bill-1");
    expect(row).toMatchObject({ recordingId: r.recordingId, shopId: SHOP, billLocalId: "bill-1", state: "queued", recordedMs: 42_000 });
    const audio = audioOf(row!);
    expect(audio.type).toBe("audio/webm;codecs=opus");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("the same recording queued twice (a double tap) stays ONE row with its first audio", async () => {
    const db = open();
    const r = rec();
    await enqueueRecording(db, r);
    await enqueueRecording(db, { ...r, audio: new Blob([new Uint8Array([9])]) });
    const rows = await recordingsForBill(db, "bill-1");
    expect(rows).toHaveLength(1);
    expect(new Uint8Array(await audioOf(rows[0]!).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("added to its bill ONCE: markAppended is true the first time only", async () => {
    const db = open();
    const r = rec();
    await enqueueRecording(db, r);
    await saveOutcome(db, r.recordingId, { kind: "done", recordingId: r.recordingId, transcript: "दो किलो चीनी", items: [] });
    expect(await markAppended(db, r.recordingId)).toBe(true);
    expect(await markAppended(db, r.recordingId)).toBe(false);
    expect(await markAppended(db, "unknown")).toBe(false);
  });

  it("a recording not yet in its bill BLOCKS Bill Banao - queued, failed, gave up or done-but-not-added; added or removed does not", async () => {
    const db = open();
    const [a, b, c, d] = [rec(), rec(), rec(), rec()];
    for (const r of [a, b, c, d]) await enqueueRecording(db, r);
    await saveOutcome(db, b.recordingId, { kind: "failed", recordingId: b.recordingId, reason: "timeout" });
    await saveOutcome(db, c.recordingId, { kind: "done", recordingId: c.recordingId, transcript: "x", items: [] });
    await markAppended(db, c.recordingId);
    await removeRecording(db, d.recordingId);
    expect((await blockingForBill(db, "bill-1")).map((r) => [r.recordingId, r.state]).sort()).toEqual([[a.recordingId, "queued"], [b.recordingId, "failed"]].sort());
    const failed = (await recordingsForBill(db, "bill-1")).find((r) => r.recordingId === b.recordingId);
    expect(failed?.reason).toBe("timeout");
  });

  it("offline: the queued recordings are the ones sent when the phone is back online (not failed ones - those wait for Retry)", async () => {
    const db = open();
    const [a, b] = [rec(), rec("bill-2")];
    await enqueueRecording(db, a);
    await enqueueRecording(db, b);
    await saveOutcome(db, b.recordingId, { kind: "gave_up", recordingId: b.recordingId });
    expect((await unsentRecordings(db, SHOP)).map((r) => r.recordingId)).toEqual([a.recordingId]);
  });

  it("after Bill Banao: the bill's recordings are deleted from the phone (their ids returned to mark billed); another bill's stay", async () => {
    const db = open();
    const [a, b, other] = [rec(), rec(), rec("bill-2")];
    for (const r of [a, b, other]) await enqueueRecording(db, r);
    expect((await clearBilled(db, "bill-1")).sort()).toEqual([a.recordingId, b.recordingId].sort());
    expect(await recordingsForBill(db, "bill-1")).toEqual([]);
    expect(await recordingsForBill(db, "bill-2")).toHaveLength(1);
  });
});
