import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import Dexie from "dexie";
import { DeviceDB, getOrCreateDeviceId, getActiveUserId, setActiveUserId } from "./device";

// KB-315 (docs/07-DECISIONS.md D38): the per-installation device database.
describe("device.ts", () => {
  const names: string[] = [];
  const fresh = () => {
    const name = `device-test-${crypto.randomUUID()}`;
    names.push(name);
    return name;
  };

  afterEach(async () => {
    for (const name of names.splice(0)) await Dexie.delete(name);
  });

  it("creates a UUID deviceId once and returns the same one every time after", async () => {
    const db = new DeviceDB(fresh());
    const first = await getOrCreateDeviceId(db);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await getOrCreateDeviceId(db)).toBe(first);
  });

  it("survives a 'restart' - a new DeviceDB instance on the same store reads the same id", async () => {
    const name = fresh();
    const a = new DeviceDB(name);
    const id = await getOrCreateDeviceId(a);
    a.close();
    expect(await getOrCreateDeviceId(new DeviceDB(name))).toBe(id);
  });

  it("race-safe: concurrent callers on two instances of the same store get ONE id", async () => {
    const name = fresh();
    const [a, b] = [new DeviceDB(name), new DeviceDB(name)];
    const ids = await Promise.all([getOrCreateDeviceId(a), getOrCreateDeviceId(b), getOrCreateDeviceId(a), getOrCreateDeviceId(b)]);
    expect(new Set(ids).size).toBe(1);
  });

  it("a wiped store (a different database) gets a NEW id", async () => {
    const a = await getOrCreateDeviceId(new DeviceDB(fresh()));
    const b = await getOrCreateDeviceId(new DeviceDB(fresh()));
    expect(a).not.toBe(b);
  });

  it("activeUserId: set, read, cleared", async () => {
    const db = new DeviceDB(fresh());
    expect(await getActiveUserId(db)).toBeNull();
    await setActiveUserId(db, "user-1");
    expect(await getActiveUserId(db)).toBe("user-1");
    await setActiveUserId(db, null);
    expect(await getActiveUserId(db)).toBeNull();
  });
});
