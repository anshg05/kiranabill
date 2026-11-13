// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorage } from "@/ui/testStorage";
import {
  PrintError,
  bleChunkSize,
  loadPrinterSettings,
  pickCharacteristic,
  savePrinterSettings,
  sendToPrinter,
  sortDevices,
  toPrintError,
  type PrinterDevice,
  type PrinterLink,
  type PrinterTransport,
} from "./printer";

// KB-408 S4 (D111): sending the print job. One interface for Bluetooth Classic and BLE; a fake here. Printing never blocks a bill: every
// failure is a PrintError the screen can say in one sentence, and the connection is always closed.

const dev = (over: Partial<PrinterDevice> = {}): PrinterDevice => ({ id: "AA:BB", name: "BT-SRT-58", kind: "classic", printerLike: true, ...over });

function fakeTransport(over: { chunk?: number; paceMs?: number; failAt?: number; failWith?: PrintError; ready?: () => Promise<void>; open?: () => Promise<PrinterLink> } = {}) {
  const writes: number[][] = [];
  const closed = vi.fn(() => Promise.resolve());
  const link: PrinterLink = {
    chunk: over.chunk ?? 4,
    paceMs: over.paceMs ?? 0,
    write: vi.fn((b: Uint8Array) => {
      if (over.failAt !== undefined && writes.length === over.failAt) return Promise.reject(over.failWith ?? new PrintError("disconnected"));
      writes.push([...b]);
      return Promise.resolve();
    }),
    close: closed,
  };
  const transport: PrinterTransport = {
    kind: "classic",
    ready: vi.fn(over.ready ?? (() => Promise.resolve())),
    list: vi.fn(() => Promise.resolve([])),
    open: vi.fn(over.open ?? (() => Promise.resolve(link))),
  };
  return { transport, link, writes, closed };
}

describe("sendToPrinter", () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);

  it("checks Bluetooth and permission first, opens the chosen printer, sends every byte in order in chunks, then closes", async () => {
    const { transport, writes, closed } = fakeTransport({ chunk: 4 });
    await sendToPrinter(transport, "AA:BB", bytes, () => {});
    expect(transport.ready).toHaveBeenCalledBefore(transport.open as never);
    expect(transport.open).toHaveBeenCalledWith("AA:BB");
    expect(writes).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("reports progress after each chunk, rising to exactly 1", async () => {
    const progress: number[] = [];
    await sendToPrinter(fakeTransport({ chunk: 4 }).transport, "AA:BB", bytes, (p) => progress.push(p));
    expect(progress).toEqual([0.4, 0.8, 1]);
  });

  it("waits paceMs between chunks (BLE printers drop bytes sent too fast) - not after the last", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await sendToPrinter(fakeTransport({ chunk: 4, paceMs: 8 }).transport, "AA:BB", bytes, () => {}, sleep);
    expect(sleep.mock.calls).toEqual([[8], [8]]);
  });

  it("a disconnect mid-print is a PrintError('disconnected') and the link is still closed", async () => {
    const { transport, closed } = fakeTransport({ chunk: 4, failAt: 1 });
    await expect(sendToPrinter(transport, "AA:BB", bytes, () => {})).rejects.toMatchObject({ kind: "disconnected" });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("Bluetooth off / permission refused stop before anything is opened", async () => {
    for (const kind of ["bluetooth_off", "permission"] as const) {
      const { transport } = fakeTransport({ ready: () => Promise.reject(new PrintError(kind)) });
      await expect(sendToPrinter(transport, "AA:BB", bytes, () => {})).rejects.toMatchObject({ kind });
      expect(transport.open).not.toHaveBeenCalled();
    }
  });

  it("a printer that is off or out of range is 'unreachable'; any other failure is mapped, never thrown raw", async () => {
    const off = fakeTransport({ open: () => Promise.reject(new PrintError("unreachable")) });
    await expect(sendToPrinter(off.transport, "AA:BB", bytes, () => {})).rejects.toMatchObject({ kind: "unreachable" });
    const odd = fakeTransport({ chunk: 4, failAt: 0, failWith: new Error("boom") as PrintError });
    const err = await sendToPrinter(odd.transport, "AA:BB", bytes, () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrintError);
    expect((err as PrintError).kind).toBe("disconnected");
  });

  it("a link with no usable chunk size fails at once (and closes) - it never loops forever", async () => {
    for (const chunk of [0, -1, Number.NaN, 0.5]) {
      const { transport, closed } = fakeTransport({ chunk });
      await expect(sendToPrinter(transport, "AA:BB", bytes, () => {})).rejects.toMatchObject({ kind: "disconnected" });
      expect(closed).toHaveBeenCalled();
    }
  });

  it("a close that fails does not hide the print's own result", async () => {
    const { transport, closed } = fakeTransport({ chunk: 4 });
    closed.mockImplementationOnce(() => Promise.reject(new Error("socket already closed")));
    await expect(sendToPrinter(transport, "AA:BB", bytes, () => {})).resolves.toBeUndefined();
  });
});

describe("toPrintError - native and plugin errors to one sentence's kind", () => {
  it.each([
    [{ code: "BT_OFF" }, "bluetooth_off"],
    [{ code: "NO_PERMISSION" }, "permission"],
    [{ code: "UNREACHABLE" }, "unreachable"],
    [{ code: "DISCONNECTED" }, "disconnected"],
    [{ code: "NO_BLUETOOTH" }, "no_bluetooth"],
    [new Error("Bluetooth LE not enabled"), "bluetooth_off"],
    [new Error("Permission denied."), "permission"],
    [new Error("Connection timeout"), "unreachable"],
    [new Error("something else"), "disconnected"],
  ])("%o -> %s", (err, kind) => {
    expect(toPrintError(err).kind).toBe(kind);
  });

  it("a PrintError passes through unchanged", () => {
    const e = new PrintError("permission");
    expect(toPrintError(e)).toBe(e);
  });
});

describe("sortDevices - the chooser's list", () => {
  it("printers first (Android says 'imaging'), then by name; nothing dropped", () => {
    const list = sortDevices([dev({ id: "1", name: "boAt Rockerz", printerLike: false }), dev({ id: "2", name: "KP307-UEWB" }), dev({ id: "3", name: "BT-SRT-58" }), dev({ id: "4", name: "", printerLike: false })]);
    expect(list.map((d) => d.id)).toEqual(["3", "2", "1", "4"]);
  });
});

describe("printer settings - this phone only", () => {
  beforeEach(() => stubLocalStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("none until chosen; saved and read back; cleared", () => {
    expect(loadPrinterSettings()).toBeNull();
    savePrinterSettings({ device: dev(), dots: 384 });
    expect(loadPrinterSettings()).toEqual({ device: dev(), dots: 384 });
    savePrinterSettings(null);
    expect(loadPrinterSettings()).toBeNull();
  });

  it("damaged or unknown data reads as 'no printer', never a crash or a wrong width", () => {
    for (const raw of ["{", "null", "[]", JSON.stringify({ device: dev(), dots: 500 }), JSON.stringify({ device: { id: 1 }, dots: 384 }), JSON.stringify({ device: dev({ kind: "usb" as never }), dots: 576 })]) {
      localStorage.setItem("kb.printer.v1", raw);
      expect(loadPrinterSettings(), raw).toBeNull();
    }
  });

  it("storage that throws (private mode, full) is 'no printer'", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} });
    expect(loadPrinterSettings()).toBeNull();
    expect(() => savePrinterSettings({ device: dev(), dots: 576 })).not.toThrow();
  });
});

