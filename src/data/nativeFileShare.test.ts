import { beforeEach, describe, expect, it, vi } from "vitest";

// KB-414 step 2 phone check (owner, 17 Nov 2026): the web side of our FileShare plugin (android/.../FileSharePlugin.kt) - the file goes
// over as base64 with its name and type; PDF: Downloads, and where Android cannot (7-9: saved=false) the share sheet instead.

const plugin = vi.hoisted(() => ({
  share: vi.fn(async (_o: { name: string; mime: string; data: string; app?: string }) => ({})),
  saveToDownloads: vi.fn(async (_o: { name: string; mime: string; data: string }) => ({ saved: true })),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: (name: string) => (name === "FileShare" ? plugin : null) }));

const { savePdf, shareFile, WHATSAPP } = await import("./nativeFileShare");

const png = new File([new Uint8Array([137, 80, 78, 71, 255, 0])], "Bill-519.png", { type: "image/png" });
const pdf = new File(["%PDF-1.4 x"], "Bill-519.pdf", { type: "application/pdf" });

beforeEach(() => {
  plugin.share.mockClear();
  plugin.saveToDownloads.mockReset().mockResolvedValue({ saved: true });
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

describe("savePdf", () => {
  it("Android 10+: saved in Downloads - no share sheet", async () => {
    expect(await savePdf(pdf)).toBe("saved");
    expect(plugin.saveToDownloads).toHaveBeenCalledWith({ name: "Bill-519.pdf", mime: "application/pdf", data: btoa("%PDF-1.4 x") });
    expect(plugin.share).not.toHaveBeenCalled();
  });
  it("Android 7-9 (saved=false): the share sheet with the PDF instead", async () => {
    plugin.saveToDownloads.mockResolvedValue({ saved: false });
    expect(await savePdf(pdf)).toBe("shared");
    expect(plugin.share).toHaveBeenCalledWith({ name: "Bill-519.pdf", mime: "application/pdf", data: btoa("%PDF-1.4 x") });
  });
  it("a failed save is an error for the screen to show (never swallowed)", async () => {
    plugin.saveToDownloads.mockRejectedValue(new Error("SAVE_FAILED"));
    await expect(savePdf(pdf)).rejects.toThrow("SAVE_FAILED");
  });
});
