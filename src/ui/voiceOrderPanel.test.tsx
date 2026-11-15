// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LocalVoiceRecording } from "@/data/db";
import { OrderEntries, OrderRecorder, type TakeStore } from "./VoiceOrderPanel";

const env = vi.hoisted(() => ({ native: false }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));

/** the phone's saved recording, in memory (src/data/recordingDraft.ts in the app) - one per shop, like the real one */
function memoryStore(failSave = false) {
  let saved: { audio: Blob; recordedMs: number; stopped?: "limit" | "hidden" } | null = null;
  const store: TakeStore & { peek: () => typeof saved } = {
    load: async () => saved,
    save: async (t) => {
      if (failSave) throw new Error("storage full");
      saved = t;
    },
    clear: async () => void (saved = null),
    peek: () => saved,
  };
  return store;
}
import { setScreenLanguage } from "./screenLanguage";

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
  it("tap -> 09 Recording (full screen) with a timer -> Pause (time stops) -> Resume -> Stop -> 10 Review -> Generate", async () => {
    const onGenerate = vi.fn();
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={vi.fn()} takes={memoryStore()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    const rec = screen.getByRole("dialog", { name: "New voice bill" });
    expect(rec.getAttribute("aria-modal")).toBe("true");
    await wait(65_000);
    expect(within(rec).getByText("01:05")).toBeTruthy(); // 09 draws "00:42"
    expect(within(rec).getByText("of 5:00")).toBeTruthy();
    expect(within(rec).getByText("Recording")).toBeTruthy();
    const ring = () => rec.querySelector("[class*='inset-[18px]']")!.getAttribute("class")!;
    expect(ring()).toContain("animate-kb-pulse"); // recording: the ring pulses
    fireEvent.click(button("Pause"));
    await wait(30_000);
    expect(within(rec).getByText("Paused")).toBeTruthy();
    expect(within(rec).getByText("01:05")).toBeTruthy(); // paused time is not counted
    expect(ring()).not.toContain("animate-kb-pulse"); // owner (15 Nov 2026): paused, the ring stands still (and stays visible - batchC)
    expect(ring()).toContain("scale-[1.28]");
    fireEvent.click(button("Resume"));
    await wait(0);
    expect(ring()).toContain("animate-kb-pulse");
    await wait(5_000);
    await act(async () => void fireEvent.click(button("Stop")));
    const review = screen.getByRole("dialog", { name: "Check your recording" });
    expect(within(review).getByText("Recording ready")).toBeTruthy();
    expect(within(review).getByText("1:10 · saved on this phone")).toBeTruthy();
    expect(document.querySelector("audio")!.getAttribute("src")).toBe("blob:rec");
    expect(button("Re-record")).toBeTruthy();
    await act(async () => void fireEvent.click(button("Generate bill")));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(Math.round(onGenerate.mock.calls[0]![1] / 1000)).toBe(70);
    expect(screen.queryByRole("dialog")).toBeNull(); // back on the bill (11 Generating is step 3)
    expect(button("Record order")).toBeTruthy(); // ready for the next one
  });

  it("09 as drawn: the tip with its bold words, the 'saved' line, the mic circle, 26 bars; Pause secondary / Stop primary (wider)", async () => {
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    const rec = screen.getByRole("dialog", { name: "New voice bill" });
    expect(within(rec).getByText("item · quantity · price").tagName).toBe("B");
    expect(within(rec).getByText("Saved on this phone when you stop")).toBeTruthy();
    expect(rec.querySelectorAll("[class*='w-[5px]']")).toHaveLength(26);
    expect(rec.querySelector("[class*='w-[210px]']")).toBeTruthy();
    expect(button("Pause").className).toContain("flex-1");
    expect(button("Stop").className).toContain("flex-[1.4]");
    expect(button("Stop").className).toContain("bg-kb-primary");
    expect(button("Back").closest("header")!.textContent).toContain("New voice bill");
    // step-2 fix 2: the 22 px spaces shrink (to 8) before anything is cut - never a fixed gap
    const spaces = rec.querySelectorAll("[class*='flex-[0_1_22px]']");
    expect(spaces.length).toBe(4);
    expect(rec.querySelector("[class*='gap-[22px]']")).toBeNull();
  });

  it("Re-record asks 'Discard recording?' first (owner, answer 5): Keep stays on 10; Discard deletes the saved one and records again", async () => {
    const onGenerate = vi.fn();
    const takes = memoryStore();
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={vi.fn()} takes={takes} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(3_000);
    await act(async () => void fireEvent.click(button("Stop")));
    fireEvent.click(button("Re-record"));
    const ask = screen.getByRole("dialog", { name: "Discard recording?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Keep recording" }));
    expect(screen.getByRole("dialog", { name: "Check your recording" })).toBeTruthy();
    expect(takes.peek()).not.toBeNull();
    fireEvent.click(button("Re-record"));
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog", { name: "Discard recording?" })).getByRole("button", { name: "Discard" })));
    expect(screen.getByRole("dialog", { name: "New voice bill" })).toBeTruthy();
    expect(takes.peek()).toBeNull();
    expect(button("Pause")).toBeTruthy();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("Type instead asks 'Discard recording?' first (owner, answer 5); Discard: the saved one is deleted, the add panel opens, nothing is generated", async () => {
    const onGenerate = vi.fn();
    const onAddByHand = vi.fn();
    const takes = memoryStore();
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={onAddByHand} takes={takes} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(3_000);
    await act(async () => void fireEvent.click(button("Stop")));
    fireEvent.click(button("Type instead"));
    expect(onAddByHand).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog", { name: "Discard recording?" })).getByRole("button", { name: "Discard" })));
    expect(takes.peek()).toBeNull();
    expect(onAddByHand).toHaveBeenCalledOnce();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the 4:30 warning on 09, then the 5:00 stop goes to 10 by itself, says why - and is saved on the phone", async () => {
    const takes = memoryStore();
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} takes={takes} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(269_000);
    expect(screen.queryByText("Recording stops at 5:00")).toBeNull();
    await wait(2_000);
    expect(within(screen.getByRole("dialog", { name: "New voice bill" })).getByText("Recording stops at 5:00")).toBeTruthy();
    await wait(30_000);
    const review = screen.getByRole("dialog", { name: "Check your recording" });
    expect(within(review).getByText("Stopped at 5:00")).toBeTruthy();
    expect(within(review).getByText("5:00 · saved on this phone")).toBeTruthy();
    expect(takes.peek()).toMatchObject({ stopped: "limit" });
    expect(button("Generate bill")).toBeTruthy();
  });

  it("the app going to the background stops it and KEEPS the recording: 10 says why", async () => {
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(4_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await wait(10);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const review = screen.getByRole("dialog", { name: "Check your recording" });
    expect(within(review).getByText("Stopped — the app went to the background")).toBeTruthy();
  });

  it("under 1 s: 'Nothing recorded' on the bill -> Re-record or Add by hand", async () => {
    const onAddByHand = vi.fn();
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={onAddByHand} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(500);
    await act(async () => void fireEvent.click(button("Stop")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Nothing recorded")).toBeTruthy();
    fireEvent.click(button("Add by hand"));
    expect(onAddByHand).toHaveBeenCalledOnce();
    expect(button("Re-record")).toBeTruthy();
  });

  it("no microphone permission: no recording screen - the warning card on the bill with the help line and Add by hand", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))) } });
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    expect(screen.queryByRole("dialog")).toBeNull();
    const help = screen.getByText(/Mic permission denied/);
    expect(help.closest("[class*='bg-kb-warn-bg']")).toBeTruthy();
    expect(button("Add by hand")).toBeTruthy();
  });

  it("no permission INSIDE THE ANDROID APP (owner, answer 6): where to allow it - the phone's Settings -> Apps -> Kirana Voice Bill -> Permissions", async () => {
    env.native = true;
    try {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))) } });
      render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
      await act(async () => void fireEvent.click(button("Record order")));
      expect(screen.getByText("Allow the microphone for Kirana Voice Bill — phone Settings → Apps → Kirana Voice Bill → Permissions")).toBeTruthy();
      expect(screen.queryByText(/browser/)).toBeNull();
    } finally {
      env.native = false;
    }
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

