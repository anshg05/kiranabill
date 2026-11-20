// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { stubLocalStorage } from "./testStorage";

// KB-425 (D123) + KB-416 (owner, 20 Nov 2026; D125): Choose printer asks appShell first (the Nearby devices card once); a "no" touches no
// Bluetooth; Android's refusal goes back to appShell. The search for NEW printers runs by itself only when Android already allows it
// (scanAllowed) - otherwise it waits for "Search for new printers", so opening Choose printer never brings up a prompt by itself.

stubLocalStorage();
const gate = vi.hoisted(() => ({ allow: true, refused: 0, scan: false, btSettings: 0 }));
const bt = vi.hoisted(() => ({ ready: 0, fail: false, bleReady: 0, bleFail: false }));
vi.mock("@/data/appShell", () => ({
  beforeAsking: async () => gate.allow,
  afterRefused: async () => void gate.refused++,
  scanAllowed: async () => gate.scan,
  openBluetoothSettings: () => void gate.btSettings++,
}));
vi.mock("@/data/printerClassic", () => ({
  classicTransport: {
    ready: async () => {
      bt.ready++;
      if (bt.fail) throw Object.assign(new Error("Permission denied"), { code: "NO_PERMISSION" });
    },
    list: async () => [],
  },
}));
vi.mock("@/data/printerBle", () => ({
  bleTransport: {
    // the real one: BleClient.initialize({ androidNeverForLocation: true }) asks Android for scan + connect (printerBle.ts:27)
    ready: async () => {
      bt.bleReady++;
      if (bt.bleFail) throw new Error("Permission denied.");
    },
    list: async () => [{ id: "BLE-1", name: "KP307 BLE", kind: "ble", printerLike: true }],
  },
}));
import { PrinterSection } from "./PrinterSection";

beforeEach(() => {
  Object.assign(gate, { allow: true, refused: 0, scan: false, btSettings: 0 });
  Object.assign(bt, { ready: 0, fail: false, bleReady: 0, bleFail: false });
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 30)); // an inner page's Back entry settles (as more17.test.tsx)
});
const shop = { name: "Sharma Kirana", phone: null, billLanguage: "en" as const };
const choose = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Choose printer" })));
const tap = async (name: string) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

describe("Choose printer inside the app", () => {
  it("Not now on the card: Bluetooth is not touched, Choose printer does not open", async () => {
    gate.allow = false;
    render(<PrinterSection shop={shop} />);
    await choose();
    expect(bt.ready).toBe(0);
    expect(bt.bleReady).toBe(0);
    expect(screen.queryByRole("heading", { level: 1, name: "Choose printer" })).toBeNull();
  });

  it("Allow: the paired list is asked for; Android's refusal goes back to appShell", async () => {
    bt.fail = true;
    render(<PrinterSection shop={shop} />);
    await choose();
    expect(bt.ready).toBe(1);
    expect(gate.refused).toBe(1);
  });

  it("the search NOT allowed yet: opening Choose printer runs no search (no prompt); 'Search for new printers' asks Android and finds the printer", async () => {
    render(<PrinterSection shop={shop} />);
    await choose();
    expect(bt.bleReady).toBe(0);
    await tap("Search for new printers");
    expect(bt.bleReady).toBe(1);
    expect(screen.getByRole("button", { name: "Connect KP307 BLE" })).toBeTruthy();
    expect(gate.refused).toBe(0);
  });

  it("the search already allowed: Choose printer searches by itself and lists the new printer - no tap", async () => {
    gate.scan = true;
    render(<PrinterSection shop={shop} />);
    await choose();
    expect(bt.bleReady).toBe(1);
    expect(screen.getByRole("button", { name: "Connect KP307 BLE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search again" })).toBeTruthy();
  });

  it("opening Choose printer again and again never searches by itself while the search is not allowed", async () => {
    render(<PrinterSection shop={shop} />);
    for (let i = 0; i < 3; i++) {
      await choose();
      expect(bt.bleReady).toBe(0);
      await tap("Back");
      await act(async () => new Promise((r) => setTimeout(r, 40))); // Back goes through the history (popstate)
    }
    expect(bt.ready).toBe(3);
  });

  it("the search refused by Android: back to appShell (Open Settings only if Android will not ask again)", async () => {
    bt.bleFail = true;
    render(<PrinterSection shop={shop} />);
    await choose();
    await tap("Search for new printers");
    expect(gate.refused).toBe(1);
  });

  it("Bluetooth settings opens Android's Bluetooth settings (to pair a printer)", async () => {
    render(<PrinterSection shop={shop} />);
    await choose();
    await tap("Bluetooth settings");
    expect(gate.btSettings).toBe(1);
  });
});
