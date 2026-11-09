// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ORDER_RECORDING, useVoiceCapture } from "./useVoiceCapture";

// KB-385 step 2 (owner, 10 Nov 2026; D101, doc 25 §5 and §9): the ORDER recorder - Pause / Resume (paused time is not recorded), a
// timer of recorded time only, the 5:00 stop (the 4:30 warning is the screen's), "nothing recorded" under 1 s, 24 kbps, and an app
// going to the background KEEPS what was recorded (a 3-minute order is never thrown away). Without options the hook is unchanged.

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
    queueMicrotask(() => this.onstart?.());
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  FakeRecorder.instances = [];
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const track = { readyState: "live", stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

const wait = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("the order recorder (KB-385)", () => {
  it("the settings: 24 kbps, 5:00 stop, 4:30 warning, under 1 s is nothing", () => {
    expect(ORDER_RECORDING).toEqual({ bitsPerSecond: 24_000, maxMs: 300_000, warnAtMs: 270_000, minMs: 1_000 });
  });

  it("records at 24 kbps", async () => {
    const { result } = renderHook(() => useVoiceCapture(ORDER_RECORDING));
    await act(() => result.current.start());
    expect(FakeRecorder.instances[0]!.options).toEqual({ audioBitsPerSecond: 24_000 });
  });

  it("Pause / Resume: paused time is not recorded and not on the timer", async () => {
    const { result } = renderHook(() => useVoiceCapture(ORDER_RECORDING));
    await act(() => result.current.start());
    await wait(2_000);
    act(() => result.current.pause());
    expect(result.current.phase).toBe("paused");
    expect(FakeRecorder.instances[0]!.state).toBe("paused");
    await wait(10_000);
    act(() => result.current.resume());
    expect(result.current.phase).toBe("listening");
    await wait(1_000);
    expect(Math.round(result.current.elapsedMs / 250) * 250).toBe(3_000);
    let blob: Blob | null = null;
    await act(async () => void (blob = await result.current.stop()));
    expect(blob).not.toBeNull();
    expect(Math.round(result.current.elapsedMs / 100) * 100).toBe(3_000);
  });

  it("under 1 s recorded is nothing (stop gives null)", async () => {
    const { result } = renderHook(() => useVoiceCapture(ORDER_RECORDING));
    await act(() => result.current.start());
    await wait(600);
    let blob: Blob | null = new Blob(["x"]);
    await act(async () => void (blob = await result.current.stop()));
    expect(blob).toBeNull();
  });

  it("the 5:00 limit stops by itself and hands the recording on - paused time does not count", async () => {
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useVoiceCapture({ ...ORDER_RECORDING, onAutoStop }));
    await act(() => result.current.start());
    await wait(100_000);
    act(() => result.current.pause());
    await wait(500_000); // a long pause: still well under 5:00 RECORDED
    expect(onAutoStop).not.toHaveBeenCalled();
    act(() => result.current.resume());
    await wait(200_500);
    expect(onAutoStop).toHaveBeenCalledOnce();
    expect(onAutoStop.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(onAutoStop.mock.calls[0]![1]).toBe("limit");
    expect(result.current.phase).toBe("idle");
  });

  it("the app goes to the background mid-order: the recording so far is KEPT (handed on as 'hidden'), the mic goes off", async () => {
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useVoiceCapture({ ...ORDER_RECORDING, onAutoStop }));
    await act(() => result.current.start());
    await wait(30_000);
    await act(async () => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(onAutoStop).toHaveBeenCalledOnce();
    expect(onAutoStop.mock.calls[0]![1]).toBe("hidden");
    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe("idle");
  });

  it("without options nothing changes: no bitrate, a short recording is still returned", async () => {
    const { result } = renderHook(() => useVoiceCapture());
    await act(() => result.current.start());
    expect(FakeRecorder.instances[0]!.options).toBeUndefined();
    await wait(300);
    let blob: Blob | null = null;
    await act(async () => void (blob = await result.current.stop()));
    expect(blob).not.toBeNull();
  });
});
