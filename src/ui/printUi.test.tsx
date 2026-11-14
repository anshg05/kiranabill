// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Receipt } from "@/domain/receipt";
import { PrintError, type PrinterDevice, type PrinterLink, type PrinterTransport } from "@/data/printer";
import { stubLocalStorage } from "./testStorage";

// KB-408 S5 (owner, 13 Nov 2026): the minimal print screens - not the redesign. Inside the Android app only. Printing never blocks a
// bill: Share stays, every failure is one sentence, the button comes back.

const env = vi.hoisted(() => ({ native: true }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));

const rendered = vi.hoisted(() => ({ calls: [] as { receipt: Receipt; dots: number }[] }));
vi.mock("./receiptPrint", () => ({
  renderReceiptForPrint: (receipt: Receipt, dots: number) => {
    rendered.calls.push({ receipt, dots });
    return Promise.resolve({ rgba: new Uint8ClampedArray(32), bitmap: { width: 8, height: 1, data: new Uint8Array([0x80]) } });
  },
}));

function fakeTransport(kind: "classic" | "ble") {
  const t = {
    kind,
    devices: [] as PrinterDevice[],
    sent: [] as number[],
    failReady: null as PrintError | null,
    failOpen: null as PrintError | null,
    gate: null as Promise<void> | null,
    ready: vi.fn(() => (t.failReady ? Promise.reject(t.failReady) : Promise.resolve())),
    list: vi.fn(() => Promise.resolve(t.devices)),
    open: vi.fn((_id: string): Promise<PrinterLink> =>
      t.failOpen
        ? Promise.reject(t.failOpen)
        : Promise.resolve({
            chunk: 4,
            paceMs: 0,
            write: async (b: Uint8Array) => {
              if (t.gate) await t.gate;
              t.sent.push(...b);
            },
            close: () => Promise.resolve(),
          }),
    ),
  };
  return t;
}
const classic = vi.hoisted(() => ({ t: null as unknown as ReturnType<typeof fakeTransport> }));
const ble = vi.hoisted(() => ({ t: null as unknown as ReturnType<typeof fakeTransport> }));
vi.mock("@/data/printerClassic", () => ({ get classicTransport(): PrinterTransport { return classic.t; } }));
vi.mock("@/data/printerBle", () => ({ get bleTransport(): PrinterTransport { return ble.t; } }));

import { PrintButton } from "./PrintButton";
import { PrinterSection } from "./PrinterSection";

const receipt = { shopName: "Gupta Kirana Store", receiptNumber: "514", rows: [], reprint: null } as unknown as Receipt;
const BT58: PrinterDevice = { id: "AA:BB", name: "BT-SRT-58", kind: "classic", printerLike: true };
const choose = (device: PrinterDevice, dots: 384 | 576 = 384) => localStorage.setItem("kb.printer.v1", JSON.stringify({ device, dots }));
const shop = { name: "Gupta Kirana Store", phone: "9876543210", billLanguage: "en" as const };

