// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LocalVoiceRecording } from "@/data/db";
import { OrderEntries, OrderRecorder } from "./VoiceOrderPanel";

// KB-385 step 5 (owner, 10 Nov 2026; D101, doc 25 §5 and §8): the order recorder and the bill's recordings. Tap -> timer -> Pause /
// Resume -> Stop -> listen -> Re-record or Generate; the 4:30 warning; every state that is not a bill ends in Retry or Add by hand;
// "Heard: ..." is shown for every recording as soon as its answer lands (how the shopkeeper catches an ear mistake, A47).

class FakeRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) {}
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
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:rec"), revokeObjectURL: vi.fn() }));
  const track = { readyState: "live", stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const button = (name: RegExp | string) => screen.getByRole("button", { name });

describe("OrderRecorder", () => {
  it("tap -> recording with a timer -> Pause (time stops) -> Resume -> Stop -> listen, Re-record or Generate", async () => {
    const onGenerate = vi.fn();
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(65_000);
    expect(screen.getByText("1:05")).toBeTruthy();
    fireEvent.click(button("Pause"));
    await wait(30_000);
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy(); // paused time is not counted
    fireEvent.click(button("Resume"));
    await wait(5_000);
    await act(async () => void fireEvent.click(button("Stop")));
    expect(screen.getByLabelText("Listen to the recording").getAttribute("src")).toBe("blob:rec");
    expect(button("Re-record")).toBeTruthy();
    await act(async () => void fireEvent.click(button("Generate bill")));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(Math.round(onGenerate.mock.calls[0]![1] / 1000)).toBe(70);
    expect(button("Record order")).toBeTruthy(); // ready for the next one
  });

  it("Re-record throws the take away and starts again; nothing is generated", async () => {
    const onGenerate = vi.fn();
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(3_000);
    await act(async () => void fireEvent.click(button("Stop")));
    await act(async () => void fireEvent.click(button("Re-record")));
    expect(button("Pause")).toBeTruthy();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("the 4:30 warning, then the 5:00 stop goes to review by itself", async () => {
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(269_000);
    expect(screen.queryByText("Recording stops at 5:00")).toBeNull();
    await wait(2_000);
    expect(screen.getByText("Recording stops at 5:00")).toBeTruthy();
    await wait(30_000);
    expect(screen.getByText("Stopped at 5:00")).toBeTruthy();
    expect(button("Generate bill")).toBeTruthy();
  });

  it("under 1 s: 'Nothing recorded' -> Re-record or Add by hand", async () => {
    const onAddByHand = vi.fn();
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={onAddByHand} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(500);
    await act(async () => void fireEvent.click(button("Stop")));
    expect(screen.getByText("Nothing recorded")).toBeTruthy();
    fireEvent.click(button("Add by hand"));
    expect(onAddByHand).toHaveBeenCalledOnce();
    expect(button("Re-record")).toBeTruthy();
  });

  it("no microphone permission: the one-line help and Add by hand", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))) } });
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    expect(screen.getByText(/Mic permission denied/)).toBeTruthy();
    expect(button("Add by hand")).toBeTruthy();
  });

  it("with lines on the bill the button says 'Add more by voice' (the same flow)", () => {
    render(<OrderRecorder hasLines onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    expect(button("Add more by voice")).toBeTruthy();
  });

  it("a reason it cannot record yet (loading the catalog, no session) disables it and says why", () => {
    render(<OrderRecorder hasLines={false} disabledReason="Loading your catalog…" onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    expect((button("Record order") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Loading your catalog…")).toBeTruthy();
  });
});

const row = (over: Partial<LocalVoiceRecording>): LocalVoiceRecording => ({
  recordingId: over.recordingId ?? crypto.randomUUID(), shopId: "s", billLocalId: "b", bytes: new ArrayBuffer(1), mime: "audio/webm", recordedMs: 5_000,
  createdAt: new Date(Date.now() - 12_000).toISOString(), state: "queued", ...over,
});

function entries(recordings: LocalVoiceRecording[], over: { sending?: string[]; offline?: boolean } = {}) {
  const orders = { recordings, sending: new Set(over.sending ?? []), offline: over.offline ?? false, retry: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  const onAddByHand = vi.fn();
  render(<OrderEntries orders={orders} onAddByHand={onAddByHand} />);
  return { orders, onAddByHand };
}

describe("OrderEntries - each recording of the bill", () => {
  it("being read: 'Reading the order… N s' (the processing panel)", () => {
    const r = row({ state: "queued" });
    entries([r], { sending: [r.recordingId] });
    expect(screen.getByText("Reading the order… 12 s")).toBeTruthy();
  });

  it("offline: 'Saved — will send when online', Add by hand meanwhile", () => {
    entries([row({ state: "queued" })], { offline: true });
    expect(screen.getByText("Saved — will send when online")).toBeTruthy();
    expect(button("Add by hand")).toBeTruthy();
  });

  it.each([
    ["upload", "Couldn't send the recording"],
    ["start", "Couldn't send the recording"],
    ["session", "Signed out — sign in again, then Retry"],
    ["rate_limited", "Too many orders this hour — Retry later"],
    ["timeout", "Couldn't read the order"],
    ["failed", "Couldn't read the order"],
  ])("failed '%s': %s -> Retry (the SAME recording), Add by hand, Remove", (reason, text) => {
    const r = row({ state: "failed", reason });
    const { orders, onAddByHand } = entries([r]);
    expect(screen.getByText(text)).toBeTruthy();
    fireEvent.click(button("Retry"));
    expect(orders.retry).toHaveBeenCalledWith(r.recordingId);
    fireEvent.click(button("Add by hand"));
    expect(onAddByHand).toHaveBeenCalledWith("");
    fireEvent.click(button("Remove this recording"));
    expect(orders.remove).toHaveBeenCalledWith(r.recordingId);
  });

  it("no answer in time (gave up): 'Couldn't read the order' -> Retry / Add by hand", () => {
    entries([row({ state: "gave_up" })]);
    expect(screen.getByText("Couldn't read the order")).toBeTruthy();
    expect(button("Retry")).toBeTruthy();
    expect(button("Add by hand")).toBeTruthy();
  });

  it("answered: 'Heard: …' for EVERY recording of the bill (each add-more too), as soon as it lands", () => {
    entries([
      row({ state: "appended", transcript: "2 किलो चीनी 45 रुपए किलो", items: [{}] }),
      row({ state: "appended", transcript: "फुटाने 102 रुपए किलो", items: [{}] }),
    ]);
    expect(screen.getByText("Heard: “2 किलो चीनी 45 रुपए किलो”")).toBeTruthy();
    expect(screen.getByText("Heard: “फुटाने 102 रुपए किलो”")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("nothing understood: the transcript and 'No items found' -> Add by hand with those words", () => {
    const { onAddByHand } = entries([row({ state: "appended", transcript: "हाँ जी बोलिए", items: [] })]);
    expect(screen.getByText("Heard: “हाँ जी बोलिए”")).toBeTruthy();
    expect(screen.getByText("No items found")).toBeTruthy();
    fireEvent.click(button("Add by hand"));
    expect(onAddByHand).toHaveBeenCalledWith("हाँ जी बोलिए");
  });
});
