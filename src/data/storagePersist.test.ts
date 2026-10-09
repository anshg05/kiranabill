import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceDB } from "./device";
import { readStorageStatus, requestPersistentStorage, storageStatusText } from "./storagePersist";

// KB-401 (KI-68, D67): navigator.storage.persist() after sign-in / the first bill / install; the answer is recorded
// in the DEVICE database (a per-installation fact). A refusal is information, never an error.
const names: string[] = [];
const fresh = () => {
  const name = `persist-test-${crypto.randomUUID()}`;
  names.push(name);
  return new DeviceDB(name);
};
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n);
});

const storage = (persisted: boolean, persistResult: boolean | Error) => ({
  persisted: vi.fn(() => Promise.resolve(persisted)),
  persist: vi.fn(() => (persistResult instanceof Error ? Promise.reject(persistResult) : Promise.resolve(persistResult))),
});

describe("requestPersistentStorage", () => {
  it("records 'granted' when the browser grants it", async () => {
    const db = fresh();
    const s = storage(false, true);
    expect(await requestPersistentStorage(db, s, () => 1000)).toBe("granted");
    expect(await readStorageStatus(db)).toEqual({ status: "granted", at: 1000 });
  });

  it("records 'denied' when the browser refuses - and nothing throws", async () => {
    const db = fresh();
    expect(await requestPersistentStorage(db, storage(false, false), () => 5)).toBe("denied");
    expect(await readStorageStatus(db)).toEqual({ status: "denied", at: 5 });
  });

  it("asks again after a refusal (Chrome grants on engagement or install, not on asking)", async () => {
    const db = fresh();
    await requestPersistentStorage(db, storage(false, false), () => 1);
    const later = storage(false, true);
    expect(await requestPersistentStorage(db, later, () => 2)).toBe("granted");
    expect(later.persist).toHaveBeenCalledTimes(1);
    expect(await readStorageStatus(db)).toEqual({ status: "granted", at: 2 });
  });

  it("does not ask again once recorded as granted and still persisted", async () => {
    const db = fresh();
    await requestPersistentStorage(db, storage(false, true), () => 1);
    const again = storage(true, true);
    expect(await requestPersistentStorage(db, again, () => 2)).toBe("granted");
    expect(again.persist).not.toHaveBeenCalled();
    expect((await readStorageStatus(db)).at).toBe(1);
  });

  it("an already-persisted store is recorded without calling persist()", async () => {
    const db = fresh();
    const s = storage(true, true);
    expect(await requestPersistentStorage(db, s, () => 3)).toBe("granted");
    expect(s.persist).not.toHaveBeenCalled();
  });

  it("records 'unsupported' when the browser has no storage.persist", async () => {
    const db = fresh();
    expect(await requestPersistentStorage(db, undefined, () => 4)).toBe("unsupported");
    expect(await requestPersistentStorage(db, {} as never, () => 4)).toBe("unsupported");
    expect(await readStorageStatus(db)).toEqual({ status: "unsupported", at: 4 });
  });

  it("an exception is recorded as 'denied', never thrown", async () => {
    const db = fresh();
    expect(await requestPersistentStorage(db, storage(false, new Error("nope")), () => 6)).toBe("denied");
  });

  it("a broken device database does not throw", async () => {
    const db = fresh();
    db.close();
    await Dexie.delete(db.name);
    const broken = { meta: { get: () => Promise.reject(new Error("idb")), put: () => Promise.reject(new Error("idb")) } } as unknown as DeviceDB;
    await expect(requestPersistentStorage(broken, storage(false, true), () => 7)).resolves.toBe("granted");
  });
});

describe("readStorageStatus", () => {
  it("is 'unknown' before the first request", async () => {
    expect(await readStorageStatus(fresh())).toEqual({ status: "unknown", at: null });
  });
});

describe("storageStatusText", () => {
  it("says it plainly and never alarmingly", () => {
    expect(storageStatusText("granted")).toBe("Storage: protected");
    expect(storageStatusText("denied")).toBe("Storage: not protected yet — install the app");
    expect(storageStatusText("unknown")).toBe("Storage: not protected yet — install the app");
    expect(storageStatusText("unsupported")).toBe("Storage: this browser cannot protect it");
  });
});
