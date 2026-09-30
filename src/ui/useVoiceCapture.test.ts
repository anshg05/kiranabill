// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVoiceCapture, WARM_MIC_MS } from "./useVoiceCapture";

// jsdom has no MediaRecorder or getUserMedia: a minimal fake of each, with
// the browser's real event order (start -> dataavailable -> stop). A track
// is "live" until stopped - stopping it is what turns the browser's mic
// indicator off.
class FakeRecorder {
  static mimeType = "audio/webm;codecs=opus";
  static instances: FakeRecorder[] = [];
  /** false: the test fires the start event itself (fireStart). */
  static autoStart = true;
  state: "inactive" | "recording" = "inactive";
  mimeType = FakeRecorder.mimeType;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(public stream: MediaStream) {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
    if (FakeRecorder.autoStart) queueMicrotask(() => this.onstart?.());
  }
  fireStart() {
    this.onstart?.();
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

interface FakeTrack {
  readyState: "live" | "ended";
  stop: ReturnType<typeof vi.fn>;
}

function fakeStream() {
  const track: FakeTrack = { readyState: "live", stop: vi.fn(() => (track.readyState = "ended")) };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

/** Each getUserMedia call opens a NEW fake stream (recorded in `streams`). */
function install(getUserMedia?: () => Promise<unknown>) {
  const streams: ReturnType<typeof fakeStream>[] = [];
  const gum = vi.fn(
    getUserMedia ??
      (async () => {
        const s = fakeStream();
        streams.push(s);
        return s.stream;
      }),
  );
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: gum } });
  return { gum, streams };
}

let visibility: DocumentVisibilityState = "visible";
function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.autoStart = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

async function record(result: { current: ReturnType<typeof useVoiceCapture> }): Promise<Blob | null> {
  await act(() => result.current.start());
  let blob: Blob | null = null;
  await act(async () => {
    blob = await result.current.stop();
  });
  return blob;
}