// KB-413 step 2 (owner, 15 Nov 2026, answer 7): Back on 09 / 10 never throws a recording away by itself - it pauses and asks.
describe("09 / 10 - Back asks 'Discard recording?' (Keep / Discard)", () => {
  const startRecording = async (onGenerate = vi.fn(), takes?: TakeStore) => {
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={vi.fn()} {...(takes ? { takes } : {})} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(6_000);
    return onGenerate;
  };
  const sheet = () => screen.getByRole("dialog", { name: "Discard recording?" });

  it("09: the back arrow PAUSES (the timer holds) and asks; Keep closes the question and stays on 09, still paused", async () => {
    await startRecording();
    fireEvent.click(button("Back"));
    expect(sheet()).toBeTruthy();
    // owner, 15 Nov 2026 (fix 4): what is lost, the safe choice big and first, Discard red but secondary under it
    expect(within(sheet()).getByText("The 0:06 recording will be deleted.")).toBeTruthy();
    const [keepBtn, discardBtn] = within(sheet()).getAllByRole("button");
    expect(keepBtn!.textContent).toBe("Keep recording");
    expect(keepBtn!.className).toContain("bg-kb-primary");
    expect(discardBtn!.textContent).toBe("Discard");
    expect(discardBtn!.className).toContain("text-kb-err");
    expect(discardBtn!.className).not.toContain("bg-kb-err");
    await wait(20_000);
    const rec = screen.getByRole("dialog", { name: "New voice bill" });
    expect(within(rec).getByText("00:06")).toBeTruthy();
    expect(within(rec).getByText("Paused")).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Keep recording" }));
    expect(screen.queryByRole("dialog", { name: "Discard recording?" })).toBeNull();
    expect(button("Resume")).toBeTruthy();
  });

  it("09: Discard throws the recording away, turns the mic off and goes back to the bill - nothing is generated", async () => {
    const track = { readyState: "live", stop: vi.fn() };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
    const onGenerate = await startRecording();
    fireEvent.click(button("Back"));
    await act(async () => void fireEvent.click(within(sheet()).getByRole("button", { name: "Discard" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(button("Record order")).toBeTruthy();
  });

  it("09: Android Back (the history going back) pauses and asks - 09 stays; a second Back closes only the question (Keep); a third asks again", async () => {
    await startRecording();
    vi.useRealTimers(); // the browser's history runs on real time
    window.history.back();
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(sheet()).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "New voice bill" })).toBeTruthy();
    expect(button("Resume")).toBeTruthy();
    window.history.back(); // the second Back closes the question = Keep
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(screen.queryByRole("dialog", { name: "Discard recording?" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "New voice bill" })).toBeTruthy();
    // 09 still owns a Back entry: the next Back asks again (it never falls through to the screen under it)
    window.history.back();
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(sheet()).toBeTruthy();
    cleanup();
    await new Promise((r) => setTimeout(r, 150)); // the closed screens take their history entries back off before the next test
  });

  it("09: Escape asks too (as Android Back does)", async () => {
    await startRecording();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sheet()).toBeTruthy();
    expect(button("Resume")).toBeTruthy();
  });

  it("10: Back asks; Keep stays on 10 with the recording; Discard drops it and deletes the saved one - nothing is generated", async () => {
    const takes = memoryStore();
    const onGenerate = await startRecording(vi.fn(), takes);
    await act(async () => void fireEvent.click(button("Stop")));
    expect(takes.peek()).not.toBeNull();
    fireEvent.click(button("Back"));
    expect(within(sheet()).getByText("The 0:06 recording will be deleted.")).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Keep recording" }));
    expect(screen.getByRole("dialog", { name: "Check your recording" })).toBeTruthy();
    fireEvent.click(button("Back"));
    await act(async () => void fireEvent.click(within(sheet()).getByRole("button", { name: "Discard" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(takes.peek()).toBeNull();
  });
});

// Owner, 15 Nov 2026 (answer 1): the stopped recording is saved on the phone, so 10 survives the app closing.
describe("10 survives the app closing (the recording saved on Stop)", () => {
  it("Stop saves it; the app is killed and reopened: 10 comes back with the same recording, and Generate works", async () => {
    const takes = memoryStore();
    const first = render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} takes={takes} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(6_000);
    await act(async () => void fireEvent.click(button("Stop")));
    expect(takes.peek()!.recordedMs).toBeGreaterThanOrEqual(6_000);
    first.unmount(); // the app is closed
    const onGenerate = vi.fn();
    render(<OrderRecorder hasLines={false} onGenerate={onGenerate} onAddByHand={vi.fn()} takes={takes} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const review = screen.getByRole("dialog", { name: "Check your recording" });
    expect(within(review).getByText("0:06 · saved on this phone")).toBeTruthy();
    await act(async () => void fireEvent.click(button("Generate bill")));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate.mock.calls[0]![0]).toBeInstanceOf(Blob);
  });

  it("the app going to the background saves it too", async () => {
    const takes = memoryStore();
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} takes={takes} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(4_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await wait(10);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(takes.peek()).toMatchObject({ stopped: "hidden" });
  });

  it("nothing saved (the phone refused the write): 10 never claims 'saved on this phone'", async () => {
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} takes={memoryStore(true)} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(6_000);
    await act(async () => void fireEvent.click(button("Stop")));
    const review = screen.getByRole("dialog", { name: "Check your recording" });
    expect(within(review).getAllByText("0:06")).toHaveLength(2); // under "Recording ready" (no claim) and the player's end time
    expect(within(review).queryByText(/saved on this phone/)).toBeNull();
  });
});

describe("10 - real playback over a fixed bar pattern (owner, answer 5)", () => {
  const toReview = async () => {
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} takes={memoryStore()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    await wait(42_000);
    await act(async () => void fireEvent.click(button("Stop")));
    return screen.getByRole("dialog", { name: "Check your recording" });
  };
  const at = (audio: HTMLAudioElement, s: number) => {
    Object.defineProperty(audio, "currentTime", { configurable: true, get: () => s });
    fireEvent.timeUpdate(audio);
  };

  it("22 bars, none played and 0:00 / 0:42 at first; Play plays; the played part and the time follow the audio; the end resets", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const review = await toReview();
    const bars = () => [...review.querySelectorAll("[class*='w-[5px]']")];
    expect(bars()).toHaveLength(22);
    expect(review.querySelectorAll("[data-played]")).toHaveLength(0);
    expect(within(review).getByText("0:00")).toBeTruthy();
    expect(within(review).getByText("0:42")).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Play recording" }));
    expect(play).toHaveBeenCalledOnce();
    const audio = review.querySelector("audio")!;
    fireEvent.play(audio);
    expect(within(review).getByRole("button", { name: "Pause recording" })).toBeTruthy();
    at(audio, 21);
    expect(review.querySelectorAll("[data-played]")).toHaveLength(11); // half of 22
    expect(within(review).getByText("0:21")).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Pause recording" }));
    expect(pause).toHaveBeenCalled();
    at(audio, 42);
    fireEvent.ended(audio);
    expect(review.querySelectorAll("[data-played]")).toHaveLength(0);
    expect(within(review).getByRole("button", { name: "Play recording" })).toBeTruthy();
  });
});

describe("09 - the bars follow the REAL microphone level (owner, answer 5); still under reduced motion", () => {
  class FakeAudioContext {
    static level = 0;
    static closed = 0;
    createAnalyser() {
      return { fftSize: 0, getByteTimeDomainData: (a: Uint8Array) => a.fill(128 + Math.round(FakeAudioContext.level * 127)) };
    }
    createMediaStreamSource() {
      return { connect: () => {} };
    }
    async close() {
      FakeAudioContext.closed++;
    }
  }
  const scales = () => [...screen.getByRole("dialog", { name: "New voice bill" }).querySelectorAll<HTMLElement>("[class*='w-[5px]']")].map((b) => b.style.transform);

  it("quiet -> the bars sit low; loud -> the newest (right) bar is full; the mic level stops being read after Stop", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    FakeAudioContext.closed = 0;
    render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
    await act(async () => void fireEvent.click(button("Record order")));
    FakeAudioContext.level = 0;
    await wait(300);
    expect(scales().at(-1)).toBe("scaleY(0.35)");
    FakeAudioContext.level = 0.5;
    await wait(100);
    expect(scales().at(-1)).toBe("scaleY(1)");
    expect(scales().at(-2)).toBe("scaleY(0.35)");
    await act(async () => void fireEvent.click(button("Stop")));
    expect(FakeAudioContext.closed).toBeGreaterThan(0);
  });

  it("reduced motion: still bars at their drawn heights, no level read, no animation", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    document.documentElement.dataset.motion = "reduce";
    try {
      render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
      await act(async () => void fireEvent.click(button("Record order")));
      FakeAudioContext.level = 0.5;
      await wait(500);
      const bars = [...screen.getByRole("dialog", { name: "New voice bill" }).querySelectorAll<HTMLElement>("[class*='w-[5px]']")];
      expect(bars.every((b) => b.style.transform === "scaleY(1)")).toBe(true);
      expect(bars.some((b) => /animate-/.test(b.className))).toBe(false);
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });
});