beforeEach(() => {
  env.native = true;
  rendered.calls = [];
  classic.t = fakeTransport("classic");
  ble.t = fakeTransport("ble");
  stubLocalStorage();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const printBtn = () => screen.getByRole("button", { name: "Print" });
const settle = () => act(async () => {});

describe("PrintButton", () => {
  it("is not there in a browser or the PWA", () => {
    env.native = false;
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
  });

  it("no printer chosen: one sentence pointing to Settings; nothing is opened", async () => {
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("No printer chosen — choose one in Settings → Printer.");
    expect(classic.t.open).not.toHaveBeenCalled();
  });

  it("prints at the chosen paper width to the chosen printer: ESC/POS bytes, 'Printing… N%' while it runs, then 'Printed'", async () => {
    choose(BT58, 576);
    let release: () => void = () => {};
    classic.t.gate = new Promise<void>((r) => (release = r));
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    expect(rendered.calls[0]!.dots).toBe(576);
    expect(classic.t.open).toHaveBeenCalledWith("AA:BB");
    expect(screen.getByRole("status").textContent).toMatch(/^Printing… \d+%$/);
    expect(printBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(printBtn()); // a second tap while printing does nothing
    release();
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Printed");
    expect(classic.t.sent.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(rendered.calls).toHaveLength(1);
    expect(printBtn().getAttribute("aria-disabled")).toBe("false");
  });

  it("a BLE printer is sent through the BLE transport", async () => {
    choose({ ...BT58, id: "ble-1", kind: "ble" });
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    expect(ble.t.open).toHaveBeenCalledWith("ble-1");
    expect(classic.t.open).not.toHaveBeenCalled();
  });

  it("after Bill Banao the first copy is the original; every later copy says REPRINT (owner, D110 item 8.10)", async () => {
    choose(BT58);
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    fireEvent.click(printBtn());
    await settle();
    expect(rendered.calls.map((c) => c.receipt.reprint ?? null)).toEqual([null, "REPRINT"]);
  });

  it("from History every copy says REPRINT", async () => {
    choose(BT58);
    render(<PrintButton receipt={receipt} firstIsOriginal={false} />);
    fireEvent.click(printBtn());
    await settle();
    expect(rendered.calls[0]!.receipt.reprint).toBe("REPRINT");
  });

  it("a failed first copy does not count: the next try is still the original", async () => {
    choose(BT58);
    classic.t.failOpen = new PrintError("unreachable");
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    classic.t.failOpen = null;
    fireEvent.click(printBtn());
    await settle();
    expect(rendered.calls.map((c) => c.receipt.reprint ?? null)).toEqual([null, null]);
  });

  it.each([
    ["unreachable", "Printer not connected — switch it on, keep it close and tap Print again. You can still share the bill."],
    ["bluetooth_off", "Bluetooth is off — turn it on and tap Print again."],
    ["permission", "Allow “Nearby devices” to print: phone Settings → Apps → Kirana Voice Bill → Permissions."],
    ["disconnected", "The printer stopped mid-print — tap Print to print the whole bill again."],
    ["no_bluetooth", "This phone has no Bluetooth."],
  ] as const)("%s: one sentence, and the button works again", async (kind, text) => {
    choose(BT58);
    classic.t.failReady = new PrintError(kind);
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(text);
    expect(printBtn().getAttribute("aria-disabled")).toBe("false");
  });

  it("speaks the screen language (Hindi)", async () => {
    const { setScreenLanguage } = await import("./screenLanguage");
    setScreenLanguage("hi");
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    expect(screen.getByRole("button", { name: "प्रिंट करें" })).toBeTruthy();
    setScreenLanguage("en");
  });
});

describe("Settings → Printer", () => {
  it("is not there in a browser or the PWA", () => {
    env.native = false;
    render(<PrinterSection shop={shop} />);
    expect(screen.queryByText("Printer")).toBeNull();
  });

  it("asks for Bluetooth permission only when Choose printer is tapped - never just by opening Settings", async () => {
    render(<PrinterSection shop={shop} />);
    await settle();
    expect(screen.getByText("No printer chosen")).toBeTruthy();
    expect(classic.t.ready).not.toHaveBeenCalled();
    expect(ble.t.ready).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose printer" }));
    await settle();
    expect(classic.t.ready).toHaveBeenCalledTimes(1);
  });

  it("choose: the paired printers are listed; tapping one saves it on this phone, 58 mm until changed", async () => {
    classic.t.devices = [BT58, { id: "CC", name: "KP307-UEWB", kind: "classic", printerLike: true }];
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose printer" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "KP307-UEWB" }));
    await settle();
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!)).toEqual({ device: { id: "CC", name: "KP307-UEWB", kind: "classic", printerLike: true }, dots: 384 });
    expect(screen.getByText("KP307-UEWB")).toBeTruthy();
  });

  it("paper size: 80 mm is saved as 576 dots", async () => {
    choose(BT58);
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("radio", { name: "80 mm (3 inch)" }));
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).dots).toBe(576);
  });

  it("nothing paired: the pairing hint; Search finds BLE printers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ble.t.devices = [{ id: "ble-1", name: "Printer_8A21", kind: "ble", printerLike: true }];
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose printer" }));
    await settle();
    expect(screen.getByText("No printer found. Pair it in the phone's Bluetooth settings, then come back.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search for Bluetooth LE printers" }));
    await settle();
    expect(ble.t.ready).toHaveBeenCalled();
    classic.t.failOpen = new PrintError("unreachable"); // it does not answer on Bluetooth Classic: a BLE-only printer
    fireEvent.click(screen.getByRole("button", { name: "Printer_8A21" }));
    await settle();
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).device.kind).toBe("ble");
    vi.useRealTimers();
  });

  // Owner's S6 (14 Nov 2026): the 58 mm printer was found only by the BLE search and lost bytes there. Classic is tried first.
  it("a printer found by the BLE search that also answers on Bluetooth Classic is saved as CLASSIC; 'Checking the printer…' shows meanwhile", async () => {
    ble.t.devices = [{ id: "AA:BB", name: "BT-SRT-58", kind: "ble", printerLike: true }];
    let answer: () => void = () => {};
    const waiting = new Promise<void>((r) => (answer = r));
    const realOpen = classic.t.open.getMockImplementation()!;
    classic.t.open.mockImplementationOnce(async (id: string) => {
      await waiting;
      return realOpen(id);
    });
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose printer" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Search for Bluetooth LE printers" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "BT-SRT-58" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Checking the printer…");
    expect(localStorage.getItem("kb.printer.v1")).toBeNull(); // nothing saved until it is known
    answer();
    await settle();
    expect(classic.t.open).toHaveBeenCalledWith("AA:BB");
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).device).toEqual({ id: "AA:BB", name: "BT-SRT-58", kind: "classic", printerLike: true });
  });

  it("a paired Classic printer is saved at once - no check needed", async () => {
    classic.t.devices = [BT58];
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose printer" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "BT-SRT-58" }));
    await settle();
    expect(classic.t.open).not.toHaveBeenCalled();
  });

  it("Long test print: 60 numbered lines, so a lost or shifted line is seen at a glance on paper", async () => {
    choose(BT58);
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Long test print (60 lines)" }));
    await settle();
    const r = rendered.calls[0]!.receipt;
    expect(r.reprint).toBe("TEST PRINT");
    expect(r.rows).toHaveLength(60);
    expect(r.rows.map((x) => x.amount)).toEqual(Array.from({ length: 60 }, (_, i) => `₹${i + 1}`));
    expect(r.rows[0]!.name).toMatch(/1$/);
    expect(r.rows[59]!.name).toMatch(/60$/);
    expect(r.total).toBe("₹1,830");
  });

  it("permission refused or Bluetooth off while choosing: the same sentences as printing", async () => {
    classic.t.failReady = new PrintError("permission");
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose printer" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("Allow “Nearby devices” to print: phone Settings → Apps → Kirana Voice Bill → Permissions.");
  });

  it("Test print tapped twice quickly prints once (KB-342)", async () => {
    choose(BT58);
    render(<PrinterSection shop={shop} />);
    const test = screen.getByRole("button", { name: "Test print" });
    fireEvent.click(test);
    fireEvent.click(test);
    await settle();
    expect(rendered.calls).toHaveLength(1);
  });

  it("Test print: a small receipt with the shop's name and hard Devanagari, marked TEST PRINT, at the chosen width", async () => {
    choose(BT58, 576);
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Test print" }));
    await settle();
    const { receipt: r, dots } = rendered.calls[0]!;
    expect(dots).toBe(576);
    expect(r.shopName).toBe("Gupta Kirana Store");
    expect(r.reprint).toBe("TEST PRINT");
    expect(r.rows.map((x) => x.name).join(" ")).toMatch(/क्ष/);
    expect(screen.getByRole("status").textContent).toBe("Printed");
  });
});
