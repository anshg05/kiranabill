import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "./db";
import { clearRecordingDraft, loadRecordingDraft, saveRecordingDraft } from "./recordingDraft";
import { enqueueRecording } from "./voiceQueue";

// KB-413 step 2 (owner, 15 Nov 2026, answer 1; D33 - a phone database change, additive): a stopped recording is saved ON THE PHONE the
// moment it stops (Stop, the 5:00 limit, the app going to the background), so screen 10 survives the app closing. It is deleted when it
// is discarded or re-recorded, and when Generate bill moves it into the voice queue (in the same write - never both, never neither).

const dbs: KiranaBillDB[] = [];
const open = (name = `rd-${crypto.randomUUID()}`) => {
  const db = new KiranaBillDB(name);
  dbs.push(db);
  return db;
};
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

const SHOP = "shop-1";
const audio = (bytes = [1, 2, 3]) => new Blob([new Uint8Array(bytes)], { type: "audio/webm;codecs=opus" });

describe("the stopped recording, saved on the phone", () => {
  it("is version 9 of the phone database, a new store (additive)", async () => {
    const db = open();
    await db.open();
    expect(db.verno).toBe(9);
    expect(db.tables.map((t) => t.name)).toEqual(expect.arrayContaining(["voiceQueue", "recordingDraft"]));
  });

  it("survives the app being closed and reopened: the same bytes, type, length and why it stopped", async () => {
    const name = `rd-${crypto.randomUUID()}`;
    await saveRecordingDraft(open(name), { shopId: SHOP, audio: audio(), recordedMs: 300_000, stopped: "limit" });
    dbs[0]!.close();
    const back = await loadRecordingDraft(open(name), SHOP);
    expect(back).toMatchObject({ recordedMs: 300_000, stopped: "limit" });
    expect(back!.audio.type).toBe("audio/webm;codecs=opus");
    expect(new Uint8Array(await back!.audio.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("one per shop: a new stop replaces the last one; another shop's is its own; none = null", async () => {
    const db = open();
    await saveRecordingDraft(db, { shopId: SHOP, audio: audio([1]), recordedMs: 5_000 });
    await saveRecordingDraft(db, { shopId: SHOP, audio: audio([2]), recordedMs: 6_000 });
    await saveRecordingDraft(db, { shopId: "shop-2", audio: audio([3]), recordedMs: 7_000 });
    expect((await loadRecordingDraft(db, SHOP))!.recordedMs).toBe(6_000);
    expect((await loadRecordingDraft(db, SHOP))!.stopped).toBeUndefined();
    expect((await loadRecordingDraft(db, "shop-2"))!.recordedMs).toBe(7_000);
    expect(await loadRecordingDraft(db, "shop-3")).toBeNull();
  });

  it("discarded / re-recorded: deleted (only that shop's)", async () => {
    const db = open();
    await saveRecordingDraft(db, { shopId: SHOP, audio: audio(), recordedMs: 5_000 });
    await saveRecordingDraft(db, { shopId: "shop-2", audio: audio(), recordedMs: 5_000 });
    await clearRecordingDraft(db, SHOP);
    expect(await loadRecordingDraft(db, SHOP)).toBeNull();
    expect(await loadRecordingDraft(db, "shop-2")).not.toBeNull();
  });

  it("Generate bill: moving it into the voice queue deletes the saved copy in the same write (10 never comes back for a sent recording)", async () => {
    const db = open();
    await saveRecordingDraft(db, { shopId: SHOP, audio: audio(), recordedMs: 5_000 });
    await enqueueRecording(db, { recordingId: crypto.randomUUID(), shopId: SHOP, billLocalId: "bill-1", audio: audio(), recordedMs: 5_000 });
    expect(await loadRecordingDraft(db, SHOP)).toBeNull();
    expect(await db.voiceQueue.count()).toBe(1);
  });
});
