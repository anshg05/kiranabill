// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildReceipt, type ReceiptItem } from "@/domain/receipt";
import type { Paise } from "@/domain/money";
import { ShareBar } from "./ShareBar";
import { setScreenLanguage } from "./screenLanguage";
import { useReceiptShare, type RenderReceiptFiles } from "./useReceiptShare";

// KB-414 step 2 phone check (owner, 17 Nov 2026; the approved plan, B): in the Android app the page has NO share sheet (navigator.share
// is undefined in the WebView, read over USB) and the shell drops every download - so Share and PDF did nothing, on 13 and 15. In the
// app they go through our own Kotlin plugin (FileShare): Share = the phone's share sheet with the bill image; PDF = saved to Downloads
// ("Saved to Downloads"; Android 7-9: the share sheet instead); WhatsApp = the bill IMAGE straight to WhatsApp (the share sheet when
// WhatsApp is missing). SMS unchanged. In the browser nothing changes.

const env = vi.hoisted(() => ({
  native: false,
  shareFile: vi.fn(async (_f: File, _app?: string) => {}),
  saveFile: vi.fn(async (_f: File): Promise<"saved" | "shared"> => "saved"),
}));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));
vi.mock("@/data/nativeFileShare", () => ({ WHATSAPP: "com.whatsapp", shareFile: env.shareFile, saveFile: env.saveFile }));

const item: ReceiptItem = { displayName: "Chini", qty: 2, unit: "kg", ratePaise: 4800 as Paise, rateUnit: "kg", totalPaise: 9600 as Paise };
const receipt = buildReceipt({ receiptNumber: "519", customerName: "Cash", totalPaise: 9600 as Paise, finalizedAt: "2026-11-10T12:18:00.000Z", createdAt: "2026-11-10T12:18:00.000Z", status: "final" }, [item], { name: "Gupta Kirana Store", phone: null, logoUrl: null, billLanguage: "en" });
const saved = { localId: "bill-519", receiptNumber: "519", receipt };
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"], { type: "image/png" }), pdf: new Blob(["pdf"], { type: "application/pdf" }) });

let anchorClick: ReturnType<typeof vi.spyOn>;
let winOpen: ReturnType<typeof vi.fn>;
let webShare: ReturnType<typeof vi.fn>;
beforeEach(() => {
  env.native = true;
  env.shareFile.mockReset().mockResolvedValue(undefined);
  env.saveFile.mockReset().mockResolvedValue("saved");
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  winOpen = vi.fn(() => null);
  vi.stubGlobal("open", winOpen);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  webShare = vi.fn(async () => {});
  // even where a share sheet exists, the app uses the plugin (the WebView reports none - this proves the app path never depends on it)
  Object.defineProperty(navigator, "share", { value: webShare, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
});
afterEach(() => {
  cleanup();
  act(() => setScreenLanguage("en"));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Tiles() {
  const share = useReceiptShare({ localDb: null, saved, render: renderFiles });
  return share ? <ShareBar share={share} look="tiles" /> : null;
}
async function ready() {
  render(<Tiles />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Share" }).getAttribute("aria-disabled")).toBe("false"), { timeout: 4000 });
}
const tap = async (name: string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
const fileOf = (call: unknown[] | undefined) => call?.[0] as File;

describe("in the Android app (no web share sheet, downloads dropped)", () => {
  it("Share: the bill IMAGE through the plugin's share sheet - never a dropped download, never the web share", async () => {
    await ready();
    await tap("Share");
    expect(env.shareFile).toHaveBeenCalledOnce();
    expect(fileOf(env.shareFile.mock.calls[0]).name).toBe("Bill-519.png");
    expect(fileOf(env.shareFile.mock.calls[0]).type).toBe("image/png");
    expect(env.shareFile.mock.calls[0]![1]).toBeUndefined(); // the share sheet, no app chosen
    expect(anchorClick).not.toHaveBeenCalled();
    expect(webShare).not.toHaveBeenCalled();
  });

  it("PDF: saved to Downloads - 'Saved to Downloads' shows; no dropped download", async () => {
    await ready();
    await tap("PDF");
    expect(env.saveFile).toHaveBeenCalledOnce();
    expect(fileOf(env.saveFile.mock.calls[0]).name).toBe("Bill-519.pdf");
    expect(fileOf(env.saveFile.mock.calls[0]).type).toBe("application/pdf");
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Saved to Downloads");
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("PDF on Android 7-9 (Downloads cannot be written): the share sheet opened instead - no 'Saved' note", async () => {
    env.saveFile.mockResolvedValue("shared");
    await ready();
    await tap("PDF");
    expect(env.saveFile).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("WhatsApp: the bill IMAGE straight to WhatsApp (the plugin falls back to the share sheet when WhatsApp is missing) - not the text link", async () => {
    await ready();
    await tap("WhatsApp");
    expect(env.shareFile).toHaveBeenCalledOnce();
    expect(fileOf(env.shareFile.mock.calls[0]).name).toBe("Bill-519.png");
    expect(env.shareFile.mock.calls[0]![1]).toBe("com.whatsapp");
    expect(winOpen).not.toHaveBeenCalled();
    expect(webShare).not.toHaveBeenCalled();
  });

  it("a failure says so - 'Couldn't open sharing — try again' - never silence", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env.shareFile.mockRejectedValue(new Error("boom"));
    await ready();
    await tap("Share");
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Couldn't open sharing — try again");
  });

  it("a PDF that could not be saved says so too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env.saveFile.mockRejectedValue(new Error("SAVE_FAILED"));
    await ready();
    await tap("PDF");
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Couldn't open sharing — try again");
  });

  it("the notes in हिन्दी", async () => {
    act(() => setScreenLanguage("hi"));
    render(<Tiles />);
    await waitFor(() => expect(screen.getByRole("button", { name: "PDF" }).getAttribute("aria-disabled")).toBe("false"), { timeout: 4000 });
    await tap("PDF");
    expect((await screen.findByRole("status")).textContent).toBe("डाउनलोड में सेव हो गया");
  });

  it("SMS is unchanged: its sheet opens, nothing goes through the plugin", async () => {
    await ready();
    await tap("SMS");
    expect(screen.getByRole("region", { name: "Send SMS" })).toBeTruthy();
    expect(env.shareFile).not.toHaveBeenCalled();
  });

  it("a double tap shares once (KB-342's guard holds in the app too)", async () => {
    await ready();
    await tap("Share");
    await tap("Share");
    expect(env.shareFile).toHaveBeenCalledOnce();
  });
});

describe("in the browser: unchanged", () => {
  beforeEach(() => {
    env.native = false;
  });
  it("Share uses the web share sheet; PDF downloads; WhatsApp the web share sheet - the plugin is never called", async () => {
    await ready();
    await tap("Share");
    expect(webShare).toHaveBeenCalledOnce();
    await tap("PDF");
    expect(anchorClick).toHaveBeenCalledOnce();
    expect((anchorClick.mock.contexts[0] as HTMLAnchorElement).download).toBe("Bill-519.pdf");
    await tap("WhatsApp");
    expect(webShare).toHaveBeenCalledTimes(2);
    expect(env.shareFile).not.toHaveBeenCalled();
    expect(env.saveFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
