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

  it("the browser going offline disables the mic; coming back re-enables it", async () => {
    const { result } = renderHook(() => useVoiceBilling({ accessToken: "jwt" }));
    expect(result.current.view.disabledReason).toBeNull();
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.view.disabledReason).toBe(OFFLINE_REASON);
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current.view.disabledReason).toBeNull();
  });
});
