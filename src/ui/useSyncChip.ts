import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import type { KiranaBillDB } from "@/data/db";
import { getSyncStatus, subscribeSyncStatus } from "@/data/syncStatus";
import { syncChip, type Unsynced } from "./syncChip";
import { useBrowserOnline } from "./useBrowserOnline";

// KB-313: the header chip's inputs - the browser's online flag, the sync loop's own status (data/syncStatus.ts)
// and how many bills are waiting (pending) or stuck for good (conflict), live from the user's database.

const NONE: Unsynced = { pending: 0, conflict: 0 };

export function useSyncChip(localDb: KiranaBillDB | null) {
  const online = useBrowserOnline();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [unsynced, setUnsynced] = useState<Unsynced>(NONE);

  useEffect(() => {
    if (!localDb) return;
    const sub = liveQuery(async () => ({
      pending: await localDb.bills.where("syncStatus").equals("pending").count(),
      conflict: await localDb.bills.where("syncStatus").equals("conflict").count(),
    })).subscribe({
      next: setUnsynced,
      error: (err: unknown) => console.warn("[syncChip] count failed:", err instanceof Error ? err.message : err),
    });
    return () => sub.unsubscribe();
  }, [localDb]);

  return {
    chip: syncChip({ online, status, unsynced }),
    unsynced,
    detail: { ...unsynced, lastAttemptAt: status.lastAttemptAt },
  };
}
