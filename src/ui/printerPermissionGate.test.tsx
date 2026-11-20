// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { stubLocalStorage } from "./testStorage";

// KB-425 (owner, 20 Nov 2026; D123): Choose printer and the Bluetooth search ask appShell first (the Nearby devices card / Open
// Settings); a "no" touches no Bluetooth. Android's refusal goes back to appShell.

stubLocalStorage();
const gate = vi.hoisted(() => ({ allow: true, refused: 0 }));
const bt = vi.hoisted(() => ({ ready: 0, fail: false }));
vi.mock("@/data/appShell", () => ({ beforeAsking: async () => gate.allow, afterRefused: async () => void gate.refused++ }));
vi.mock("@/data/printerClassic", () => ({
  classicTransport: {
    ready: async () => {
      bt.ready++;
      if (bt.fail) throw Object.assign(new Error("Permission denied"), { code: "NO_PERMISSION" });
    },
    list: async () => [],
  },
}));
vi.mock("@/data/printerBle", () => ({ bleTransport: { ready: async () => void bt.ready++, list: async () => [] } }));
import { PrinterSection } from "./PrinterSection";

beforeEach(() => {
  gate.allow = true;
  gate.refused = 0;
  bt.ready = 0;
  bt.fail = false;
});
afterEach(cleanup);
const shop = { name: "Sharma Kirana", phone: null, billLanguage: "en" as const };
const choose = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Choose printer" })));

describe("Choose printer inside the app", () => {
  it("Not now on the card (or Open Settings shown): Bluetooth is not touched", async () => {
    gate.allow = false;
    render(<PrinterSection shop={shop} />);
    await choose();
    expect(bt.ready).toBe(0);
  });

  it("Allow: Bluetooth is asked for; Android's refusal goes back to appShell", async () => {
    bt.fail = true;
    render(<PrinterSection shop={shop} />);
    await choose();
    expect(bt.ready).toBe(1);
    expect(gate.refused).toBe(1);
  });
});
