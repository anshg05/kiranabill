// KB-384a step 5 (owner, 9 Nov 2026; D105, D107): the 7-day deletion of voice recordings, run INSIDE Supabase (an Edge Function that
// pg_cron + pg_net call once a day). Plain TypeScript with no imports, so Deno runs it in the function and Vitest tests it.
//   - what is due comes from voice_cleanup_due(): billed 7+ days ago, unbilled 7+ days after upload, or a file with no row left;
//   - files are removed through the Storage API (a SQL delete of storage.objects would leave the file itself behind);
//   - a row is deleted only after its file is gone - a batch Storage refuses keeps its rows and is tried again the next day.

export const REMOVE_BATCH = 100;

export interface DueRecording {
  recording_id: string | null;
  path: string;
}

export interface CleanupDeps {
  due(): Promise<DueRecording[]>;
  removeFiles(paths: string[]): Promise<void>;
  deleteRows(recordingIds: string[]): Promise<void>;
}

export async function runCleanup(deps: CleanupDeps): Promise<{ files: number; rows: number; failedBatches: number }> {
  const due = await deps.due();
  let files = 0;
  let rows = 0;
  let failedBatches = 0;
  for (let i = 0; i < due.length; i += REMOVE_BATCH) {
    const batch = due.slice(i, i + REMOVE_BATCH);
    try {
      await deps.removeFiles(batch.map((d) => d.path));
    } catch {
      failedBatches++;
      continue;
    }
    files += batch.length;
    const ids = batch.flatMap((d) => (d.recording_id ? [d.recording_id] : []));
    if (ids.length) {
      await deps.deleteRows(ids);
      rows += ids.length;
    }
  }
  return { files, rows, failedBatches };
}

/** The shared secret check: never open when none is configured; compared without stopping at the first difference. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** The minimal shape of a supabase-js client this needs (typed structurally, so this file imports nothing). */
interface Db {
  rpc(fn: "voice_cleanup_due"): PromiseLike<{ data: DueRecording[] | null; error: unknown }>;
  storage: { from(bucket: "recordings"): { remove(paths: string[]): PromiseLike<{ error: unknown }> } };
  from(table: "voice_recordings"): { delete(): { in(column: "recording_id", ids: string[]): PromiseLike<{ error: unknown }> } };
}

/** The real calls, with the SERVICE ROLE client the Edge Function gets from Supabase (shared by index.ts and the e2e test). */
export function supabaseDeps(db: Db): CleanupDeps {
  return {
    async due() {
      const { data, error } = await db.rpc("voice_cleanup_due");
      if (error) throw new Error("due");
      return data ?? [];
    },
    async removeFiles(paths) {
      const { error } = await db.storage.from("recordings").remove(paths);
      if (error) throw new Error("remove");
    },
    async deleteRows(ids) {
      const { error } = await db.from("voice_recordings").delete().in("recording_id", ids);
      if (error) throw new Error("rows");
    },
  };
}
