// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { LongTestPrint, PrinterSection } from "./PrinterSection";

const receipt = { shopName: "Gupta Kirana Store", receiptNumber: "514", rows: [], reprint: null } as unknown as Receipt;
const BT58: PrinterDevice = { id: "AA:BB", name: "BT-SRT-58", kind: "classic", printerLike: true };
const choose = (device: PrinterDevice, dots: 384 | 576 = 384, compat = false) => localStorage.setItem("kb.printer.v1", JSON.stringify({ device, dots, compat }));
const ESC_STAR = [0x1b, 0x2a, 33];
const GS_V_0 = [0x1d, 0x76, 0x30];
const has = (bytes: number[], seq: number[]) => bytes.some((_, i) => seq.every((b, k) => bytes[i + k] === b));
const shop = { name: "Gupta Kirana Store", phone: "9876543210", billLanguage: "en" as const };

beforeEach(() => {
  env.native = true;
  rendered.calls = [];
  classic.t = fakeTransport("classic");
  ble.t = fakeTransport("ble");
  stubLocalStorage();
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await new Promise((r) => setTimeout(r, 30)); // an inner page's Back entry settles (as more17.test.tsx) - else it closes the next test's page
});

const printBtn = () => screen.getByRole("button", { name: /^(Print bill|Reprint)$/ }); // KB-414 step 2: 13 "Print bill", 15 "Reprint"
const settle = () => act(async () => {});
/**
 * KB-431 (owner, 19 Nov 2026): wait until print number `n` has FINISHED - its result on screen ("Printed", or the failure sentence)
 * and the button usable again - before the next tap. PrintButton ignores a tap while printing (PrintButton.tsx:24), so a second
 * tap after a fixed wait was sometimes swallowed. The last settle lets the print's own .then (the "printed once" mark) run.
 */
const printFinished = async (n: number) => {
  await waitFor(() => {
    expect(rendered.calls).toHaveLength(n);
    expect(screen.queryByText("Printed") ?? screen.queryByRole("alert")).toBeTruthy();
    expect(printBtn().getAttribute("aria-disabled")).not.toBe("true");
  });
  await settle();
};

