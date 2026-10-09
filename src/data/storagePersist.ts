import type { DeviceDB } from "./device";

// KB-401 (docs/12-PARKED.md KI-68, docs/07-DECISIONS.md D67): ask the browser to keep this site's storage
// (IndexedDB - every unsynced bill) out of its clean-up. Chrome decides from engagement and install signals, not
// from a prompt, so it is asked after sign-in, after each bill while not yet granted, and on `appinstalled`.
// The answer is a per-INSTALLATION fact, so it is kept in the device database (device.ts), not a shop's. A refusal
// is information - never an error, never a dialog.

export type StorageStatus = "granted" | "denied" | "unsupported" | "unknown";

const KEY = "storagePersisted";

interface StorageLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export async function readStorageStatus(db: DeviceDB): Promise<{ status: StorageStatus; at: number | null }> {
  try {
    const row = await db.meta.get(KEY);
    if (!row) return { status: "unknown", at: null };
    const v = JSON.parse(row.value) as { status?: StorageStatus; at?: number };
    return { status: v.status ?? "unknown", at: typeof v.at === "number" ? v.at : null };
  } catch {
    return { status: "unknown", at: null };
  }
}

export async function requestPersistentStorage(db: DeviceDB, storage: StorageLike | undefined, now: () => number = Date.now): Promise<StorageStatus> {
  const record = async (status: StorageStatus): Promise<StorageStatus> => {
    try {
      await db.meta.put({ key: KEY, value: JSON.stringify({ status, at: now() }) });
    } catch (err) {
      console.warn("[storage] could not record the answer:", err instanceof Error ? err.message : err);
    }
    return status;
  };
  if (!storage || typeof storage.persist !== "function") return record("unsupported");
  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) {
      return (await readStorageStatus(db)).status === "granted" ? "granted" : record("granted");
    }
    return record((await storage.persist()) ? "granted" : "denied");
  } catch {
    return record("denied");
  }
}

export function storageStatusText(status: StorageStatus): string {
  if (status === "granted") return "Storage: protected";
  if (status === "unsupported") return "Storage: this browser cannot protect it";
  return "Storage: not protected yet — install the app";
}
