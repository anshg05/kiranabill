import type { KiranaBillDB } from "./db";

// KB-413 step 2 (owner, 15 Nov 2026, answer 1): the recording on screen 10, saved on the phone the moment it stops (Stop, the 5:00 limit,
// the app going to the background), so reopening the app returns to 10 with it. One per shop. Bytes + type, as the voice queue keeps them
// (some phone browsers store Blobs in IndexedDB badly). Generate bill moves it into the voice queue (enqueueRecording deletes this copy in
// the same write); Discard and Re-record delete it.

export interface SavedTake {
  readonly audio: Blob;
  readonly recordedMs: number;
  readonly stopped?: "limit" | "hidden";
}

export async function saveRecordingDraft(db: KiranaBillDB, t: SavedTake & { readonly shopId: string }): Promise<void> {
  const bytes = await t.audio.arrayBuffer();
  await db.recordingDraft.put({
    shopId: t.shopId, bytes, mime: t.audio.type, recordedMs: t.recordedMs, savedAt: new Date().toISOString(), ...(t.stopped ? { stopped: t.stopped } : {}),
  });
}

export async function loadRecordingDraft(db: KiranaBillDB, shopId: string): Promise<SavedTake | null> {
  const row = await db.recordingDraft.get(shopId);
  if (!row) return null;
  return { audio: new Blob([row.bytes], { type: row.mime }), recordedMs: row.recordedMs, ...(row.stopped ? { stopped: row.stopped } : {}) };
}

export const clearRecordingDraft = (db: KiranaBillDB, shopId: string): Promise<void> => db.recordingDraft.delete(shopId);
