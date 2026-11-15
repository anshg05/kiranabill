// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { KiranaBillDB, type LocalVoiceRecording } from "@/data/db";
import type { VoiceJobOutcome } from "@/data/voiceJob";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { render as say } from "@/domain/messages";
import { OrderEntries, OrderRecorder, type RecorderOrders } from "./VoiceOrderPanel";
import { useVoiceOrders } from "./useVoiceOrders";
import { BillView } from "./BillingScreen";

// KB-413 step 3 (owner + reviewer, 15 Nov 2026): 11 Making your bill, 23 Couldn't read the order, 24 Offline - on TODAY's voice queue,
// offline waiting and Bill Banao lock (no logic change). Full-screen 11 / 23 only for the FIRST recording of an EMPTY bill ("More"
// recordings stay inline on 12, answer 3); one fixed true tip on 11 (answer 4, §0b item 3's wording - owner, 15 Nov 2026); 23: Retry the
// same recording, Type instead (= Add by hand), Record again (asks "Discard recording?" first - owner, 15 Nov 2026) and Remove as a text
// button; the recording (in the voice queue on the phone) survives a failure and the app closing on 11 / 23.

vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => false }));

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

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
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

const button = (name: RegExp | string) => screen.getByRole("button", { name });
const rec = (over: Partial<LocalVoiceRecording> = {}): LocalVoiceRecording => ({
  recordingId: "r1", shopId: "s", billLocalId: "b", bytes: new ArrayBuffer(0), mime: "audio/webm", recordedMs: 42_000,
  createdAt: new Date(Date.now() - 12_000).toISOString(), state: "queued", ...over,
});
const ordersOf = (recordings: LocalVoiceRecording[], o: { sending?: string[]; offline?: boolean } = {}): RecorderOrders & { retry: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } => ({
  recordings, sending: new Set(o.sending ?? []), offline: o.offline ?? false, retry: vi.fn(async () => {}), remove: vi.fn(async () => {}),
});
function recorder(orders: RecorderOrders, over: { hasLines?: boolean; onAddByHand?: () => void } = {}) {
  return render(<OrderRecorder orders={orders} shopName="Gupta Kirana Store" hasLines={over.hasLines ?? false} onGenerate={() => {}} onAddByHand={over.onAddByHand ?? (() => {})} />);
}
const generating = () => screen.queryByRole("dialog", { name: "Making your bill" });
const failedScreen = () => screen.queryByRole("dialog", { name: "New bill" });