describe("PrintButton", () => {
  it("is not there in a browser or the PWA", () => {
    env.native = false;
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    expect(screen.queryByRole("button", { name: "Print bill" })).toBeNull();
  });

  it("no printer chosen: one sentence pointing to Settings; nothing is opened", async () => {
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("No printer chosen — choose one in More → Printer.");
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
    expect(printBtn().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("Compatible mode OFF: the image goes as GS v 0 raster; ON: the same image as ESC * bit image - never both", async () => {
    choose(BT58, 384, false);
    const first = render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await printFinished(1); // KB-431 (20 Nov 2026): a fixed wait failed twice under load - wait for the print to finish
    expect(has(classic.t.sent, GS_V_0)).toBe(true);
    expect(has(classic.t.sent, ESC_STAR)).toBe(false);
    first.unmount();
    classic.t.sent = [];
    choose(BT58, 384, true);
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await printFinished(2);
    expect(has(classic.t.sent, ESC_STAR)).toBe(true);
    expect(has(classic.t.sent, GS_V_0)).toBe(false);
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
    await printFinished(1);
    fireEvent.click(printBtn());
    await printFinished(2);
    expect(rendered.calls.map((c) => c.receipt.reprint ?? null)).toEqual([null, "REPRINT"]);
  });

  it("from History every copy says REPRINT", async () => {
    choose(BT58);
    render(<PrintButton receipt={receipt} firstIsOriginal={false} />);
    expect(screen.getByRole("button", { name: "Reprint" })).toBeTruthy(); // 15-BillDetail's words
    fireEvent.click(printBtn());
    await settle();
    expect(rendered.calls[0]!.receipt.reprint).toBe("REPRINT");
  });

  it("a failed first copy does not count: the next try is still the original", async () => {
    choose(BT58);
    classic.t.failOpen = new PrintError("unreachable");
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    fireEvent.click(printBtn());
    await printFinished(1);
    expect(screen.getByRole("alert")).toBeTruthy(); // the first copy failed
    classic.t.failOpen = null;
    fireEvent.click(printBtn());
    await printFinished(2);
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
    expect(printBtn().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("speaks the screen language (Hindi)", async () => {
    const { setScreenLanguage } = await import("./screenLanguage");
    setScreenLanguage("hi");
    render(<PrintButton receipt={receipt} firstIsOriginal />);
    expect(screen.getByRole("button", { name: "बिल प्रिंट करें" })).toBeTruthy();
    setScreenLanguage("en");
  });
});

// KB-414 step 4 + KB-416 (owner, 20 Nov 2026; D125): More -> Printer (18) and Choose printer (22). The row is there only in the Android app
// (more17.test.tsx). Here the app has no "scan already allowed" (appShell's plugin is absent in tests): Choose printer lists the paired
// printers and the search waits for a tap - the automatic search is printerPermissionGate.test.tsx.
const connect = (name: string) => screen.getByRole("button", { name: `Connect ${name}` });
const openChoose = async (label: "Choose printer" | "Change" = "Choose printer") => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  // the Nearby devices check asks appShell's plugin first (absent here: Capacitor answers "not available" a few ticks later)
  await screen.findByRole("heading", { level: 1, name: "Choose printer" });
  await waitFor(() => expect(classic.t.list.mock.calls.length + (classic.t.failReady ? 1 : 0)).toBeGreaterThan(0));
  await settle();
};

describe("More → Printer (18) and Choose printer (22)", () => {
  it("opening the page touches no Bluetooth; Choose printer asks only for the paired list - never the search by itself", async () => {
    render(<PrinterSection shop={shop} />);
    await settle();
    expect(screen.getByText("No printer chosen")).toBeTruthy();
    expect(classic.t.ready).not.toHaveBeenCalled();
    expect(ble.t.ready).not.toHaveBeenCalled();
    await openChoose();
    expect(classic.t.ready).toHaveBeenCalledTimes(1);
    expect(ble.t.ready).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Search for new printers" })).toBeTruthy();
  });

  it("22: the paired printers at once, each marked Paired with Connect; Connect saves it (58 mm until changed) and goes back to 18", async () => {
    classic.t.devices = [BT58, { id: "CC", name: "KP307-UEWB", kind: "classic", printerLike: true }];
    render(<PrinterSection shop={shop} />);
    await openChoose();
    expect(screen.getByRole("heading", { level: 1, name: "Choose printer" })).toBeTruthy();
    expect(screen.getByText("Found nearby")).toBeTruthy();
    expect(screen.getAllByText("Paired")).toHaveLength(2);
    fireEvent.click(connect("KP307-UEWB"));
    await settle();
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!)).toEqual({ device: { id: "CC", name: "KP307-UEWB", kind: "classic", printerLike: true }, dots: 384, compat: false });
    expect(screen.queryByRole("heading", { level: 1, name: "Choose printer" })).toBeNull();
    expect(screen.getByText("KP307-UEWB")).toBeTruthy();
    expect(screen.getByText("Bluetooth · Paired")).toBeTruthy();
  });

  it("owner (20 Nov 2026): the printer chosen BEFORE this update keeps working - same printer, paper size and Compatible mode, nothing to choose again", async () => {
    choose(BT58, 576, true); // exactly what the earlier app saved under kb.printer.v1
    render(<PrinterSection shop={shop} />);
    expect(screen.getByText("BT-SRT-58")).toBeTruthy();
    expect(screen.getByText("Bluetooth · Paired")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "80 mm (3 inch)" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Compatible mode (for older printers)" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Test print" }));
    await settle();
    expect(classic.t.open).toHaveBeenCalledWith("AA:BB");
    expect(rendered.calls[0]!.dots).toBe(576);
    expect(has(classic.t.sent, ESC_STAR)).toBe(true);
  });

  it("18: the status line says the truth - Paired for Bluetooth Classic, Bluetooth LE for a searched one, never 'Connected'", async () => {
    choose({ id: "ble-1", name: "Printer_8A21", kind: "ble", printerLike: true });
    render(<PrinterSection shop={shop} />);
    expect(screen.getByText("Bluetooth LE")).toBeTruthy();
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("18: the preview at the chosen paper width, with the shop's name; left out: Print after Bill Banao, Copies, Show shop phone, Long test print", async () => {
    choose(BT58);
    render(<PrinterSection shop={shop} />);
    const preview = () => screen.getByRole("figure", { name: /preview/ });
    const width = () => Number((preview().querySelector("[data-paper-width]") as HTMLElement).dataset.paperWidth);
    expect(screen.getByText("58 mm preview · Long lines wrap so nothing is cut off.")).toBeTruthy();
    expect(within(preview()).getByText("Gupta Kirana Store")).toBeTruthy();
    const narrow = width();
    fireEvent.click(screen.getByRole("radio", { name: "80 mm (3 inch)" }));
    expect(screen.getByText("80 mm preview · Long lines wrap so nothing is cut off.")).toBeTruthy();
    expect(width()).toBeGreaterThan(narrow);
    for (const gone of [/Print after Bill Banao/, /Copies/, /Show shop phone/, /Long test print/]) expect(screen.queryByText(gone)).toBeNull();
  });

  it("Compatible mode: a switch with its one-line hint, OFF by default; switching it is saved on this phone", async () => {
    choose(BT58);
    render(<PrinterSection shop={shop} />);
    const sw = screen.getByRole("switch", { name: "Compatible mode (for older printers)" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Turn on if your printer prints strange symbols.")).toBeTruthy();
    fireEvent.click(sw);
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).compat).toBe(true);
    fireEvent.click(sw);
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).compat).toBe(false);
  });

  it("Compatible mode and the paper size are kept when the printer changes; the current printer is marked Chosen", async () => {
    choose(BT58, 384, true);
    classic.t.devices = [BT58, { id: "CC", name: "KP307-UEWB", kind: "classic", printerLike: true }];
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("radio", { name: "80 mm (3 inch)" }));
    await openChoose("Change");
    expect(screen.getByText("Chosen")).toBeTruthy();
    fireEvent.click(connect("KP307-UEWB"));
    await settle();
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!)).toMatchObject({ device: { id: "CC" }, dots: 576, compat: true });
  });

  it("Test print uses Compatible mode too", async () => {
    choose(BT58, 384, true);
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Test print" }));
    await settle();
    expect(has(classic.t.sent, ESC_STAR)).toBe(true);
    expect(has(classic.t.sent, GS_V_0)).toBe(false);
  });

  it("paper size: 80 mm is saved as 576 dots", async () => {
    choose(BT58);
    render(<PrinterSection shop={shop} />);
    fireEvent.click(screen.getByRole("radio", { name: "80 mm (3 inch)" }));
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).dots).toBe(576);
  });

  it("nothing paired: 'No printer found yet', the pairing tip with Bluetooth settings; Search for new printers finds a BLE printer (New device)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ble.t.devices = [{ id: "ble-1", name: "Printer_8A21", kind: "ble", printerLike: true }];
    render(<PrinterSection shop={shop} />);
    await openChoose();
    expect(screen.getByText("No printer found yet.")).toBeTruthy();
    expect(screen.getByText("Not listed? Pair it once in your phone's Bluetooth settings (PIN is usually 0000 or 1234), then come back.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bluetooth settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search for new printers" }));
    await settle();
    expect(ble.t.ready).toHaveBeenCalledTimes(1);
    expect(screen.getByText("New device")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search again" })).toBeTruthy();
    classic.t.failOpen = new PrintError("unreachable"); // it does not answer on Bluetooth Classic: a BLE-only printer
    fireEvent.click(connect("Printer_8A21"));
    await settle();
    expect(JSON.parse(localStorage.getItem("kb.printer.v1")!).device.kind).toBe("ble");
    vi.useRealTimers();
  });

  it("a printer both paired and found by the search is listed ONCE, as Paired", async () => {
    classic.t.devices = [BT58];
    ble.t.devices = [{ id: "AA:BB", name: "BT-SRT-58", kind: "ble", printerLike: true }];
    render(<PrinterSection shop={shop} />);
    await openChoose();
    fireEvent.click(screen.getByRole("button", { name: "Search for new printers" }));
    await settle();
    expect(screen.getAllByRole("button", { name: "Connect BT-SRT-58" })).toHaveLength(1);
    expect(screen.queryByText("New device")).toBeNull();
  });

  // Owner's S6 (14 Nov 2026): the 58 mm printer was found only by the BLE search and lost bytes there. Classic is tried first.
  it("a printer found only by the search that also answers on Bluetooth Classic is saved as CLASSIC; 'Checking the printer…' shows meanwhile", async () => {
    ble.t.devices = [{ id: "AA:BB", name: "BT-SRT-58", kind: "ble", printerLike: true }];
    let answer: () => void = () => {};
    const waiting = new Promise<void>((r) => (answer = r));
    const realOpen = classic.t.open.getMockImplementation()!;
    classic.t.open.mockImplementationOnce(async (id: string) => {
      await waiting;
      return realOpen(id);
    });
    render(<PrinterSection shop={shop} />);
    await openChoose();
    fireEvent.click(screen.getByRole("button", { name: "Search for new printers" }));
    await settle();
    fireEvent.click(connect("BT-SRT-58"));
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
    await openChoose();
    fireEvent.click(connect("BT-SRT-58"));
    await settle();
    expect(classic.t.open).not.toHaveBeenCalled();
  });

  it("permission refused or Bluetooth off while choosing: the same sentences as printing", async () => {
    classic.t.failReady = new PrintError("permission");
    render(<PrinterSection shop={shop} />);
    await openChoose();
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

// KB-416 (owner, 20 Nov 2026): the 60-line stress test lives in More -> Developer now.
describe("Long test print (Developer)", () => {
  it("60 numbered lines, at the chosen width and mode, so a lost or shifted line is seen at a glance on paper", async () => {
    choose(BT58, 384, true);
    render(<LongTestPrint shop={shop} />);
    fireEvent.click(screen.getByRole("button", { name: "Long test print (60 lines)" }));
    await settle();
    const r = rendered.calls[0]!.receipt;
    expect(r.reprint).toBe("TEST PRINT");
    expect(r.rows).toHaveLength(60);
    expect(r.rows.map((x) => x.amount)).toEqual(Array.from({ length: 60 }, (_, i) => `₹${i + 1}`));
    expect(r.total).toBe("₹1,830");
    expect(has(classic.t.sent, ESC_STAR)).toBe(true);
  });

  it("no printer chosen: nothing to print, so no button", () => {
    render(<LongTestPrint shop={shop} />);
    expect(screen.queryByRole("button", { name: "Long test print (60 lines)" })).toBeNull();
  });
});