describe("BLE: which characteristic carries the print job", () => {
  const props = (p: { write?: boolean; wwr?: boolean }) => ({ broadcast: false, read: false, notify: false, indicate: false, authenticatedSignedWrites: false, write: !!p.write, writeWithoutResponse: !!p.wwr });
  const svc = (uuid: string, chars: [string, { write?: boolean; wwr?: boolean }][]) => ({ uuid, characteristics: chars.map(([u, p]) => ({ uuid: u, properties: props(p), descriptors: [] })) });

  it("a known printer service first, even when another writable one comes earlier", () => {
    const pick = pickCharacteristic([svc("0000180a-0000-1000-8000-00805f9b34fb", [["00002a29-0000-1000-8000-00805f9b34fb", { write: true }]]), svc("000018f0-0000-1000-8000-00805f9b34fb", [["00002af0-0000-1000-8000-00805f9b34fb", {}], ["00002af1-0000-1000-8000-00805f9b34fb", { write: true, wwr: true }]])]);
    expect(pick).toEqual({ service: "000018f0-0000-1000-8000-00805f9b34fb", characteristic: "00002af1-0000-1000-8000-00805f9b34fb", withoutResponse: true });
  });

  it("inside a service, write-without-response is preferred (faster); write-with-response is used when that is all there is", () => {
    expect(pickCharacteristic([svc("49535343-fe7d-4ae5-8fa9-9fafd205e455", [["a", { write: true }], ["b", { wwr: true }]])])).toMatchObject({ characteristic: "b", withoutResponse: true });
    expect(pickCharacteristic([svc("49535343-fe7d-4ae5-8fa9-9fafd205e455", [["a", { write: true }]])])).toMatchObject({ characteristic: "a", withoutResponse: false });
  });

  it("an unknown printer: the first writable characteristic of any service; none -> null", () => {
    expect(pickCharacteristic([svc("x", [["r", {}]]), svc("y", [["w", { write: true }]])])).toMatchObject({ service: "y", characteristic: "w" });
    expect(pickCharacteristic([svc("x", [["r", {}]])])).toBeNull();
  });

  it("packet size = MTU - 3, at least 20, at most 512", () => {
    expect(bleChunkSize(185)).toBe(182);
    expect(bleChunkSize(23)).toBe(20);
    expect(bleChunkSize(5)).toBe(20);
    expect(bleChunkSize(1000)).toBe(512);
    expect(bleChunkSize(Number.NaN)).toBe(20);
  });
});
