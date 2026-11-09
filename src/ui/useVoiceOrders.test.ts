// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import type { VoiceJobOutcome } from "@/data/voiceJob";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { useVoiceOrders, type AppendedOrder } from "./useVoiceOrders";

// KB-385 step 4 (owner, 10 Nov 2026; doc 25 §5, §6, §8): Generate -> the phone's queue -> sent (or kept until online) -> the answer ->
// the bill (src/domain/aiAnswerBill) added ONCE, with the transcript ("Heard: ...") and which prices our code filled. Retry resends the
// SAME recording; a recording not yet in the bill blocks Bill Banao; Remove takes it out.

const BILL = "bill-1";
const SHOP = "shop-1";
const audio = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
const done = (recordingId: string): VoiceJobOutcome => ({
  kind: "done",
  recordingId,
  transcript: "2 किलो चीनी, 1 किलो चावल 60 रुपए किलो",
  items: [
    { spokenName: "चीनी", catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "default" },
    { spokenName: "चावल", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "kg", rate: 6000, rateUnit: "kg", total: null, priceType: "rate" },
  ],
});

let online = true;
let db: KiranaBillDB;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  db = new KiranaBillDB(`vo-${crypto.randomUUID()}`);
});
afterEach(() => db.close());

function setup(submit: (recordingId: string, audio: Blob) => Promise<VoiceJobOutcome>) {
  const appended: AppendedOrder[] = [];
  const submitSpy = vi.fn(submit);
  const hook = renderHook(() => useVoiceOrders({ db, shopId: SHOP, billLocalId: BILL, parser: SEED_PARSER_CATALOG, submit: submitSpy, onAppend: (o) => appended.push(o) }));
  return { ...hook, appended, submit: submitSpy };
}

describe("useVoiceOrders (KB-385)", () => {
  it("Generate online: the queued audio is sent once, the bill gets the lines ONCE, with the transcript and the filled prices", async () => {
    const t = setup(async (id) => done(id));
    await act(() => t.result.current.generate(audio(), 42_000));
    await waitFor(() => expect(t.appended).toHaveLength(1));
    expect(t.submit).toHaveBeenCalledOnce();
    expect(await t.submit.mock.calls[0]![1].arrayBuffer()).toEqual(await audio().arrayBuffer());
    const o = t.appended[0]!;
    expect(o.transcript).toBe("2 किलो चीनी, 1 किलो चावल 60 रुपए किलो");
    expect(o.lines.map((l) => [l.item.spokenName, l.source])).toEqual([["चीनी", "voice"], ["चावल", "voice"]]);
    expect(o.lines.map((l) => l.filled ?? null)).toEqual(["shop_price", null]);
    // D102: the line shows the name AS SAID (Devanagari) - even when the catalog filled its price (it would otherwise read "Chini")
    expect(o.lines.map((l) => l.displayName)).toEqual(["चीनी", "चावल"]);
    expect(o.waitedMs).toBeGreaterThanOrEqual(0);
    expect(o.waitedMs).toBeLessThan(10_000);
    await waitFor(() => expect(t.result.current.blocking).toEqual([]));
    expect(t.result.current.recordings.map((r) => [r.state, r.transcript])).toEqual([["appended", o.transcript]]);
  });

  it("offline at Generate: kept on the phone (queued, nothing sent, Bill Banao waits); back online it is sent and added", async () => {
    online = false;
    const t = setup(async (id) => done(id));
    await act(() => t.result.current.generate(audio(), 5_000));
    await waitFor(() => expect(t.result.current.blocking.map((r) => r.state)).toEqual(["queued"]));
    expect(t.submit).not.toHaveBeenCalled();
    expect(t.result.current.offline).toBe(true);
    online = true;
    await act(async () => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(t.appended).toHaveLength(1));
    expect(t.result.current.blocking).toEqual([]);
  });

  it("a failure keeps the recording (Bill Banao waits); Retry resends the SAME recording and adds it once", async () => {
    let fail = true;
    const t = setup(async (id) => (fail ? { kind: "failed", recordingId: id, reason: "timeout" } : done(id)));
    await act(() => t.result.current.generate(audio(), 5_000));
    await waitFor(() => expect(t.result.current.blocking.map((r) => [r.state, r.reason])).toEqual([["failed", "timeout"]]));
    const id = t.result.current.recordings[0]!.recordingId;
    fail = false;
    await act(() => Promise.all([t.result.current.retry(id), t.result.current.retry(id)])); // a double tap on Retry
    await waitFor(() => expect(t.result.current.blocking).toEqual([]));
    expect(t.submit.mock.calls.map((c) => c[0])).toEqual([id, id]); // the second tap while sending is ignored on the phone
    expect(t.appended).toHaveLength(1);
  });

  it("gave up (no answer in 75 s) also keeps it for Retry; Remove takes it out so Bill Banao no longer waits", async () => {
    const t = setup(async (id) => ({ kind: "gave_up", recordingId: id }));
    await act(() => t.result.current.generate(audio(), 5_000));
    await waitFor(() => expect(t.result.current.blocking.map((r) => r.state)).toEqual(["gave_up"]));
    await act(() => t.result.current.remove(t.result.current.recordings[0]!.recordingId));
    await waitFor(() => expect(t.result.current.recordings).toEqual([]));
    expect(t.appended).toEqual([]);
  });

  it("nothing understood (0 lines): no lines added, the recording no longer blocks, the transcript stays to show 'No items found'", async () => {
    const t = setup(async (id) => ({ kind: "done", recordingId: id, transcript: "हाँ जी बोलिए", items: [] }));
    await act(() => t.result.current.generate(audio(), 3_000));
    await waitFor(() => expect(t.result.current.recordings.map((r) => r.state)).toEqual(["appended"]));
    expect(t.appended).toHaveLength(1);
    expect(t.appended[0]!.lines).toEqual([]);
    expect(t.result.current.recordings[0]!.transcript).toBe("हाँ जी बोलिए");
  });

  it("a reload in the middle: a recording answered but not yet added is added on start - once", async () => {
    const id = crypto.randomUUID();
    await db.voiceQueue.add({ ...done(id), shopId: SHOP, billLocalId: BILL, bytes: new ArrayBuffer(3), mime: "audio/webm", recordedMs: 1_000, createdAt: new Date().toISOString(), state: "done" } as never);
    const t = setup(async (rid) => done(rid));
    window.dispatchEvent(new Event("online")); // the phone comes back online at the same moment: two drains at once
    await waitFor(() => expect(t.appended).toHaveLength(1));
    expect(t.submit).not.toHaveBeenCalled();
    t.rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.appended).toHaveLength(1);
  });
});
