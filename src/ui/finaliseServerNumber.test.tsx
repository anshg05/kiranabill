// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
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
