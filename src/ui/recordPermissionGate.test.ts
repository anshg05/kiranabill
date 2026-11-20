// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// KB-425 (owner, 20 Nov 2026; D123): inside the app, Record asks appShell first (the mic card / Open Settings); a "no" opens no mic.
// A refusal from Android goes back to appShell (Open Settings when Android will not ask again).

const gate = vi.hoisted(() => ({ allow: true, refused: 0 }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => true }));
vi.mock("@/data/appShell", () => ({ beforeAsking: async () => gate.allow, afterRefused: async () => void gate.refused++ }));
import { useVoiceCapture } from "./useVoiceCapture";

let gum: ReturnType<typeof vi.fn>;
beforeEach(() => {
  gate.allow = true;
  gate.refused = 0;
  vi.stubGlobal("MediaRecorder", class {});
  gum = vi.fn(async () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: gum } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Record inside the app", () => {
  it("Not now on the card (or Open Settings shown): no mic is opened, no error line", async () => {
    gate.allow = false;
    const { result } = renderHook(() => useVoiceCapture());
    await act(async () => void (await result.current.start()));
    expect(gum).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("Allow: the mic is asked for; Android's refusal goes back to appShell", async () => {
    const { result } = renderHook(() => useVoiceCapture());
    await act(async () => void (await result.current.start()));
    expect(gum).toHaveBeenCalledTimes(1);
    expect(result.current.error?.kind).toBe("permission");
    expect(gate.refused).toBe(1);
  });
});
