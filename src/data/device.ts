import Dexie, { type EntityTable } from "dexie";

// KB-315 (docs/07-DECISIONS.md D38): per-INSTALLATION state, in its own tiny
// IndexedDB database - separate from the per-user shop databases
// (`kiranabill-<userId>`, db.ts), so the device id survives users signing in
// and out and is the same for every shop database on this device.
//
//   deviceId      - created once (crypto.randomUUID()), reused everywhere a
//                   device_id is written: copy_base_catalog, receipt blocks,
//                   bills, learning rows, the fallback receipt number (D23).
//   activeUserId  - the last user who signed in with a REAL session and has
//                   not explicitly signed out. Lets a signed-in shopkeeper
//                   open the app with no network ("offline session", D38).
//
// If IndexedDB is wiped, the next start mints a NEW deviceId: unsynced local
// rows are gone (nothing can recover them); the old install's unused receipt
// numbers are skipped, never reused (reserveBlock takes max(block_end) + 1,
// and blocks are only ever consumed by the device that reserved them);
// fallback numbers embed the new UUID, so they can't collide.

interface DeviceMeta {
  key: string;
  value: string;
}

export const DEVICE_DB_NAME = "kiranabill-device";

export class DeviceDB extends Dexie {
  meta!: EntityTable<DeviceMeta, "key">;

  constructor(name = DEVICE_DB_NAME) {
    super(name);
    this.version(1).stores({ meta: "&key" });
  }
}

/** Created once, inside one read-write transaction - two tabs (or two
 * callers) racing can't mint two different ids. */
export async function getOrCreateDeviceId(deviceDb: DeviceDB): Promise<string> {
  return deviceDb.transaction("rw", deviceDb.meta, async () => {
    const existing = await deviceDb.meta.get("deviceId");
    if (existing) return existing.value;
    const deviceId = crypto.randomUUID();
    await deviceDb.meta.put({ key: "deviceId", value: deviceId });
    return deviceId;
  });
}

export async function getActiveUserId(deviceDb: DeviceDB): Promise<string | null> {
  return (await deviceDb.meta.get("activeUserId"))?.value ?? null;
}

export async function setActiveUserId(deviceDb: DeviceDB, userId: string | null): Promise<void> {
  if (userId === null) await deviceDb.meta.delete("activeUserId");
  else await deviceDb.meta.put({ key: "activeUserId", value: userId });
}
