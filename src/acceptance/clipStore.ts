import Dexie, { type Table } from "dexie";

// KB-364: the recorded clips live in the PHONE's IndexedDB until the owner exports them. Its own database - never the shop's.

export interface StoredClip {
  readonly id: string;
  readonly category: string;
  readonly mime: string;
  readonly durationMs: number;
  readonly blob: Blob;
}

export interface ClipStore {
  list(): Promise<StoredClip[]>;
  put(clip: StoredClip): Promise<void>;
  remove(id: string): Promise<void>;
}

class AcceptanceDb extends Dexie {
  clips!: Table<StoredClip, string>;
  constructor() {
    super("kb-acceptance-session");
    this.version(1).stores({ clips: "id" });
  }
}

export function dexieClipStore(): ClipStore {
  const db = new AcceptanceDb();
  return {
    list: () => db.clips.toArray(),
    put: async (clip) => void (await db.clips.put(clip)),
    remove: (id) => db.clips.delete(id),
  };
}
