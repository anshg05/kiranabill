// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { DeviceDB } from "@/data/device";
import { readStorageStatus } from "@/data/storagePersist";
import { usePersistentStorage } from "./usePersistentStorage";

// KB-401 (KI-68, D67): asked when the billing screen mounts, on the browser's `appinstalled`, and after a saved bill.
let db: DeviceDB;
const persist = vi.fn();
const persisted = vi.fn();

beforeEach(() => {
  db = new DeviceDB(`persist-hook-${crypto.randomUUID()}`);
  persist.mockReset().mockResolvedValue(true);
  persisted.mockReset().mockResolvedValue(false);
  Object.defineProperty(navigator, "storage", { configurable: true, value: { persist, persisted } });
});
afterEach(async () => {
  cleanup();
  db.close();
  await Dexie.delete(db.name);
});

describe("usePersistentStorage", () => {
  it("asks on mount and records the answer", async () => {
    renderHook(() => usePersistentStorage(db));
    await waitFor(async () => expect((await readStorageStatus(db)).status).toBe("granted"));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("asks again on `appinstalled` while not granted, and through the returned function (after a bill)", async () => {
    persist.mockResolvedValue(false);
    const r = renderHook(() => usePersistentStorage(db));
    await waitFor(async () => expect((await readStorageStatus(db)).status).toBe("denied"));
    window.dispatchEvent(new Event("appinstalled"));
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    r.result.current();
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(3));
  });

  it("does nothing without a device database", () => {
    renderHook(() => usePersistentStorage(null));
    expect(persist).not.toHaveBeenCalled();
  });

  it("a browser that refuses is not an error", async () => {
    persist.mockRejectedValue(new Error("no"));
    renderHook(() => usePersistentStorage(db));
    await waitFor(async () => expect((await readStorageStatus(db)).status).toBe("denied"));
  });
});
