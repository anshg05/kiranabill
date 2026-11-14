import { registerPlugin } from "@capacitor/core";
import { sortDevices, toPrintError, type PrinterLink, type PrinterTransport } from "./printer";

// KB-408 S4 (D111): Bluetooth Classic printers through our own Kotlin plugin (android/.../ClassicPrinterPlugin.kt) - the phone's PAIRED
// devices, the serial-port profile (SPP), chunked writes, a clean close. No Capacitor 8 plugin for Classic is maintained.

interface ClassicPrinterPlugin {
  /** Android 12+: asks "Nearby devices" if not granted yet; then Bluetooth must be on. Rejects NO_PERMISSION / BT_OFF / NO_BLUETOOTH. */
  ensureReady(): Promise<void>;
  /** EVERY device paired with the phone; type = how Android knows it. */
  listPaired(): Promise<{ devices: { address: string; name: string; printer: boolean; type: "classic" | "dual" | "le" | "unknown" }[] }>;
  /** Rejects UNREACHABLE (printer off, out of range, not paired). */
  connect(options: { address: string }): Promise<void>;
  /** Base64 bytes; rejects DISCONNECTED. */
  write(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
}

export const ClassicPrinter = registerPlugin<ClassicPrinterPlugin>("ClassicPrinter");

/** Bytes per write call: small steps, so the send rate (printRate) is held evenly and a cheap printer's small buffer never overflows. */
export const CLASSIC_CHUNK = 512;

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const classicTransport: PrinterTransport = {
  kind: "classic",
  ready: () => ClassicPrinter.ensureReady().catch((e: unknown) => Promise.reject(toPrintError(e))),
  async list() {
    try {
      const { devices } = await ClassicPrinter.listPaired();
      // a device paired only as Bluetooth LE is marked BLE; the chooser still tries Classic first (preferClassic)
      return sortDevices(devices.map((d) => ({ id: d.address, name: d.name, kind: d.type === "le" ? ("ble" as const) : ("classic" as const), printerLike: d.printer })));
    } catch (e) {
      throw toPrintError(e);
    }
  },
  async open(address) {
    try {
      await ClassicPrinter.connect({ address });
    } catch (e) {
      throw toPrintError(e);
    }
    const link: PrinterLink = {
      chunk: CLASSIC_CHUNK,
      paceMs: 0,
      write: (bytes) => ClassicPrinter.write({ data: toBase64(bytes) }).catch((e: unknown) => Promise.reject(toPrintError(e))),
      close: () => ClassicPrinter.disconnect(),
    };
    return link;
  },
};
