// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { OFFLINE_REASON, useVoiceBilling } from "./useVoiceBilling";

// Same minimal fakes as useVoiceCapture.test.ts: jsdom has no mic.
class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  start() {
    this.state = "recording";
    queueMicrotask(() => this.onstart?.());
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

/** tap (start) -> tap (stop) -> wait until the flow settles. */
async function speak(result: { current: ReturnType<typeof useVoiceBilling> }) {
  await act(async () => result.current.onMicTap());
  await waitFor(() => expect(result.current.view.phase).toBe("listening"));
  await act(async () => result.current.onMicTap());
  await waitFor(() => expect(["done", "failed"]).toContain(result.current.view.phase));
}

describe("useVoiceBilling", () => {
  it("tap -> listening -> tap -> transcript shown, then handed on for items", async () => {
    reply(200, { transcript: "  do kilo chini  " });
    const onTranscript = vi.fn(async () => {});
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt", onTranscript }));

    await speak(result);
    expect(result.current.view.phase).toBe("done");
    expect(result.current.view.transcript).toBe("do kilo chini");
    expect(onTranscript).toHaveBeenCalledWith("do kilo chini");
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ Authorization: "Bearer jwt" });
  });

  // Owner decision after the KB-302 measurement: "auto" wrote Hindi in Urdu
  // script; "hi" gave clean Devanagari with digits. Default = "hi".
  it("sends the Whisper language hint 'hi' by default; dev ?lang=auto sends no hint", async () => {
    const metaOf = (call: number) => JSON.parse((fetchMock.mock.calls[call]![1].body as FormData).get("meta") as string);
    reply(200, { transcript: "do kilo chini" });
    const first = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    await speak(first.result);
    expect(metaOf(0).language).toBe("hi");
    first.unmount();

    window.history.replaceState(null, "", "/?lang=auto");
    try {
      reply(200, { transcript: "do kilo chini" });
      const second = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
      await speak(second.result);
      expect(metaOf(1)).not.toHaveProperty("language");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("dev ?save=1 posts the recording + transcript + timings to the dev server; without it, nothing is sent", async () => {
    reply(200, { transcript: "do kilo chini" });
    const plain = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    await speak(plain.result);
    plain.unmount();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/voice"]);

    window.history.replaceState(null, "", "/?save=1");
    try {
      reply(200, { transcript: "do kilo chini" });
      reply(200, { saved: "2026-09-28T10-00-00-000Z" });
      const saving = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
      await speak(saving.result);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      const [url, init] = fetchMock.mock.calls[2]!;
      expect(url).toBe("/__dev/save-recording");
      const body = JSON.parse(init.body as string);
      expect(body.mime).toBe("audio/webm;codecs=opus");
      expect(atob(body.audioBase64)).toBe("audio");
      expect(body.meta).toMatchObject({ transcript: "do kilo chini", lang: "hi", outcome: "transcript only" });
      expect(typeof body.meta.stopToTranscriptMs).toBe("number");
      // KB-317 commit 4: the tap, split (D45) - cold/warm, getUserMedia vs recorder start.
      expect(body.meta).toMatchObject({ tap: "cold" });
      expect(typeof body.meta.getUserMediaMs).toBe("number");
      expect(typeof body.meta.recorderStartMs).toBe("number");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it.each([
    [401, "Session expired — sign out and sign in again"],
    [429, "Too many voice requests — wait a minute and try again"],
    [502, "Couldn't hear that — try again"],
  ])("/voice %i -> failed with an inline message, no throw", async (status, message) => {
    reply(status, { error: "x" });
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    await speak(result);
    expect(result.current.view).toMatchObject({ phase: "failed", message });
  });

  it("network failure -> 'No internet'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    await speak(result);
    expect(result.current.view.message).toBe("No internet — voice needs a connection");
  });

  it("an empty transcript -> 'Didn't catch anything', items never requested", async () => {
    reply(200, { transcript: "   " });
    const onTranscript = vi.fn(async () => {});
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt", onTranscript }));
    await speak(result);
    expect(result.current.view.message).toBe("Didn't catch anything — try again");
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("mic permission denied -> failed with the permission message", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) },
    });
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    await act(async () => result.current.onMicTap());
    await waitFor(() => expect(result.current.view.phase).toBe("failed"));
    expect(result.current.view.message).toBe("Mic permission denied — allow it in the browser's site settings");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offline-session mode (no live token): mic disabled with the reason, tapping does nothing", async () => {
    const { result } = renderHook(() => useVoiceBilling({ accessToken: null }));
    expect(result.current.view.disabledReason).toBe(OFFLINE_REASON);
    await act(async () => result.current.onMicTap());
    expect(result.current.view.phase).toBe("idle");
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  // KB-317 commit 4 (owner): signing out releases the warm mic at once - the
  // screen calls releaseMic() before signOut().
  it("releaseMic() turns a warm mic off at once (sign-out)", async () => {
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ readyState: "live", stop: trackStop }] })) },
    });
    reply(200, { transcript: "do kilo chini" });
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    await speak(result);
    expect(trackStop).not.toHaveBeenCalled(); // warm (D45)
    act(() => result.current.releaseMic());
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  // KB-317 commit 4 - a measurement for the owner's pointerdown question: how
  // much earlier than the click a press starts (dev log / ?save=1 meta only).
  it("dev ?save=1 records pointerdown -> tap ms when the press was seen; null when it wasn't", async () => {
    window.history.replaceState(null, "", "/?save=1");
    try {
      reply(200, { transcript: "do kilo chini" });
      reply(200, { saved: "x" });
      const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
      act(() => result.current.onMicPointerDown());
      await speak(result);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(typeof JSON.parse(fetchMock.mock.calls[1]![1].body as string).meta.pointerDownToTapMs).toBe("number");

      reply(200, { transcript: "do kilo chini" });
      reply(200, { saved: "y" });
      await speak(result); // no pointerdown this time (keyboard, say)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
      expect(JSON.parse(fetchMock.mock.calls[3]![1].body as string).meta.pointerDownToTapMs).toBeNull();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  // KB-317 (owner, 30 Sep): two silent taps in a row both logged "cold". The
  // warm stream must survive ANY outcome - an empty transcript, a failure, an
  // error from /voice - for 60 s after the recording ends.
  it.each([
    ["an empty transcript (silence)", () => reply(200, { transcript: "  " })],
    ["a /voice 502", () => reply(502, { error: "x" })],
    ["a network failure", () => fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ["a transcript whose items then fail", () => reply(200, { transcript: "kuch" })],
  ])("the warm mic survives %s: the next tap reuses the stream (one getUserMedia, not two)", async (_label, arrange) => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ readyState: "live", stop() {} }] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const onTranscript = vi.fn(async () => {
      throw new Error("items failed");
    });
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt", onTranscript }));
    arrange();
    await speak(result);
    reply(200, { transcript: "  " });
    await speak(result);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("the browser going offline disables the mic; coming back re-enables it", async () => {
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    expect(result.current.view.disabledReason).toBeNull();
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.view.disabledReason).toBe(OFFLINE_REASON);
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current.view.disabledReason).toBeNull();
  });
});
