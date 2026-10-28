// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "@/data/db";
import type { ServerNumber } from "@/data/receiptNumbers";
import { useFinalise } from "./useFinalise";
import type { BillDraft } from "./useBillLines";

// KB-351 (D92): Bill Banao asks the server for the shop's next number ONCE, then saves. Whatever the server does - an answer, nothing
// (offline / slow), a refusal, an exception - the bill is saved at once, and the shopkeeper never sees "pending" or an error.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "7f2a9134-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`ui-fin-num-${crypto.randomUUID()}`);
});
afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

const draft = (): BillDraft => {
  const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
  const lines: FinalLine[] = items.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" }));
  return { localId: crypto.randomUUID(), startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines, flags: [], discarded: [] } as unknown as BillDraft;
};
async function bill(getNumber?: (id: string) => Promise<ServerNumber | null>) {
  const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber }));
  const d = draft();
  await act(async () => result.current.finalise(d));
  return { saved: result.current.saved, phase: result.current.phase, stored: await db.bills.get(d.localId), asked: d.localId };
}

describe("useFinalise + the server number", () => {
  it("the server's number is the bill's number: plain, source 'counter', and the round trip is kept for the metrics", async () => {
    const getNumber = vi.fn(async (): Promise<ServerNumber> => ({ receiptNumber: "59", source: "counter", ms: 120 }));
    const r = await bill(getNumber);
    expect(r.phase).toBe("saved");
    expect(r.saved).toMatchObject({ receiptNumber: "59", numberMs: 120 });
    expect(r.stored).toMatchObject({ receiptNumber: "59", receiptNumberSource: "counter" });
    expect(getNumber).toHaveBeenCalledTimes(1);
    expect(getNumber).toHaveBeenCalledWith(r.asked); // asked for THIS bill - a retry gets the same number
  });

  it("no number (offline, slow, refused): saved AT ONCE with the offline number - never pending, never an error", async () => {
    const r = await bill(async () => null);
    expect(r.phase).toBe("saved");
    expect(r.saved).toMatchObject({ receiptNumber: "7F2A91-1", numberMs: null });
    expect(r.stored).toMatchObject({ receiptNumber: "7F2A91-1", receiptNumberSource: "fallback" });
  });

  it("an exception from the number call is the same: the bill saves with the offline number", async () => {
    const r = await bill(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(r.phase).toBe("saved");
    expect(r.stored?.receiptNumberSource).toBe("fallback");
  });

  it("no getNumber at all (an offline session has no live token): the offline number", async () => {
    const r = await bill(undefined);
    expect(r.phase).toBe("saved");
    expect(r.stored?.receiptNumber).toBe("7F2A91-1");
  });

  it("a double tap asks once and saves one bill", async () => {
    const getNumber = vi.fn(async (): Promise<ServerNumber> => ({ receiptNumber: "3", source: "counter", ms: 80 }));
    const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber }));
    const d = draft();
    await act(async () => {
      await Promise.all([result.current.finalise(d), result.current.finalise(d)]);
    });
    expect(getNumber).toHaveBeenCalledTimes(1);
    expect(await db.bills.count()).toBe(1);
  });
});

// KB-352 (owner, 28 Oct 2026): the receipt shows right after the number and the one local write. Whatever runs after it (learning, the
// catalog reload, sync) is started only once the receipt is saved and painted, and finalise never waits for it.
describe("useFinalise - nothing after the receipt can hold it up", () => {
  const ok = async (): Promise<ServerNumber> => ({ receiptNumber: "5", source: "counter", ms: 90 });

  it("an after-save step that NEVER finishes does not stop the receipt: the phase is 'saved' and the bill is on screen", async () => {
    const onSaved = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber: ok, onSaved: onSaved as never }));
    await act(async () => result.current.finalise(draft()));
    expect(result.current.phase).toBe("saved");
    expect(result.current.saved?.receiptNumber).toBe("5");
  });

  it("the after-save work starts only AFTER the receipt state is set (and a frame later), never before it", async () => {
    let phaseWhenCalled: string | null = null;
    let latest: ReturnType<typeof useFinalise> | null = null;
    const hook = renderHook(() => {
      const f = useFinalise({ localDb: db, shopId, deviceId, getNumber: ok, onSaved: () => void (phaseWhenCalled = latest?.phase ?? null) });
      latest = f;
      return f;
    });
    await act(async () => hook.result.current.finalise(draft()));
    expect(phaseWhenCalled).toBeNull(); // not synchronously with the save
    await waitFor(() => expect(phaseWhenCalled).toBe("saved"));
  });

  it("onSaved is told which bill was saved", async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber: ok, onSaved }));
    const d = draft();
    await act(async () => result.current.finalise(d));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]![1]).toBe(d.localId);
  });

  it("an after-save step that throws is swallowed - the saved bill stays saved", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber: ok, onSaved: () => Promise.reject(new Error("learning exploded")) as never }));
    await act(async () => result.current.finalise(draft()));
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current.phase).toBe("saved");
    warn.mockRestore();
  });

  it("the phases of the save are measured: the number wait, the local write, the receipt read - and the moment it was saved", async () => {
    const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber: ok }));
    await act(async () => result.current.finalise(draft()));
    const p = result.current.saved!.phases!;
    for (const v of [p.numberWaitMs, p.writeMs, p.readMs, p.savedAtMs]) expect(Number.isFinite(v) && v >= 0).toBe(true);
  });

  it("a number that never comes is measured as the wait it cost, and the bill takes an offline number", async () => {
    const slow = () => new Promise<ServerNumber | null>((r) => setTimeout(() => r(null), 60));
    const { result } = renderHook(() => useFinalise({ localDb: db, shopId, deviceId, getNumber: slow }));
    await act(async () => result.current.finalise(draft()));
    expect(result.current.saved!.phases!.numberWaitMs).toBeGreaterThanOrEqual(50);
    expect(result.current.saved!.receiptNumber).toBe("7F2A91-1");
  });
});
