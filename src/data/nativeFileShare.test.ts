import { beforeEach, describe, expect, it, vi } from "vitest";

// KB-414 step 2 phone check (owner, 17 Nov 2026): the web side of our FileShare plugin (android/.../FileSharePlugin.kt) - the file goes
// over as base64 with its name and type; PDF: Downloads, and where Android cannot (7-9: saved=false) the share sheet instead.

const plugin = vi.hoisted(() => ({
  share: vi.fn(async (_o: { name: string; mime: string; data: string; app?: string }) => ({})),
  saveToDownloads: vi.fn(async (_o: { name: string; mime: string; data: string }): Promise<{ saved: boolean; uri?: string }> => ({ saved: true, uri: "content://media/external/downloads/208" })),
  open: vi.fn(async (_o: { uri: string; mime: string }) => ({})),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: (name: string) => (name === "FileShare" ? plugin : null) }));

const { openFile, saveFile, shareFile, WHATSAPP } = await import("./nativeFileShare");

const png = new File([new Uint8Array([137, 80, 78, 71, 255, 0])], "Bill-519.png", { type: "image/png" });
const pdf = new File(["%PDF-1.4 x"], "Bill-519.pdf", { type: "application/pdf" });

beforeEach(() => {
  plugin.share.mockClear();
  plugin.saveToDownloads.mockReset().mockResolvedValue({ saved: true, uri: "content://media/external/downloads/208" });
  plugin.open.mockClear();
});

describe("shareFile", () => {
  it("sends the file's name, type and exact bytes (base64) to the share sheet", async () => {
    await shareFile(png);
    expect(plugin.share).toHaveBeenCalledWith({ name: "Bill-519.png", mime: "image/png", data: btoa(String.fromCharCode(137, 80, 78, 71, 255, 0)) });
  });
  it("to one app (WhatsApp) when asked", async () => {
    await shareFile(png, WHATSAPP);
    expect(WHATSAPP).toBe("com.whatsapp");
    expect(plugin.share.mock.calls[0]![0].app).toBe("com.whatsapp");
  });
});

describe("openFile (KB-414 step 3 phone check: 'Open' after a save)", () => {
  it("asks the plugin to open the saved file with the phone's viewer for its type", async () => {
    await openFile("content://media/external/downloads/208", "text/csv");
    expect(plugin.open).toHaveBeenCalledWith({ uri: "content://media/external/downloads/208", mime: "text/csv" });
  });
  it("no app to open it is an error for the screen to say (never silence)", async () => {
    plugin.open.mockRejectedValueOnce(Object.assign(new Error("No app"), { code: "NO_APP" }));
    await expect(openFile("content://x", "text/csv")).rejects.toThrow("No app");
  });
});

describe("saveFile", () => {
  it("Android 10+: saved in Downloads - no share sheet", async () => {
    // KB-414 step 3 phone check: where it was saved comes back, so "Open" can open it
    expect(await saveFile(pdf)).toEqual({ kind: "saved", uri: "content://media/external/downloads/208" });
    expect(plugin.saveToDownloads).toHaveBeenCalledWith({ name: "Bill-519.pdf", mime: "application/pdf", data: btoa("%PDF-1.4 x") });
    expect(plugin.share).not.toHaveBeenCalled();
  });
  it("Android 7-9 (saved=false): the share sheet with the PDF instead", async () => {
    plugin.saveToDownloads.mockResolvedValue({ saved: false });
    expect(await saveFile(pdf)).toEqual({ kind: "shared" });
    expect(plugin.share).toHaveBeenCalledWith({ name: "Bill-519.pdf", mime: "application/pdf", data: btoa("%PDF-1.4 x") });
  });
  it("a failed save is an error for the screen to show (never swallowed)", async () => {
    plugin.saveToDownloads.mockRejectedValue(new Error("SAVE_FAILED"));
    await expect(saveFile(pdf)).rejects.toThrow("SAVE_FAILED");
  });
});
