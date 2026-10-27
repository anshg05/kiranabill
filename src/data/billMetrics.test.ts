import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { gateReport } from "@/domain/billMetrics";
import { KiranaBillDB } from "./db";
import { finaliseBill } from "./testNumbers";
import { cancelBillLocal } from "./cancelBill";
import { listColdStarts, loadGateInputs, recordColdStart, recordFinalised, type FinalisedInput } from "./billMetrics";

// KB-404 (D80): a bill's measurements are written AFTER it commits, from the stored bill, and read for the gate report.
// Numbers and enums only; a failure never touches the bill.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`metrics-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));
let at = Date.parse("2026-10-16T10:00:00.000Z");
async function bill(t = "2 kilo chini") {
  const localId = crypto.randomUUID();
  at += 60_000;
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: new Date(at).toISOString(), customer: { name: "Ramesh", mobile: "9876543210" }, lines: lines(t), flags: [], now: new Date(at) });
  return localId;
}
const input = (billLocalId: string, over: Partial<FinalisedInput> = {}): FinalisedInput => ({
  billLocalId, deviceId, turns: 1, secondsToBill: 14, utterances: [{ path: "fastpath", stopToTranscriptMs: 900, transcriptToItemsMs: 110 }], finaliseToReceiptMs: 180,
  snapshot: { voiceLines: 1, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0 }, ...over,
});

describe("recordFinalised", () => {
  it("writes one pending row from the STORED bill: its receipt number, total and item count", async () => {
    const id = await bill("2 kilo chini");
    expect(await recordFinalised(db, shopId, input(id))).toBe(true);
    const stored = (await db.bills.get(id))!;
    const row = (await db.billMetrics.get(id))!;
    expect(row).toMatchObject({ receiptNumber: stored.receiptNumber, totalPaise: stored.totalPaise, lineCount: 1, turns: 1, secondsToBill: 14, finaliseToReceiptMs: 180, syncStatus: "pending", shopId });
  });

  it("holds NO customer data: the stored row has no name, no mobile, no transcript, no item name", async () => {
    const id = await bill();
    await recordFinalised(db, shopId, input(id));
    const row = (await db.billMetrics.get(id))!;
    const text = JSON.stringify(row);
    expect(text).not.toContain("Ramesh");
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("Chini");
    expect(Object.keys(row).sort()).toEqual([
      "billLocalId", "deviceId", "editedLines", "finaliseToReceiptMs", "flagsAcknowledged", "flagsRaised", "lineCount", "localId", "manualLines", "notAdded", "numberMs",
      "receiptNumber", "recordedAt", "removedLines", "secondsToBill", "shopId", "syncStatus", "totalPaise", "turns", "updatedAt", "utterances", "voiceLines",
    ]);
  });

  it("is idempotent - a bill has one row, the first one", async () => {
    const id = await bill();
    await recordFinalised(db, shopId, input(id, { turns: 1 }));
    await recordFinalised(db, shopId, input(id, { turns: 9 }));
    expect(await db.billMetrics.count()).toBe(1);
    expect((await db.billMetrics.get(id))!.turns).toBe(1);
  });

  it("no number from a metric ever changes a bill: the stored bill and items are identical before and after", async () => {
    const id = await bill("2 kilo chini");
    const before = { bill: await db.bills.get(id), items: await db.billItems.where("billLocalId").equals(id).toArray() };
    await recordFinalised(db, shopId, input(id, { turns: 99, secondsToBill: 99999 }));
    expect({ bill: await db.bills.get(id), items: await db.billItems.where("billLocalId").equals(id).toArray() }).toEqual(before);
  });

  it("a failing write is swallowed (logged by name) and the bill is untouched; an unknown or non-final bill writes nothing", async () => {
    const id = await bill();
    const before = await db.bills.get(id);
    const spy = vi.spyOn(db.billMetrics, "add").mockRejectedValue(new Error("disk full"));
    expect(await recordFinalised(db, shopId, input(id))).toBe(false);
    expect(await db.bills.get(id)).toEqual(before);
    spy.mockRestore();
    expect(await recordFinalised(db, shopId, input(crypto.randomUUID()))).toBe(false);
    await db.bills.update(id, { status: "draft" });
    expect(await recordFinalised(db, shopId, input(id))).toBe(false);
    expect(await db.billMetrics.count()).toBe(0);
  });

  it("negative or fractional timings are stored as whole non-negative ms", async () => {
    const id = await bill();
    await recordFinalised(db, shopId, input(id, { finaliseToReceiptMs: -5.4 }));
    expect((await db.billMetrics.get(id))!.finaliseToReceiptMs).toBe(0);
  });
});

describe("loadGateInputs - what the report reads", () => {
  it("each row with its bill's status and time; a reissue replacement is flagged; the report excludes both; the cancelled bill's wrong price is an escaped error", async () => {
    const original = await bill("2 kilo chini");
    const replacement = crypto.randomUUID();
    await recordFinalised(db, shopId, input(original));
    await cancelBillLocal(db, { shopId, billLocalId: original, reason: "wrong_price", deviceId, replacementLocalId: replacement });
    at += 60_000;
    await finaliseBill(db, { localId: replacement, shopId, deviceId, startedAt: new Date(at).toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: new Date(at) });
    await recordFinalised(db, shopId, input(replacement));
    const plain = await bill("1 kilo besan");
    await recordFinalised(db, shopId, input(plain));

    const { inputs, cancellations } = await loadGateInputs(db, shopId);
    const by = (id: string) => inputs.find((i) => i.metrics.billLocalId === id)!;
    expect([by(original).status, by(original).isReissue]).toEqual(["cancelled", false]);
    expect([by(replacement).status, by(replacement).isReissue]).toEqual(["final", true]);
    expect([by(plain).status, by(plain).isReissue]).toEqual(["final", false]);
    expect(cancellations).toEqual([{ reason: "wrong_price", billFinalizedAt: (await db.bills.get(original))!.finalizedAt }]);
    const g = gateReport(inputs, cancellations);
    expect(g.voice.n).toBe(1);
    expect(g.escapedErrors).toBe(1);
  });

  it("a metrics row whose bill has not arrived yet is skipped, not guessed", async () => {
    const id = await bill();
    await recordFinalised(db, shopId, input(id));
    const { shopId: _s, localId: _l, syncStatus: _y, updatedAt: _u, serverId: _v, ...row } = (await db.billMetrics.get(id))!;
    await db.billMetrics.add({ ...row, billLocalId: crypto.randomUUID(), shopId, localId: crypto.randomUUID(), syncStatus: "synced", updatedAt: new Date().toISOString() });
    expect((await loadGateInputs(db, shopId)).inputs).toHaveLength(1);
  });

  it("per shop: another shop's rows are never read", async () => {
    const id = await bill();
    await recordFinalised(db, shopId, input(id));
    expect((await loadGateInputs(db, "99999999-9999-4999-8999-999999999999")).inputs).toEqual([]);
  });
});

describe("cold start samples - device only", () => {
  it("kept (the last 20), in order, whole ms", async () => {
    for (let i = 1; i <= 22; i++) await recordColdStart(db, i * 100 + 0.4, `2026-10-16T10:${String(i).padStart(2, "0")}:00.000Z`);
    const list = await listColdStarts(db);
    expect(list).toHaveLength(20);
    expect(list[0]!.ms).toBe(300);
    expect(list.at(-1)!.ms).toBe(2200);
  });
  it("damaged stored text reads as none", async () => {
    await db.meta.put({ key: "coldStarts", value: "oops" });
    expect(await listColdStarts(db)).toEqual([]);
  });
});
