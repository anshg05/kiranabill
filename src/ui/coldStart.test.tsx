// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import type { VoiceJobOutcome } from "@/data/voiceJob";
import { clearRecordingDraft, loadRecordingDraft, saveRecordingDraft } from "@/data/recordingDraft";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { OrderEntries, OrderRecorder, type TakeStore } from "./VoiceOrderPanel";
import { useVoiceOrders } from "./useVoiceOrders";
import { useBillLines } from "./useBillLines";
import { draftKey, saveDraft } from "./billDraftStore";
import { EMPTY_BILL } from "./useBillLines";

// KB-413 phone check (owner, 16 Nov 2026), bug 2: after a FULL close (swiped from Recent apps) 23 did not come back - the app opened
// on an empty new bill. Root cause: an empty bill holding only a recording was not "worth saving", so no draft kept its id; the next
// start made a new bill and the recording (tied to the old id) showed nowhere. These tests are a real cold start: the app makes its own
// bill id, then the database is CLOSED, every bit of memory dropped (unmount), and a FRESH connection reads only what is on the phone.

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

const SHOP = "shop-1";
let online = true;
let name = "";
let db: KiranaBillDB;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:rec"), revokeObjectURL: vi.fn() }));
  const track = { readyState: "live", stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
  name = `cold-${crypto.randomUUID()}`;
  db = new KiranaBillDB(name);
});
// the first app's unfinished reads die with it on a phone; here they finish before the connection closes (no "Database has been closed")
const drained = () => new Promise((r) => setTimeout(r, 100));
afterEach(async () => {
  cleanup();
  await drained();
  db.close();
  vi.unstubAllGlobals();
});

type Submit = (recordingId: string, audio: Blob) => Promise<VoiceJobOutcome>;

/** The bill screen's own wiring (BillingScreen): the bill + its draft, its recordings, 10's saved take - Generate and Stop write the
 *  bill's draft in their own transaction (bill.draftRow) - the recorder and the cards. */
function Shop({ submit, takeFails }: { submit: Submit; takeFails?: boolean }) {
  const bill = useBillLines(SEED_PARSER_CATALOG.entries, { db, shopId: SHOP });
  const orders = useVoiceOrders({
    db, shopId: SHOP, billLocalId: bill.ready ? bill.localId : null, parser: SEED_PARSER_CATALOG, submit,
    onAppend: (o) => {
      if (o.lines.length > 0) bill.add(o.lines, o.flags, o.transcript);
    },
  });
  const takes: TakeStore = {
    load: () => loadRecordingDraft(db, SHOP), save: (tk) => (takeFails ? Promise.reject(new Error("QuotaExceededError")) : saveRecordingDraft(db, { ...tk, shopId: SHOP, draft: bill.draftRow() })), clear: () => clearRecordingDraft(db, SHOP),
  };
  return (
    <>
      <p data-testid="bill">{bill.ready ? bill.localId : ""}</p>
      <p data-testid="lines">{bill.rows.length}</p>
      <OrderRecorder orders={orders} shopName="Gupta Kirana Store" takes={takes} hasLines={bill.rows.length > 0} onGenerate={(a, ms) => void orders.generate(a, ms, bill.rows.length === 0, bill.draftRow())} onAddByHand={() => {}} />
      <OrderEntries orders={orders} onAddByHand={() => {}} />
    </>
  );
}

const button = (n: RegExp | string) => screen.getByRole("button", { name: n });
const billId = () => screen.getByTestId("bill").textContent!;
const lines = () => Number(screen.getByTestId("lines").textContent);
const generating = () => screen.queryByRole("dialog", { name: "Making your bill" });
const failedScreen = () => screen.queryByRole("dialog", { name: "New bill" });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 400)))); // past DRAFT_SAVE_DELAY_MS

