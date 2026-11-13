// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// KB-406 (found in the owner's S2 check, 13 Nov 2026): @capacitor/app 8.1.2 swallows Android Back when the web view cannot go back
// (AppPlugin.java: it only calls goBack() when canGoBack) - on the main screen Back did nothing. The app now handles Back itself.

const cap = vi.hoisted(() => ({
  native: true,
  listener: null as ((e: { canGoBack: boolean }) => void) | null,
  adds: 0,
  minimizeApp: vi.fn(() => Promise.resolve()),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => cap.native } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (name: string, cb: (e: { canGoBack: boolean }) => void) => {
      if (name === "backButton") {
        cap.adds++;
        cap.listener = cb;
      }
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    minimizeApp: cap.minimizeApp,
  },
}));

import { startNativeBack } from "./nativeBack";

beforeEach(() => {
  cap.native = true;
  cap.listener = null;
  cap.adds = 0;
  cap.minimizeApp.mockClear();
  vi.restoreAllMocks();
});

describe("Android Back inside the app", () => {
  it("with something to go back to (a sheet, History, Settings, the menu): goes back - the open layer closes as before", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    startNativeBack();
    cap.listener!({ canGoBack: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(cap.minimizeApp).not.toHaveBeenCalled();
  });

  it("on the main screen (nothing to go back to): the app goes to the background - never killed, the draft stays", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    startNativeBack();
    cap.listener!({ canGoBack: false });
    expect(cap.minimizeApp).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("is never registered in a browser or the PWA (their Back is the browser's own)", () => {
    cap.native = false;
    startNativeBack();
    expect(cap.adds).toBe(0);
  });
});