describe("09 / 10 in Hindi (the new words)", () => {
  it("the app's mic help in Hindi and Hinglish (the catalog)", async () => {
    const { render: say } = await import("@/domain/messages");
    expect(say("voice.micDeniedApp", {}, "hi")).toBe("Kirana Voice Bill को माइक की अनुमति दें — फ़ोन की सेटिंग → ऐप्स → Kirana Voice Bill → अनुमतियाँ");
    expect(say("voice.micDeniedApp", {}, "hl")).toBe("Kirana Voice Bill ko mic ki permission dein — phone ki Settings → Apps → Kirana Voice Bill → Permissions");
    expect(say("rec.discardLine", { time: "0:42" }, "hl")).toBe("0:42 ki recording mit jaayegi.");
  });

  it("titles, chip, 'of 5:00', the saved line, the Discard question", async () => {
    setScreenLanguage("hi");
    try {
      render(<OrderRecorder hasLines={false} onGenerate={vi.fn()} onAddByHand={vi.fn()} />);
      await act(async () => void fireEvent.click(button("ऑर्डर बोलें")));
      const rec = screen.getByRole("dialog", { name: "नया वॉइस बिल" });
      expect(within(rec).getByText("रिकॉर्ड हो रहा है")).toBeTruthy();
      expect(within(rec).getByText("5:00 में से")).toBeTruthy();
      expect(within(rec).getByText("रोकने पर इस फ़ोन में सेव होगा")).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      const ask = screen.getByRole("dialog", { name: "रिकॉर्डिंग हटाएँ?" });
      expect(within(ask).getByText("0:00 की रिकॉर्डिंग मिट जाएगी।")).toBeTruthy();
      expect(within(ask).getByRole("button", { name: "रिकॉर्डिंग रखें" })).toBeTruthy();
    } finally {
      setScreenLanguage("en");
    }
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
    expect(button("Retry").hasAttribute("data-pending-target")).toBe(true); // a Bill Banao tap goes here first (KB-307)
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
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Heard: “2 किलो चीनी 45 रुपए किलो”")).toBeTruthy(); // KB-413: the Heard card ("Heard:" in bold)
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Heard: “फुटाने 102 रुपए किलो”")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("nothing understood: the transcript and 'No items found' -> Add by hand with those words", () => {
    const { onAddByHand } = entries([row({ state: "appended", transcript: "हाँ जी बोलिए", items: [] })]);
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Heard: “हाँ जी बोलिए”")).toBeTruthy();
    expect(screen.getByText("No items found")).toBeTruthy();
    fireEvent.click(button("Add by hand"));
    expect(onAddByHand).toHaveBeenCalledWith("हाँ जी बोलिए");
  });
});