async function open(submit: Submit, takeFails?: boolean) {
  const view = render(<Shop submit={submit} takeFails={takeFails} />);
  await waitFor(() => expect(billId()).not.toBe(""));
  return view;
}
/** Swiped away from Recent apps: nothing in memory survives, the database connection is gone. Then the app starts again. */
async function coldStart(view: ReturnType<typeof render>, submit: Submit) {
  view.unmount();
  await drained();
  db.close();
  db = new KiranaBillDB(name);
  return open(submit);
}
/** Record order -> a little over ORDER_RECORDING's 1 s minimum -> Stop (10) */
async function speak() {
  await act(async () => void fireEvent.click(button("Record order")));
  await act(async () => void (await new Promise((r) => setTimeout(r, 1_100))));
  await act(async () => void fireEvent.click(button("Stop")));
}
async function recordAndGenerate() {
  await speak();
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Check your recording" })).toBeTruthy());
  await act(async () => void fireEvent.click(button("Generate bill")));
  await settle();
}
const theRecording = async () => (await db.voiceQueue.toArray())[0]!;
const done = (recordingId: string): VoiceJobOutcome => ({
  kind: "done", recordingId, transcript: "2 किलो चीनी, 1 किलो चावल 60 रुपए किलो",
  items: [
    { spokenName: "चीनी", catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "default" },
    { spokenName: "चावल", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "kg", rate: 6000, rateUnit: "kg", total: null, priceType: "rate" },
  ],
});
const never: Submit = () => new Promise<VoiceJobOutcome>(() => {});

describe("a full close (cold start) brings back the same bill and its recording", () => {
  it("23: failed -> full close -> reopened on 23 with the SAME recording and bill; Try again sends it (11)", async () => {
    const view = await open(async (id) => ({ kind: "failed", recordingId: id, reason: "upload" }));
    const first = billId();
    await recordAndGenerate();
    expect(failedScreen()).toBeTruthy();
    const r = await theRecording();
    expect(r).toMatchObject({ state: "failed", billLocalId: first });

    const again = vi.fn(never);
    await coldStart(view, again);
    await waitFor(() => expect(failedScreen()).toBeTruthy());
    expect(billId()).toBe(first);
    await act(async () => void fireEvent.click(within(failedScreen()!).getByRole("button", { name: "Try again" })));
    await settle();
    expect(again).toHaveBeenCalledWith(r.recordingId, expect.any(Blob));
    expect(generating()).toBeTruthy();
  });

  it("11: full close while it is being read -> reopened on 11, sent again; the answer only FILLS the lines - nothing is finalised", async () => {
    const view = await open(never);
    const first = billId();
    await recordAndGenerate();
    expect(generating()).toBeTruthy();
    const r = await theRecording();

    const answer = vi.fn(async (id: string) => done(id));
    await coldStart(view, answer);
    await waitFor(() => expect(lines()).toBe(2));
    expect(billId()).toBe(first);
    expect(answer).toHaveBeenCalledWith(r.recordingId, expect.any(Blob));
    expect(await db.bills.count()).toBe(0); // never a bill without Bill Banao
  });

  it("11 is shown again after the cold start while the answer is still coming", async () => {
    const view = await open(never);
    await recordAndGenerate();
    await coldStart(view, never);
    await waitFor(() => expect(generating()).toBeTruthy());
  });

  it("24: queued offline -> full close -> reopened offline: the waiting card again; back online it is sent and fills the bill", async () => {
    online = false;
    const view = await open(never);
    const first = billId();
    await recordAndGenerate();
    expect(screen.getByText("Order saved · will send when online")).toBeTruthy();

    const answer = vi.fn(async (id: string) => done(id));
    await coldStart(view, answer);
    await waitFor(() => expect(screen.getByText("Order saved · will send when online")).toBeTruthy());
    expect(billId()).toBe(first);
    expect(answer).not.toHaveBeenCalled();
    online = true;
    await act(async () => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(lines()).toBe(2));
    expect(await db.bills.count()).toBe(0);
  });

  it("the queued recording alone keeps the bill (10's take could not be stored): its draft is written WITH it, no later save needed", async () => {
    const view = await open(async (id) => ({ kind: "failed", recordingId: id, reason: "upload" }), true);
    const first = billId();
    await recordAndGenerate();
    expect(await db.recordingDraft.count()).toBe(0);
    expect(JSON.parse((await db.meta.get(draftKey(SHOP)))!.value).localId).toBe(first);
    await coldStart(view, never);
    await waitFor(() => expect(failedScreen()).toBeTruthy());
    expect(billId()).toBe(first);
  });

  it("a later save (the app going to the background on 23) never deletes the draft of a bill that still holds its recording", async () => {
    const view = await open(async (id) => ({ kind: "failed", recordingId: id, reason: "upload" }), true);
    const first = billId();
    await recordAndGenerate();
    await act(async () => void window.dispatchEvent(new Event("pagehide"))); // flushes the (empty) bill's draft through saveDraft
    await settle();
    expect(await db.meta.get(draftKey(SHOP))).toBeTruthy();
    await coldStart(view, never);
    await waitFor(() => expect(failedScreen()).toBeTruthy());
    expect(billId()).toBe(first);
  });

  it("10: Stop -> full close -> reopened on 10 with the recording; Generate puts it on the SAME bill", async () => {
    const view = await open(never);
    const first = billId();
    await speak();
    await waitFor(() => expect(screen.getByText(/saved on this phone/)).toBeTruthy());
    await settle();

    await coldStart(view, never);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Check your recording" })).toBeTruthy());
    expect(billId()).toBe(first);
    await act(async () => void fireEvent.click(button("Generate bill")));
    await settle();
    expect(await theRecording()).toMatchObject({ billLocalId: first, state: "queued" });
    expect(await db.recordingDraft.count()).toBe(0);
  });
});

