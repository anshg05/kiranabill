import { isSyncFailing, type SyncStatusState } from "@/data/syncStatus";

// KB-313 (05 §7): which header chip, if any. A status, never a dialog - billing is never blocked.
// Order: offline first (everything else is then expected), then "no live session" (D38's offline-session
// mode), then failing (3 failures in a row, or a bill in a permanent conflict), then syncing - and only when
// something is actually waiting, so an idle shop never flickers every 15 s.

export type ChipKind = "offline" | "nosession" | "failing" | "syncing";
export interface SyncChip {
  readonly kind: ChipKind;
  readonly label: string;
}
export interface Unsynced {
  readonly pending: number;
  readonly conflict: number;
}

export function syncChip(input: { online: boolean; status: SyncStatusState; unsynced: Unsynced }): SyncChip | null {
  const { online, status, unsynced } = input;
  if (!online) return { kind: "offline", label: "Offline" };
  if (status.noSession) return { kind: "nosession", label: "Not syncing — sign in again" };
  if (isSyncFailing(status) || unsynced.conflict > 0) return { kind: "failing", label: "Sync failing" };
  if (status.syncing && unsynced.pending > 0) return { kind: "syncing", label: "Syncing…" };
  return null;
}
