// KB-408 S4 (D111): sending a print job to a Bluetooth thermal printer. One interface for Bluetooth Classic (our own Kotlin plugin,
// printerClassic.ts) and BLE (printerBle.ts). Printing never blocks a bill: every failure becomes a PrintError of one known kind, and
// the connection is always closed. The chosen printer and paper width live on THIS phone only (localStorage), never synced.

export type PrinterKind = "classic" | "ble";
export type PaperDots = 384 | 576;

export interface PrinterDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: PrinterKind;
  /** Android reports the device as a printer ("imaging") - listed first. */
  readonly printerLike: boolean;
}

export type PrintFailure = "bluetooth_off" | "permission" | "unreachable" | "disconnected" | "no_bluetooth";

export class PrintError extends Error {
  constructor(readonly kind: PrintFailure) {
    super(`print failed: ${kind}`);
    this.name = "PrintError";
  }
}

/** One open connection to a printer. */
export interface PrinterLink {
  /** Bytes per write. */
  readonly chunk: number;
  /** Pause between writes (BLE printers drop bytes sent too fast); 0 = none. */
  readonly paceMs: number;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface PrinterTransport {
  readonly kind: PrinterKind;
  /** Permission asked if needed (only here - the first time the printer is used), then Bluetooth must be on. */
  ready(): Promise<void>;
  /** Classic: the phone's paired devices. BLE: a short scan. */
  list(): Promise<PrinterDevice[]>;
  open(id: string): Promise<PrinterLink>;
}

const NATIVE_CODES: Record<string, PrintFailure> = {
  BT_OFF: "bluetooth_off",
  NO_PERMISSION: "permission",
  UNREACHABLE: "unreachable",
  DISCONNECTED: "disconnected",
  NO_BLUETOOTH: "no_bluetooth",
};

/** Any error from the plugins (a native code, or the BLE plugin's message) as one PrintError. */
export function toPrintError(err: unknown): PrintError {
  if (err instanceof PrintError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NATIVE_CODES[code]) return new PrintError(NATIVE_CODES[code]);
  const text = err instanceof Error ? err.message : String(err);
  if (/not enabled|disabled|bluetooth.*off/i.test(text)) return new PrintError("bluetooth_off");
  if (/permission/i.test(text)) return new PrintError("permission");
  if (/timeout|timed out|not found|unreachable|failed to connect|could not connect/i.test(text)) return new PrintError("unreachable");
  return new PrintError("disconnected");
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The whole job: ready, open, every byte in order (progress after each chunk), always close. */
export async function sendToPrinter(transport: PrinterTransport, deviceId: string, bytes: Uint8Array, onProgress: (done: number) => void, sleep = realSleep): Promise<void> {
  try {
    await transport.ready();
    const link = await transport.open(deviceId);
    try {
      if (!Number.isInteger(link.chunk) || link.chunk < 1) throw new PrintError("disconnected"); // a 0-byte chunk would loop forever
      for (let at = 0; at < bytes.length; at += link.chunk) {
        const end = Math.min(at + link.chunk, bytes.length);
        await link.write(bytes.subarray(at, end));
        onProgress(end / bytes.length);
        if (link.paceMs > 0 && end < bytes.length) await sleep(link.paceMs);
      }
    } finally {
      await link.close().catch(() => {});
    }
  } catch (err) {
    throw toPrintError(err);
  }
}

/** Printers first, then by name; a device with no name last. */
export function sortDevices(devices: readonly PrinterDevice[]): PrinterDevice[] {
  return [...devices].sort((a, b) => Number(b.printerLike) - Number(a.printerLike) || Number(!a.name) - Number(!b.name) || a.name.localeCompare(b.name));
}

export interface PrinterSettings {
  readonly device: PrinterDevice;
  readonly dots: PaperDots;
}

const KEY = "kb.printer.v1";

export function loadPrinterSettings(): PrinterSettings | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PrinterSettings> | null;
    const d = raw?.device;
    if (!d || typeof d.id !== "string" || typeof d.name !== "string" || (d.kind !== "classic" && d.kind !== "ble") || (raw.dots !== 384 && raw.dots !== 576)) return null;
    return { device: { id: d.id, name: d.name, kind: d.kind, printerLike: d.printerLike === true }, dots: raw.dots };
  } catch {
    return null;
  }
}

export function savePrinterSettings(settings: PrinterSettings | null): void {
  try {
    if (settings) localStorage.setItem(KEY, JSON.stringify(settings));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the choice lasts until the app closes - the next print asks again
  }
}

// ---- BLE: which characteristic carries the job (pure; printerBle.ts uses it)

/** Services cheap BLE printers use for their print stream, most common first. */
const KNOWN_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
];

/** A BLE advertisement naming one of the printer services. */
export const isPrinterService = (uuid: string): boolean => KNOWN_PRINTER_SERVICES.includes(uuid.toLowerCase());

interface BleServiceLike {
  readonly uuid: string;
  readonly characteristics: readonly { readonly uuid: string; readonly properties: { readonly write: boolean; readonly writeWithoutResponse: boolean } }[];
}

export interface BleTarget {
  readonly service: string;
  readonly characteristic: string;
  readonly withoutResponse: boolean;
}

export function pickCharacteristic(services: readonly BleServiceLike[]): BleTarget | null {
  const rank = (uuid: string) => {
    const i = KNOWN_PRINTER_SERVICES.indexOf(uuid.toLowerCase());
    return i < 0 ? KNOWN_PRINTER_SERVICES.length : i;
  };
  for (const s of [...services].sort((a, b) => rank(a.uuid) - rank(b.uuid))) {
    const fast = s.characteristics.find((c) => c.properties.writeWithoutResponse);
    if (fast) return { service: s.uuid, characteristic: fast.uuid, withoutResponse: true };
    const slow = s.characteristics.find((c) => c.properties.write);
    if (slow) return { service: s.uuid, characteristic: slow.uuid, withoutResponse: false };
  }
  return null;
}

/** One BLE packet: the MTU less its 3-byte header, within 20..512. */
export function bleChunkSize(mtu: number): number {
  return Number.isFinite(mtu) ? Math.min(512, Math.max(20, Math.floor(mtu) - 3)) : 20;
}
