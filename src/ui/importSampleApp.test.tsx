// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogImportSheet } from "./CatalogImportSheet";

// KB-414 step 3 (owner + reviewer, 17 Nov 2026): Import's "Download sample CSV" was a browser download - the Android app's WebView drops
// it (the same cause as step 2's PDF). In the app it saves to Downloads through our FileShare plugin and says so; the browser unchanged.

const env = vi.hoisted(() => ({ native: true, saveFile: vi.fn(async (_f: File): Promise<"saved" | "shared"> => "saved") }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));
vi.mock("@/data/nativeFileShare", () => ({ saveFile: env.saveFile }));

let anchorClick: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  env.native = true;
  env.saveFile.mockReset().mockResolvedValue("saved");
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const open = () => render(<CatalogImportSheet existing={[]} online run={vi.fn()} onClose={vi.fn()} />);
const tap = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Download sample CSV" })));

describe("Import's sample file", () => {
  it("in the Android app: saved to Downloads by the plugin (the CSV, its name and type), 'Saved to Downloads' - never a dropped download", async () => {
    open();
    await tap();
    expect(env.saveFile).toHaveBeenCalledOnce();
    const file = env.saveFile.mock.calls[0]![0];
    expect(file.name).toBe("kiranabill-products-sample.csv");
    expect(file.type).toBe("text/csv");
    expect(await file.text()).toContain("Name,Price,Unit");
    expect((await screen.findByText("Saved to Downloads")).getAttribute("role")).toBe("status");
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("Android 7-9 (the share sheet opened instead): no 'Saved' line; a failure says so", async () => {
    env.saveFile.mockResolvedValue("shared");
    open();
    await tap();
    expect(screen.queryByText("Saved to Downloads")).toBeNull();
    cleanup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env.saveFile.mockRejectedValue(new Error("SAVE_FAILED"));
    open();
    await tap();
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't open sharing — try again");
  });

  it("in the browser: today's download, the plugin never called", async () => {
    env.native = false;
    open();
    await tap();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect((anchorClick.mock.contexts[0] as HTMLAnchorElement).download).toBe("kiranabill-products-sample.csv");
    expect(env.saveFile).not.toHaveBeenCalled();
  });
});