describe("useVoiceCapture", () => {
  it("tap -> listening (timing recorded) -> stop -> a Blob in the recorder's own format", async () => {
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());

    await act(() => result.current.start());
    expect(result.current.phase).toBe("listening");
    expect(result.current.error).toBeNull();
    expect(result.current.lastTiming?.tapToListeningMs).toBeGreaterThanOrEqual(0);

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(result.current.phase).toBe("idle");
    expect(blob!.type).toBe("audio/webm;codecs=opus");
    expect(blob!.size).toBeGreaterThan(0);
    expect(env.streams).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// KB-317 commit 4 - the warm mic (docs/07-DECISIONS.md D45; owner, 29 Sep 2026).
// ---------------------------------------------------------------------------
describe("warm mic (D45) - keep the stream 60 s, then release it", () => {
  it("a second tap within 60 s reuses the open stream: no second getUserMedia, a NEW MediaRecorder, timing says warm", async () => {
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());

    await record(result);
    expect(result.current.lastTiming).toMatchObject({ kind: "cold" });
    expect(env.streams[0]!.track.stop).not.toHaveBeenCalled(); // still open - warm

    await act(() => result.current.start());
    expect(result.current.phase).toBe("listening");
    expect(env.gum).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(FakeRecorder.instances[1]!.stream).toBe(env.streams[0]!.stream);
    expect(result.current.lastTiming).toMatchObject({ kind: "warm", getUserMediaMs: 0 });
  });

  it("the stream is released 60 s after the last recording ends - not a moment before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);

    act(() => vi.advanceTimersByTime(WARM_MIC_MS - 1));
    expect(env.streams[0]!.track.stop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(env.streams[0]!.track.stop).toHaveBeenCalledTimes(1);
    expect(WARM_MIC_MS).toBe(60_000);
  });

  it("after the 60 s release, the next tap opens the mic again (cold)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);
    act(() => vi.advanceTimersByTime(WARM_MIC_MS));

    await act(() => result.current.start());
    expect(env.gum).toHaveBeenCalledTimes(2);
    expect(result.current.lastTiming).toMatchObject({ kind: "cold" });
  });

  it("a tap inside the 60 s cancels the pending release - a recording is never cut off at the old deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);
    act(() => vi.advanceTimersByTime(30_000));

    await act(() => result.current.start()); // warm
    act(() => vi.advanceTimersByTime(WARM_MIC_MS)); // past the first recording's deadline, still speaking
    expect(result.current.phase).toBe("listening");
    expect(env.streams[0]!.track.stop).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.stop();
    });
    act(() => vi.advanceTimersByTime(WARM_MIC_MS));
    expect(env.streams[0]!.track.stop).toHaveBeenCalledTimes(1);
  });

  it("the tab going hidden releases a warm stream at once", async () => {
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);

    act(() => setVisibility("hidden"));
    expect(env.streams[0]!.track.stop).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    await act(() => result.current.start());
    expect(env.gum).toHaveBeenCalledTimes(2); // cold again
  });

  it("the tab going hidden MID-recording stops the recording, releases the mic, and says so", async () => {
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await act(() => result.current.start());

    act(() => setVisibility("hidden"));
    expect(env.streams[0]!.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances[0]!.state).toBe("inactive");
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ kind: "interrupted", message: "Recording stopped — the app went to the background. Tap to try again" });
  });

  it("a mic that opens after the tab went hidden is released at once - never recorded from", async () => {
    const opened = fakeStream();
    let resolveGum: (s: MediaStream) => void = () => {};
    install(() => new Promise((resolve) => (resolveGum = resolve)));
    const { result } = renderHook(() => useVoiceCapture());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start();
    });
    act(() => setVisibility("hidden"));
    await act(async () => {
      resolveGum(opened.stream);
      await pending;
    });
    expect(opened.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(result.current.phase).toBe("idle");
  });

  it("unmounting the billing screen releases a warm stream and leaves no timer behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = install();
    const { result, unmount } = renderHook(() => useVoiceCapture());
    await record(result);

    unmount();
    expect(env.streams[0]!.track.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("release() (sign-out) releases a warm stream at once", async () => {
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);

    act(() => result.current.release());
    expect(env.streams[0]!.track.stop).toHaveBeenCalledTimes(1);
  });

  it("a warm track that has ended (mic unplugged, permission revoked, device slept) is never recorded from - a fresh stream is opened", async () => {
    const env = install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);
    env.streams[0]!.track.readyState = "ended"; // the browser ended it - nobody called stop()

    await act(() => result.current.start());
    expect(env.gum).toHaveBeenCalledTimes(2);
    expect(FakeRecorder.instances.at(-1)!.stream).toBe(env.streams[1]!.stream);
    expect(result.current.lastTiming).toMatchObject({ kind: "cold" });
  });

  it("timing splits the tap: getUserMedia vs MediaRecorder start, cold vs warm", async () => {
    install();
    const { result } = renderHook(() => useVoiceCapture());
    await record(result);
    const cold = result.current.lastTiming!;
    expect(cold.kind).toBe("cold");
    expect(cold.getUserMediaMs).toBeGreaterThanOrEqual(0);
    expect(cold.recorderStartMs).toBeGreaterThanOrEqual(0);
    expect(cold.tapToListeningMs).toBeGreaterThanOrEqual(cold.getUserMediaMs + cold.recorderStartMs - 1);

    await record(result);
    expect(result.current.lastTiming).toMatchObject({ kind: "warm", getUserMediaMs: 0 });
  });
});

// HARD RULE (owner, D45): "listening" is shown only once MediaRecorder has
// ACTUALLY started - a word spoken before that is lost, and a lost word is a
// wrong quantity. Never optimistically, cold or warm.
describe("HARD RULE - listening only on MediaRecorder's actual start", () => {
  it.each([["cold"], ["warm"]])("%s tap: not listening until the recorder's start event fires", async (kind) => {
    install();
    const { result } = renderHook(() => useVoiceCapture());
    if (kind === "warm") await record(result);

    FakeRecorder.autoStart = false;
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)); // let getUserMedia and every microtask settle
    });
    expect(result.current.phase).not.toBe("listening");
    expect(FakeRecorder.instances.at(-1)!.state).toBe("recording"); // start() was called...

    await act(async () => {
      FakeRecorder.instances.at(-1)!.fireStart(); // ...but only its start EVENT means listening
      await pending;
    });
    expect(result.current.phase).toBe("listening");
  });
});