describe("11 Making your bill: full screen only for the first recording of an empty bill", () => {
  it("as drawn: the paper with the shop's name and shimmering rows, 'Reading your order…', the seconds, the fixed tip, 'Recording safe', Add by hand", () => {
    recorder(ordersOf([rec()], { sending: ["r1"] }));
    const d = generating()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(within(d).getByText("Gupta Kirana Store")).toBeTruthy(); // the receipt prints it upper-case, as today's receipt does
    expect(d.querySelectorAll("[data-shimmer]").length).toBe(12); // as drawn: the date line, 5 rows of name + price, the TOTAL's amount
    expect(within(d).getByText("TOTAL")).toBeTruthy();
    expect(within(d).getByText("Reading your order…")).toBeTruthy();
    expect(within(d).getByText("12 s · long orders take a little longer")).toBeTruthy();
    expect(within(d).getByText("DID YOU KNOW")).toBeTruthy();
    // owner, 15 Nov 2026: the TRUE learning wording (§0b item 3) - the drawn "Say a price once - next time it fills in" is not true
    expect(within(d).getByText("It learns your prices. After a few bills it suggests your price; approve it once, and it fills in from then on.")).toBeTruthy();
    expect(within(d).getByText("Recording safe on this phone")).toBeTruthy();
    expect(button("Add items by hand meanwhile")).toBeTruthy();
  });

  // the file's highlight is a 400 px background tile moving across each bar; ours is that 400 px strip moved by transform (26 §3),
  // clipped by its bar on purpose - marked data-clip-ok, the one thing the sheets' clip check lets through
  it("the shimmer: the design's 400 px highlight strip inside each bar, clipped by the bar on purpose (data-clip-ok); the paper rolls out", () => {
    recorder(ordersOf([rec()], { sending: ["r1"] }));
    const d = generating()!;
    for (const bar of d.querySelectorAll("[data-shimmer]")) {
      expect(bar.className).toContain("overflow-hidden");
      const glow = bar.firstElementChild!;
      expect(glow.className).toContain("w-[400px]");
      expect(glow.hasAttribute("data-clip-ok")).toBe(true);
      expect(glow.className).toContain("animate-kb-shimmer");
    }
    expect(d.querySelector("[class*='animate-kb-print']")).toBeTruthy();
  });

  it("the seconds count on (from Generate)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    recorder(ordersOf([rec({ createdAt: new Date(Date.now() - 12_000).toISOString() })], { sending: ["r1"] }));
    await act(async () => void vi.advanceTimersByTime(3_000));
    expect(within(generating()!).getByText("15 s · long orders take a little longer")).toBeTruthy();
  });

  it("queued and online (the moment before it is sent) is 11 too; queued OFFLINE is not (24 is the bill screen)", () => {
    const { unmount } = recorder(ordersOf([rec()]));
    expect(generating()).toBeTruthy();
    unmount();
    recorder(ordersOf([rec()], { offline: true }));
    expect(generating()).toBeNull();
  });

  it("not for 'More' recordings (the bill has lines) and not once a recording of this bill is in it (answer 3)", () => {
    const { unmount } = recorder(ordersOf([rec()], { sending: ["r1"] }), { hasLines: true });
    expect(generating()).toBeNull();
    unmount();
    recorder(ordersOf([rec({ recordingId: "r0", state: "appended", transcript: "x", items: [] }), rec()], { sending: ["r1"] }));
    expect(generating()).toBeNull();
  });

  it("Back (the arrow) returns to 12; Escape too; the recording is untouched (still sending)", () => {
    const o = ordersOf([rec()], { sending: ["r1"] });
    const { unmount } = recorder(o);
    fireEvent.click(button("Back"));
    expect(generating()).toBeNull();
    unmount();
    recorder(o);
    fireEvent.keyDown(generating()!, { key: "Escape" });
    expect(generating()).toBeNull();
    expect(o.remove).not.toHaveBeenCalled();
  });

  it("'Add items by hand meanwhile' opens the add panel on 12 (the recording goes on being read)", () => {
    const onAddByHand = vi.fn();
    const o = ordersOf([rec()], { sending: ["r1"] });
    recorder(o, { onAddByHand });
    fireEvent.click(button("Add items by hand meanwhile"));
    expect(onAddByHand).toHaveBeenCalledOnce();
    expect(generating()).toBeNull();
    expect(o.remove).not.toHaveBeenCalled();
  });

  it("reduced motion is the stylesheet's (kb- animations stop); nothing on 11 depends on the motion running", () => {
    document.documentElement.dataset.motion = "reduce";
    try {
      recorder(ordersOf([rec()], { sending: ["r1"] }));
      expect(within(generating()!).getByText("Reading your order…")).toBeTruthy();
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });
});

