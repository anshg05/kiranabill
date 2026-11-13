// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// KB-408 S4: the two senders against fake plugins - what each native answer becomes, and that a dropped printer is reported, not hung on.

const native = vi.hoisted(() => ({
  ensureReady: vi.fn(() => Promise.resolve()),
  listPaired: vi.fn(() => Promise.resolve({ devices: [] as { address: string; name: string; printer: boolean }[] })),
  connect: vi.fn((_o: { address: string }) => Promise.resolve()),
  write: vi.fn((_o: { data: string }) => Promise.resolve()),
  disconnect: vi.fn(() => Promise.resolve()),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));

type ScanCb = (r: { device: { deviceId: string; name?: string }; localName?: string; uuids?: string[] }) => void;
const ble = vi.hoisted(() => ({
  initialize: vi.fn((_o?: unknown) => Promise.resolve()),
  isEnabled: vi.fn(() => Promise.resolve(true)),
  requestLEScan: vi.fn((_o: unknown, _cb: ScanCb) => Promise.resolve()),
  stopLEScan: vi.fn(() => Promise.resolve()),
  connect: vi.fn((_id: string, _onDisconnect?: (id: string) => void, _o?: unknown) => Promise.resolve()),
  getServices: vi.fn((_id: string) =>
    Promise.resolve([{ uuid: "000018f0-0000-1000-8000-00805f9b34fb", characteristics: [{ uuid: "00002af1-0000-1000-8000-00805f9b34fb", properties: { write: true, writeWithoutResponse: true } }] }]),
  ),
  getMtu: vi.fn((_id: string) => Promise.resolve(185)),
  write: vi.fn((..._a: unknown[]) => Promise.resolve()),
  writeWithoutResponse: vi.fn((..._a: unknown[]) => Promise.resolve()),
  disconnect: vi.fn((_id: string) => Promise.resolve()),
}));
vi.mock("@capacitor-community/bluetooth-le", () => ({ BleClient: ble }));

import { CLASSIC_CHUNK, classicTransport, toBase64 } from "./printerClassic";
import { BLE_PACE_MS, BLE_SCAN_MS, bleTransport, resetBle } from "./printerBle";

beforeEach(() => {
  for (const f of [...Object.values(native), ...Object.values(ble)]) f.mockClear();
  resetBle();
});
afterEach(() => vi.useRealTimers());

describe("Bluetooth Classic (our Kotlin plugin)", () => {
  it("lists the PAIRED devices, printers first", async () => {
    native.listPaired.mockResolvedValueOnce({ devices: [{ address: "11", name: "Headphones", printer: false }, { address: "22", name: "BT-SRT-58", printer: true }] });
    expect(await classicTransport.list()).toEqual([
      { id: "22", name: "BT-SRT-58", kind: "classic", printerLike: true },
      { id: "11", name: "Headphones", kind: "classic", printerLike: false },
    ]);
  });

  it("native codes become the screen's kinds: Bluetooth off, permission refused, printer off / out of range, dropped mid-print", async () => {
    native.ensureReady.mockRejectedValueOnce({ code: "BT_OFF", message: "Bluetooth is off" });
    await expect(classicTransport.ready()).rejects.toMatchObject({ kind: "bluetooth_off" });
    native.ensureReady.mockRejectedValueOnce({ code: "NO_PERMISSION", message: "denied" });
    await expect(classicTransport.ready()).rejects.toMatchObject({ kind: "permission" });
    native.connect.mockRejectedValueOnce({ code: "UNREACHABLE", message: "read failed, socket might closed" });
    await expect(classicTransport.open("22")).rejects.toMatchObject({ kind: "unreachable" });
    const link = await classicTransport.open("22");
    native.write.mockRejectedValueOnce({ code: "DISCONNECTED", message: "Broken pipe" });
    await expect(link.write(new Uint8Array([1]))).rejects.toMatchObject({ kind: "disconnected" });
  });

  it("writes base64 chunks of CLASSIC_CHUNK with no pause; close disconnects", async () => {
    const link = await classicTransport.open("22");
    expect(native.connect).toHaveBeenCalledWith({ address: "22" });
    expect(link.chunk).toBe(CLASSIC_CHUNK);
    expect(CLASSIC_CHUNK).toBe(2048); // big enough for few bridge calls, small enough for steady progress
    expect(link.paceMs).toBe(0);
    await link.write(new Uint8Array([0x1b, 0x40, 0xff]));
    expect(native.write).toHaveBeenCalledWith({ data: "G0D/" });
    await link.close();
    expect(native.disconnect).toHaveBeenCalledTimes(1);
  });

  it("toBase64 handles a whole receipt (over 32 KB, every byte value)", () => {
    const bytes = Uint8Array.from({ length: 140_801 }, (_, i) => i % 256);
    expect(Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});

describe("Bluetooth LE (@capacitor-community/bluetooth-le)", () => {
  it("ready: initialises once, never for location; Bluetooth off is said", async () => {
    await bleTransport.ready();
    await bleTransport.ready();
    expect(ble.initialize).toHaveBeenCalledExactlyOnceWith({ androidNeverForLocation: true });
    ble.isEnabled.mockResolvedValueOnce(false);
    await expect(bleTransport.ready()).rejects.toMatchObject({ kind: "bluetooth_off" });
  });

  it("a refused permission is 'permission'", async () => {
    ble.initialize.mockRejectedValueOnce(new Error("Permission denied."));
    await expect(bleTransport.ready()).rejects.toMatchObject({ kind: "permission" });
  });

  it("search: scans BLE_SCAN_MS, keeps named devices once each, printers (known service) first, always stops the scan", async () => {
    vi.useFakeTimers();
    ble.requestLEScan.mockImplementationOnce((_o, cb) => {
      cb({ device: { deviceId: "x1", name: "Mi Band" } });
      cb({ device: { deviceId: "p1" }, localName: "Printer_8A21", uuids: ["000018f0-0000-1000-8000-00805f9b34fb"] });
      cb({ device: { deviceId: "p1" }, localName: "Printer_8A21", uuids: ["000018f0-0000-1000-8000-00805f9b34fb"] });
      cb({ device: { deviceId: "nameless" } });
      return Promise.resolve();
    });
    const listed = bleTransport.list();
    await vi.advanceTimersByTimeAsync(BLE_SCAN_MS);
    expect((await listed).map((d) => [d.id, d.printerLike])).toEqual([["p1", true], ["x1", false]]);
    expect(ble.stopLEScan).toHaveBeenCalledTimes(1);
  });

  it("open: the printer service's characteristic, packets of MTU - 3, paced; writes without response", async () => {
    const link = await bleTransport.open("p1");
    expect(link.chunk).toBe(182);
    expect(link.paceMs).toBe(BLE_PACE_MS);
    await link.write(new Uint8Array([1, 2, 3]));
    const [id, service, characteristic, view] = ble.writeWithoutResponse.mock.calls[0]! as [string, string, string, DataView];
    expect([id, service, characteristic]).toEqual(["p1", "000018f0-0000-1000-8000-00805f9b34fb", "00002af1-0000-1000-8000-00805f9b34fb"]);
    expect([...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)]).toEqual([1, 2, 3]);
  });

  it("a printer that is off or out of range: 'unreachable' (connect fails or times out)", async () => {
    ble.connect.mockRejectedValueOnce(new Error("Connection timeout"));
    await expect(bleTransport.open("p1")).rejects.toMatchObject({ kind: "unreachable" });
    ble.connect.mockRejectedValueOnce(new Error("Device not found"));
    await expect(bleTransport.open("p1")).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("a device with nothing to write to is not a printer: 'unreachable', and it is disconnected", async () => {
    ble.getServices.mockResolvedValueOnce([{ uuid: "0000180f-0000-1000-8000-00805f9b34fb", characteristics: [{ uuid: "00002a19-0000-1000-8000-00805f9b34fb", properties: { write: false, writeWithoutResponse: false } }] }]);
    await expect(bleTransport.open("x1")).rejects.toMatchObject({ kind: "unreachable" });
    expect(ble.disconnect).toHaveBeenCalledWith("x1");
  });

  it("the printer dropping the link mid-print: the next write is 'disconnected' - never a hang", async () => {
    let onDisconnect: ((id: string) => void) | undefined;
    ble.connect.mockImplementationOnce((_id, cb) => {
      onDisconnect = cb;
      return Promise.resolve();
    });
    const link = await bleTransport.open("p1");
    await link.write(new Uint8Array([1]));
    onDisconnect!("p1");
    await expect(link.write(new Uint8Array([2]))).rejects.toMatchObject({ kind: "disconnected" });
    expect(ble.writeWithoutResponse).toHaveBeenCalledTimes(1);
  });

  it("an MTU the phone will not tell: 20-byte packets", async () => {
    ble.getMtu.mockRejectedValueOnce(new Error("not supported"));
    expect((await bleTransport.open("p1")).chunk).toBe(20);
  });
});
