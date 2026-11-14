import { BleClient, ConnectionPriority } from "@capacitor-community/bluetooth-le";
import { PrintError, bleChunkSize, isPrinterService, pickCharacteristic, sortDevices, toPrintError, type PrinterDevice, type PrinterLink, type PrinterTransport } from "./printer";

// KB-408 S4 (D111): Bluetooth LE printers through @capacitor-community/bluetooth-le 8.3.0 (pinned): a short scan, the writable
// characteristic (known printer services first), MTU-sized packets with a pause between them.

/** How long "Search" scans. */
export const BLE_SCAN_MS = 5000;
export const BLE_CONNECT_TIMEOUT_MS = 10_000;
/** Pause after each UNACKNOWLEDGED packet (a printer with no acknowledged writes): 60 bytes every 20 ms = 3 KB a second at most. */
export const BLE_PACE_MS = 20;

let initialized = false;
/** Tests only. */
export function resetBle(): void {
  initialized = false;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const bleTransport: PrinterTransport = {
  kind: "ble",
  async ready() {
    try {
      if (!initialized) {
        // asks "Nearby devices" on Android 12+ (never location: the manifest says neverForLocation)
        await BleClient.initialize({ androidNeverForLocation: true });
        initialized = true;
      }
      if (!(await BleClient.isEnabled())) throw new PrintError("bluetooth_off");
    } catch (e) {
      throw toPrintError(e);
    }
  },
  async list() {
    const found = new Map<string, PrinterDevice>();
    try {
      await BleClient.requestLEScan({}, (r) => {
        const name = r.device.name ?? r.localName ?? "";
        if (name) found.set(r.device.deviceId, { id: r.device.deviceId, name, kind: "ble", printerLike: (r.uuids ?? []).some(isPrinterService) });
      });
      await wait(BLE_SCAN_MS);
    } catch (e) {
      throw toPrintError(e);
    } finally {
      await BleClient.stopLEScan().catch(() => {});
    }
    return sortDevices([...found.values()]);
  },
  async open(id) {
    let lost = false;
    try {
      await BleClient.connect(id, () => (lost = true), { timeout: BLE_CONNECT_TIMEOUT_MS });
    } catch (e) {
      const err = toPrintError(e);
      throw err.kind === "bluetooth_off" || err.kind === "permission" ? err : new PrintError("unreachable"); // off or out of range
    }
    try {
      const target = pickCharacteristic(await BleClient.getServices(id));
      if (!target) throw new PrintError("unreachable"); // nothing to write to: not a printer
      const mtu = await BleClient.getMtu(id).catch(() => 23);
      // a short connection interval: acknowledged writes take one or two intervals each
      await BleClient.requestConnectionPriority(id, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => {});
      const link: PrinterLink = {
        chunk: bleChunkSize(mtu, target.withoutResponse),
        paceMs: target.withoutResponse ? BLE_PACE_MS : 0,
        async write(bytes) {
          if (lost) throw new PrintError("disconnected");
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          try {
            if (target.withoutResponse) await BleClient.writeWithoutResponse(id, target.service, target.characteristic, view);
            else await BleClient.write(id, target.service, target.characteristic, view);
          } catch (e) {
            throw lost ? new PrintError("disconnected") : toPrintError(e);
          }
        },
        close: () => BleClient.disconnect(id),
      };
      return link;
    } catch (e) {
      await BleClient.disconnect(id).catch(() => {});
      throw toPrintError(e);
    }
  },
};