describe("23 Couldn't read the order: the first recording of an empty bill failed", () => {
  const failed = (reason?: string, state: LocalVoiceRecording["state"] = "failed") => rec({ state, ...(reason ? { reason } : {}) });

  it("as drawn: the title, one true reason, the recording card 'Recording 0:42 / Saved on this phone', Retry big and first", () => {
    recorder(ordersOf([failed("upload")]));
    const d = failedScreen()!;
    expect(within(d).getByText("Couldn't read the order")).toBeTruthy();
    expect(within(d).getByText("The recording couldn't be sent. It's safe on this phone — try again, no need to speak again.")).toBeTruthy();
    expect(within(d).getByText("Recording 0:42")).toBeTruthy();
    expect(within(d).getByText("Saved on this phone")).toBeTruthy();
    const names = within(d).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual(["Back", "Try again", "Type instead", "Record again", "Remove this recording"]);
    expect(button("Try again").className).toContain("bg-kb-primary");
    expect(button("Remove this recording").className).not.toContain("bg-kb-");
  });

  it.each([
    ["start", "The recording couldn't be sent. It's safe on this phone — try again, no need to speak again."],
    ["busy", "The reading service is busy right now. Your recording is safe — try again in a moment."],
    ["timeout", "The reading service is busy right now. Your recording is safe — try again in a moment."],
    ["rate_limited", "Too many orders this hour. Your recording is safe — try again later."],
    ["session", "You were signed out. Sign in again, then try again — your recording is safe."],
    ["failed", "This order couldn't be read. Your recording is safe — try again, no need to speak again."],
    ["download", "This order couldn't be read. Your recording is safe — try again, no need to speak again."],
  ])("reason %s: one true sentence", (reason, sentence) => {
    recorder(ordersOf([failed(reason)]));
    expect(within(failedScreen()!).getByText(sentence)).toBeTruthy();
  });

  it("gave up (the server took too long) is 23 too", () => {
    recorder(ordersOf([failed(undefined, "gave_up")]));
    expect(within(failedScreen()!).getByText("This order couldn't be read. Your recording is safe — try again, no need to speak again.")).toBeTruthy();
  });

  it("Retry resends the SAME recording", () => {
    const o = ordersOf([failed("upload")]);
    recorder(o);
    fireEvent.click(button("Try again"));
    expect(o.retry).toHaveBeenCalledWith("r1");
    expect(o.remove).not.toHaveBeenCalled();
  });

  it("Type instead opens the add panel on 12 and keeps the recording (Bill Banao still waits for it, as today)", () => {
    const onAddByHand = vi.fn();
    const o = ordersOf([failed("upload")]);
    recorder(o, { onAddByHand });
    fireEvent.click(button("Type instead"));
    expect(onAddByHand).toHaveBeenCalledOnce();
    expect(failedScreen()).toBeNull();
    expect(o.remove).not.toHaveBeenCalled();
  });

  it("Remove (a text button) takes the recording out", () => {
    const o = ordersOf([failed("upload")]);
    recorder(o);
    fireEvent.click(button("Remove this recording"));
    expect(o.remove).toHaveBeenCalledWith("r1");
  });

  it("Record again asks 'Discard recording?' first (what is lost; Keep big and first) - Keep changes nothing", async () => {
    const o = ordersOf([failed("upload")]);
    recorder(o);
    fireEvent.click(button("Record again"));
    const q = screen.getByRole("dialog", { name: "Discard recording?" });
    expect(within(q).getByText("The 0:42 recording will be deleted.")).toBeTruthy();
    const [keep, discard] = within(q).getAllByRole("button").filter((b) => /Keep recording|Discard/.test(b.textContent ?? ""));
    expect(keep!.textContent).toBe("Keep recording");
    expect(keep!.className).toContain("bg-kb-primary");
    expect(discard!.textContent).toBe("Discard");
    fireEvent.click(keep!);
    expect(screen.queryByRole("dialog", { name: "Discard recording?" })).toBeNull();
    expect(failedScreen()).toBeTruthy();
    expect(o.remove).not.toHaveBeenCalled();
  });

  it("Record again -> Discard: the failed recording is removed, then 09 Recording starts", async () => {
    const o = ordersOf([failed("upload")]);
    recorder(o);
    fireEvent.click(button("Record again"));
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog", { name: "Discard recording?" })).getByRole("button", { name: "Discard" })));
    expect(o.remove).toHaveBeenCalledWith("r1");
    expect(screen.getByRole("dialog", { name: "New voice bill" })).toBeTruthy();
  });

  it("Record again -> Discard, but the mic is refused: the failed recording is KEPT, and 12 shows (with the mic warning)", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))) } });
    const o = ordersOf([failed("upload")]);
    recorder(o);
    fireEvent.click(button("Record again"));
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog", { name: "Discard recording?" })).getByRole("button", { name: "Discard" })));
    await act(async () => {});
    expect(o.remove).not.toHaveBeenCalled();
    expect(failedScreen()).toBeNull();
    expect(screen.getByText(/Mic permission denied/)).toBeTruthy();
  });

  it("Back returns to 12 (the failed card stays there, inline), without removing anything", () => {
    const o = ordersOf([failed("upload")]);
    recorder(o);
    fireEvent.click(button("Back"));
    expect(failedScreen()).toBeNull();
    expect(o.remove).not.toHaveBeenCalled();
  });

  it("not for a failed 'More' recording (the bill has lines): that stays the inline card on 12", () => {
    recorder(ordersOf([failed("upload")]), { hasLines: true });
    expect(failedScreen()).toBeNull();
  });
});

