// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVoiceCapture } from "./useVoiceCapture";

// jsdom has no MediaRecorder or getUserMedia: a minimal fake of each, with
// the browser's real event order (start -> dataavailable -> stop).
class FakeRecorder {
  static mimeType = "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType = FakeRecorder.mimeType;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(public stream: MediaStream) {}
  start() {
    this.state = "recording";
    queueMicrotask(() => this.onstart?.());
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

function install(getUserMedia: () => Promise<unknown>) {
  const trackStop = vi.fn();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
  return { trackStop, stream: { getTracks: () => [{ stop: trackStop }] } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

describe("useVoiceCapture", () => {
  it("tap -> listening (timing recorded) -> stop -> a Blob in the recorder's own format; mic released", async () => {
    const env = install(async () => env.stream);
    const { result } = renderHook(() => useVoiceCapture());

    await act(() => result.current.start());
    expect(result.current.phase).toBe("listening");
    expect(result.current.error).toBeNull();
    expect(result.current.lastTapToListeningMs).toBeGreaterThanOrEqual(0);

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(result.current.phase).toBe("idle");
    expect(blob!.type).toBe("audio/webm;codecs=opus");
    expect(blob!.size).toBeGreaterThan(0);
    expect(env.trackStop).toHaveBeenCalled(); // the browser's mic indicator goes off
  });

  it.each([
    ["NotAllowedError", "permission", "Mic permission denied — allow it in the browser's site settings"],
    ["NotFoundError", "no-mic", "No microphone found"],
    ["AbortError", "failed", "The microphone didn't start — try again"],
  ])("getUserMedia %s -> '%s' error shown, back to idle, no throw", async (name, kind, message) => {
    install(async () => {
      throw new DOMException("x", name);
    });
    const { result } = renderHook(() => useVoiceCapture());
    await act(() => result.current.start());
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ kind, message });
  });

  it("no MediaRecorder in this browser -> 'unsupported'", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    const { result } = renderHook(() => useVoiceCapture());
    await act(() => result.current.start());
    expect(result.current.error?.kind).toBe("unsupported");
  });

  it("stop without a recording -> null, idle", async () => {
    install(async () => ({ getTracks: () => [] }));
    const { result } = renderHook(() => useVoiceCapture());
    let blob: Blob | null = new Blob();
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(blob).toBeNull();
    expect(result.current.phase).toBe("idle");
  });
});
