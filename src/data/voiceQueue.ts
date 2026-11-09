import type { KiranaBillDB, LocalVoiceRecording } from "./db";
import type { VoiceJobOutcome } from "./voiceJob";

// KB-385 step 3 (owner, 10 Nov 2026; doc 25 §6, D107): the voice recording stays ON THE PHONE until its bill exists.
//   - Retry resends the same recording (its bytes are here); offline it waits here ("queued") and is sent when the phone is back online.
//   - Added to its bill ONCE: markAppended answers true the first time only - a retry, a double tap or a reload never adds lines twice.
//   - A recording not yet in its bill blocks Bill Banao until it is sent, typed by hand or removed by the shopkeeper (owner, 10 Nov 2026).
//   - After Bill Banao, clearBilled deletes the phone's copies and returns their ids (to mark billed on the server).

export interface NewRecording {
  recordingId: string;
  shopId: string;
  billLocalId: string;
  audio: Blob;
  recordedMs: number;
}

/** Keeps a new recording; the same recording queued again (a double tap) stays one row with its first audio. */
export async function enqueueRecording(db: KiranaBillDB, r: NewRecording): Promise<void> {
  const bytes = await r.audio.arrayBuffer();
  await db.transaction("rw", db.voiceQueue, async () => {
    if (await db.voiceQueue.get(r.recordingId)) return;
    await db.voiceQueue.add({ recordingId: r.recordingId, shopId: r.shopId, billLocalId: r.billLocalId, bytes, mime: r.audio.type, recordedMs: r.recordedMs, createdAt: new Date().toISOString(), state: "queued" });
  });
}

export const audioOf = (row: LocalVoiceRecording): Blob => new Blob([row.bytes], { type: row.mime });

export const recordingsForBill = (db: KiranaBillDB, billLocalId: string) => db.voiceQueue.where("billLocalId").equals(billLocalId).sortBy("createdAt");

/** What the server answered for it. An "appended" recording is never moved back. */
export async function saveOutcome(db: KiranaBillDB, recordingId: string, outcome: VoiceJobOutcome): Promise<void> {
  await db.transaction("rw", db.voiceQueue, async () => {
    const row = await db.voiceQueue.get(recordingId);
    if (!row || row.state === "appended") return;
    if (outcome.kind === "done") await db.voiceQueue.update(recordingId, { state: "done", transcript: outcome.transcript, items: outcome.items, reason: undefined });
    else if (outcome.kind === "failed") await db.voiceQueue.update(recordingId, { state: "failed", reason: outcome.reason });
    else await db.voiceQueue.update(recordingId, { state: "gave_up", reason: undefined });
  });
}

/** True only the FIRST time - the caller adds the lines only then. */
export async function markAppended(db: KiranaBillDB, recordingId: string): Promise<boolean> {
  return db.transaction("rw", db.voiceQueue, async () => {
    const row = await db.voiceQueue.get(recordingId);
    if (!row || row.state === "appended") return false;
    await db.voiceQueue.update(recordingId, { state: "appended" });
    return true;
  });
}

/** The shopkeeper removes a recording he does not want billed. */
export const removeRecording = (db: KiranaBillDB, recordingId: string) => db.voiceQueue.delete(recordingId);

/** Recordings of this bill not yet in it - Bill Banao waits for them. */
export async function blockingForBill(db: KiranaBillDB, billLocalId: string): Promise<LocalVoiceRecording[]> {
  return (await recordingsForBill(db, billLocalId)).filter((r) => r.state !== "appended");
}

/** Waiting to be sent (offline at Generate). A failed or given-up recording waits for the shopkeeper's Retry instead. */
export const unsentRecordings = (db: KiranaBillDB, shopId: string) => db.voiceQueue.where("shopId").equals(shopId).filter((r) => r.state === "queued").sortBy("createdAt");

/** After Bill Banao: deletes the bill's recordings from the phone and returns their ids (to mark billed on the server). */
export async function clearBilled(db: KiranaBillDB, billLocalId: string): Promise<string[]> {
  return db.transaction("rw", db.voiceQueue, async () => {
    const ids = (await db.voiceQueue.where("billLocalId").equals(billLocalId).toArray()).map((r) => r.recordingId);
    await db.voiceQueue.bulkDelete(ids);
    return ids;
  });
}

/**
 * KB-385 step 6: Bill Banao (with `markBilled`) or Clear bill (without). The bill's recordings are deleted from the phone; at Bill Banao each
 * is marked billed on the server - the 7-day clock (D105). Best effort: a failure never fails the bill (the server's 7-days-after-upload
 * rule deletes an unmarked recording anyway - normal bills are made within minutes).
 */
export async function settleBilledRecordings(db: KiranaBillDB, billLocalId: string, markBilled?: (recordingId: string) => Promise<boolean>): Promise<void> {
  const ids = await clearBilled(db, billLocalId);
  if (markBilled) await Promise.all(ids.map((id) => markBilled(id).catch(() => false)));
}