describe("11 / 23 survive the app closing - the recording is in the phone's voice queue (step 2's saved recording moved there)", () => {
  let db: KiranaBillDB;
  beforeEach(() => void (db = new KiranaBillDB(`s3-${crypto.randomUUID()}`)));
  afterEach(() => db.close());

  function App({ submit }: { submit: (id: string, audio: Blob) => Promise<VoiceJobOutcome> }) {
    const orders = useVoiceOrders({ db, shopId: "s", billLocalId: "b", parser: SEED_PARSER_CATALOG, submit, onAppend: () => {} });
    return <OrderRecorder orders={orders} shopName="Gupta Kirana Store" hasLines={false} onGenerate={(a, ms) => void orders.generate(a, ms)} onAddByHand={() => {}} />;
  }
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));

  it("failed -> 23; the app closes and reopens -> 23 again with the same recording; Retry sends that recording", async () => {
    const { enqueueRecording } = await import("@/data/voiceQueue");
    await enqueueRecording(db, { recordingId: "r1", shopId: "s", billLocalId: "b", audio: new Blob(["a"], { type: "audio/webm" }), recordedMs: 42_000 });
    const fail = vi.fn(async (id: string): Promise<VoiceJobOutcome> => ({ kind: "failed", recordingId: id, reason: "upload" }));
    const first = render(<App submit={fail} />);
    await settle();
    expect(failedScreen()).toBeTruthy();
    first.unmount(); // the app is closed
    const never = vi.fn(() => new Promise<VoiceJobOutcome>(() => {}));
    render(<App submit={never} />);
    await settle();
    expect(within(failedScreen()!).getByText("Recording 0:42")).toBeTruthy();
    expect(await db.voiceQueue.get("r1")).toMatchObject({ state: "failed", recordedMs: 42_000 });
    await act(async () => void fireEvent.click(button("Try again")));
    await settle();
    expect(never).toHaveBeenCalledWith("r1", expect.any(Blob));
    expect(generating()).toBeTruthy(); // 23 -> 11 (Try again)
  });

  it("closed on 11 (still being read) -> reopened: sent again from the queue, 11 again", async () => {
    const { enqueueRecording } = await import("@/data/voiceQueue");
    await enqueueRecording(db, { recordingId: "r1", shopId: "s", billLocalId: "b", audio: new Blob(["a"], { type: "audio/webm" }), recordedMs: 42_000 });
    const never = vi.fn(() => new Promise<VoiceJobOutcome>(() => {}));
    const first = render(<App submit={never} />);
    await settle();
    expect(generating()).toBeTruthy();
    first.unmount();
    const again = vi.fn(() => new Promise<VoiceJobOutcome>(() => {}));
    render(<App submit={again} />);
    await settle();
    expect(generating()).toBeTruthy();
    expect(again).toHaveBeenCalledWith("r1", expect.any(Blob));
  });
});