describe("guards", () => {
  it("a recording already added to a bill that was billed never attaches to the new bill", async () => {
    await db.voiceQueue.put({
      recordingId: "old", shopId: SHOP, billLocalId: "billed-1", bytes: new ArrayBuffer(1), mime: "audio/webm", recordedMs: 1000, createdAt: new Date().toISOString(), state: "appended",
    });
    const view = await open(never);
    await coldStart(view, never);
    expect(billId()).not.toBe("billed-1");
    expect(failedScreen()).toBeNull();
    expect(generating()).toBeNull();
  });

  it("an empty bill whose only recording is already in it (appended) is not kept - as before", async () => {
    await db.voiceQueue.put({
      recordingId: "a", shopId: SHOP, billLocalId: "b-1", bytes: new ArrayBuffer(1), mime: "audio/webm", recordedMs: 1000, createdAt: new Date().toISOString(), state: "appended",
    });
    await saveDraft(db, SHOP, { ...EMPTY_BILL, localId: "b-1", startedAt: new Date().toISOString() });
    expect(await db.meta.get(draftKey(SHOP))).toBeUndefined();
  });

  it("an empty bill with a failed / queued / answered-not-added recording, or 10's saved take, IS kept", async () => {
    const empty = { ...EMPTY_BILL, localId: "b-2", startedAt: new Date().toISOString() };
    for (const state of ["queued", "failed", "gave_up", "done"] as const) {
      await db.voiceQueue.put({ recordingId: "x", shopId: SHOP, billLocalId: "b-2", bytes: new ArrayBuffer(1), mime: "audio/webm", recordedMs: 1000, createdAt: new Date().toISOString(), state });
      await saveDraft(db, SHOP, empty);
      expect(await db.meta.get(draftKey(SHOP)), state).toBeTruthy();
      await db.meta.delete(draftKey(SHOP));
    }
    await db.voiceQueue.clear();
    await saveDraft(db, SHOP, empty);
    expect(await db.meta.get(draftKey(SHOP))).toBeUndefined();
    await saveRecordingDraft(db, { shopId: SHOP, audio: new Blob(["a"]), recordedMs: 1000 });
    await saveDraft(db, SHOP, empty);
    expect(await db.meta.get(draftKey(SHOP))).toBeTruthy();
  });

  it("another bill's recording does not make this empty bill worth keeping", async () => {
    await db.voiceQueue.put({ recordingId: "y", shopId: SHOP, billLocalId: "other", bytes: new ArrayBuffer(1), mime: "audio/webm", recordedMs: 1000, createdAt: new Date().toISOString(), state: "failed" });
    await saveDraft(db, SHOP, { ...EMPTY_BILL, localId: "b-3", startedAt: new Date().toISOString() });
    expect(await db.meta.get(draftKey(SHOP))).toBeUndefined();
  });

  it("a bill with lines restores after a cold start as today", async () => {
    const view = await open(async (id) => done(id));
    const first = billId();
    await recordAndGenerate();
    await waitFor(() => expect(lines()).toBe(2));
    await settle();
    await coldStart(view, never);
    await waitFor(() => expect(lines()).toBe(2));
    expect(billId()).toBe(first);
    expect(await db.bills.count()).toBe(0);
  });
});