describe("24 Offline: the bill screen, as today's offline waiting - drawn as 24", () => {
  const base = {
    shopName: "Gupta Kirana Store", flags: [], onSignOut: () => {}, onEdit: () => null, onRemove: () => {}, onAcknowledge: () => {}, onFinalise: vi.fn(),
    catalog: SEED_PARSER_CATALOG, onAddByHand: () => {}, onChangeProduct: () => {}, customer: { name: "Cash", mobile: null }, onCustomerName: () => null, onCustomerMobile: () => null,
  };
  const line = { id: "l1", displayName: "टाटा नमक", source: "manual" as const, item: { spokenName: "टाटा नमक", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: 3000, rateUnit: "piece", total: 3000, priceType: "rate" } };
  const queued = ordersOf([rec({ recordedMs: 65_000 })], { offline: true });

  it("the ink strip 'No internet · billing still works' replaces the Offline chip", () => {
    render(<BillView {...(base as unknown as Parameters<typeof BillView>[0])} lines={[line] as never} pending={1} waitingRecordings={1} syncChip={{ kind: "offline", label: "Offline" }} />);
    expect(screen.getByText("No internet · billing still works").closest("[role='status']")).toBeTruthy();
    expect(screen.queryByTestId("sync-chip")).toBeNull();
  });

  it("online: no strip, the sync chip as today", () => {
    render(<BillView {...(base as unknown as Parameters<typeof BillView>[0])} lines={[line] as never} pending={0} syncChip={{ kind: "syncing", label: "Syncing…" }} />);
    expect(screen.queryByText("No internet · billing still works")).toBeNull();
    expect(screen.getByTestId("sync-chip")).toBeTruthy();
  });

  it("the waiting recording: 'Order saved · will send when online', 'Recording 1:05 · the bill appears by itself', the spinner; then 'Meanwhile, you can type items:'", () => {
    render(<OrderEntries orders={queued} onAddByHand={() => {}} part="pending" />);
    expect(screen.getByText("Order saved · will send when online")).toBeTruthy();
    expect(screen.getByText("Recording 1:05 · the bill appears by itself")).toBeTruthy();
    expect(document.querySelector("[class*='animate-kb-spin']")).toBeTruthy();
    expect(screen.getByText("Meanwhile, you can type items:")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add by hand" })).toBeNull(); // the list's dashed "Add item" is how, as drawn
  });

  it("the panel: 'Waiting for 1 recording'; Bill Banao says 'Bill Banao after the order arrives' and stays LOCKED (today's rule)", () => {
    render(<BillView {...(base as unknown as Parameters<typeof BillView>[0])} lines={[line] as never} pending={1} waitingRecordings={1} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("Waiting for 1 recording");
    expect(screen.getByTestId("checks-pending").className).toContain("text-kb-sub"); // grey, as drawn: nothing is wrong, it waits
    const banao = button("Bill Banao after the order arrives");
    expect(banao.getAttribute("aria-disabled")).toBe("true");
    expect(banao.querySelector("svg")).toBeNull(); // 24 draws no lock on it
    fireEvent.click(banao);
    expect(base.onFinalise).not.toHaveBeenCalled();
  });

  it("two waiting recordings; or a recording AND a missing price: the wording follows what Bill Banao waits for", () => {
    const { unmount } = render(<BillView {...(base as unknown as Parameters<typeof BillView>[0])} lines={[line] as never} pending={2} waitingRecordings={2} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("Waiting for 2 recordings");
    expect(button("Bill Banao after the orders arrive")).toBeTruthy();
    unmount();
    render(<BillView {...(base as unknown as Parameters<typeof BillView>[0])} lines={[line] as never} pending={2} waitingRecordings={1} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("2 checks pending");
    expect(button("Bill Banao")).toBeTruthy();
  });

  it("fix 2 (owner, 16 Nov 2026): 23's button is 'Try again' as drawn; Hindi 'फिर कोशिश', Hinglish 'Phir koshish'", () => {
    expect(say("retry.tryAgain", {}, "en")).toBe("Try again");
    expect(say("retry.tryAgain", {}, "hi")).toBe("फिर कोशिश");
    expect(say("retry.tryAgain", {}, "hl")).toBe("Phir koshish");
    expect(say("retry.button", {}, "en")).toBe("Retry"); // the app's "server down" screen and the typed-order list keep their word
  });

  // fix 1 (owner, 16 Nov 2026): 24's order as drawn - the waiting card FIRST, then "Meanwhile, you can type items:", then the typed lines,
  // then Add item - for the first recording of a bill that was empty when it was recorded; a "More" recording stays under the lines
  const before = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const bill24 = (r: LocalVoiceRecording) =>
    render(
      <BillView
        {...(base as unknown as Parameters<typeof BillView>[0])}
        lines={[line] as never}
        pending={1}
        waitingRecordings={1}
        orderEntries={(openAdd, part) => <OrderEntries orders={ordersOf([r], { offline: true })} onAddByHand={openAdd} part={part} />}
      />,
    );

  it("the first recording of an empty bill: the card FIRST, then 'Meanwhile, you can type items:', then the typed line, then Add item", () => {
    bill24(rec({ recordedMs: 65_000, emptyBill: true }));
    const card = screen.getByText("Order saved · will send when online");
    const meanwhile = screen.getByText("Meanwhile, you can type items:");
    const typed = screen.getByText("टाटा नमक");
    const add = screen.getByRole("button", { name: /Add item/ });
    before(card, meanwhile);
    before(meanwhile, typed);
    before(typed, add);
    expect(screen.getAllByText("Order saved · will send when online")).toHaveLength(1);
    expect(screen.getAllByText("Meanwhile, you can type items:")).toHaveLength(1);
  });

  it("a 'More' recording (the bill had lines when it was recorded) stays inline under the lines, as answered in step 1", () => {
    bill24(rec({ recordedMs: 65_000 }));
    before(screen.getByText("टाटा नमक"), screen.getByText("Order saved · will send when online"));
    before(screen.getByText("Order saved · will send when online"), screen.getByText("Meanwhile, you can type items:"));
  });

  it("every new word in Hindi and Hinglish (the catalog)", () => {
    for (const lang of ["hi", "hl"] as const)
      for (const key of ["gen.title", "gen.reading", "gen.elapsed", "gen.tipTitle", "gen.tip", "gen.safe", "gen.byHand", "fail.sent", "fail.busy", "fail.limit", "fail.session", "fail.read", "fail.recording", "fail.saved", "fail.recordAgain", "offline.strip", "order.queued", "order.queuedSub", "order.meanwhile", "need.recOne", "need.recMany", "bill.afterOrder", "bill.afterOrders"] as const)
        if (!(lang === "hl" && key === "fail.recording")) // "Recording 0:42" is the same words in Hinglish
          expect(say(key, { s: 3, time: "0:42", n: 2 }, lang)).not.toBe(say(key, { s: 3, time: "0:42", n: 2 }, "en"));
    expect(say("gen.elapsed", { s: 12 }, "hi")).toContain("12");
  });
});
