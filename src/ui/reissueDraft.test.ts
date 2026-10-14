import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { editRate } from "@/domain/billEdit";
import { buildFinalBill, type FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { billReducer, newBill } from "./useBillLines";
import { reissueState } from "./reissueDraft";

// KB-325 (D79): "Cancel and make a new bill" builds the replacement's draft from the STORED bill - each line exactly as
// stored, the same customer - under the replacement's id (the one the cancellation points to). It then goes through the
// ordinary Bill Banao, so the review flags and the "Price needed" check apply as for any bill.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`reissue-${crypto.randomUUID()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};
async function stored(customer = { name: "Ramesh", mobile: "9876543210" as string | null }) {
  const localId = crypto.randomUUID();
  const finalLines: FinalLine[] = [
    ["2 kilo cheeni", (i: FinalLine["item"]) => ok(editRate(i, "48"))],
    ["500 gram besan", undefined],
    ["sabun 180 rupay", undefined],
  ].flatMap(([t, edit], u) =>
    parseUtterance(t as string, SEED_PARSER_CATALOG)!.map((item) => ({
      id: `l${u}`, utteranceId: u, item: edit ? (edit as (i: FinalLine["item"]) => FinalLine["item"])(item) : item, original: item,
      displayName: item.catalogId ? SEED_PARSER_CATALOG.byId.get(item.catalogId)!.displayName : item.spokenName, source: "fastpath" as const,
    })),
  );
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: "2026-10-14T05:00:00.000Z", customer, lines: finalLines, flags: [] });
  const bill = (await db.bills.get(localId))!;
  const items = await db.billItems.where("billLocalId").equals(localId).sortBy("lineNo");
  return { bill, items };
}

describe("reissueState", () => {
  it("is a fresh draft under the replacement's id, with the stored customer and every stored line", async () => {
    const { bill, items } = await stored();
    const replacement = crypto.randomUUID();
    const state = reissueState(bill, items, replacement, "2026-10-14T07:00:00.000Z");
    expect(state.localId).toBe(replacement);
    expect(state.startedAt).toBe("2026-10-14T07:00:00.000Z");
    expect(state.customer).toEqual({ name: "Ramesh", mobile: "9876543210" });
    expect(state.rows).toHaveLength(items.length);
    expect(state.rows.map((r) => r.displayName)).toEqual(items.map((i) => i.displayName));
    expect(state.rows.every((r) => r.source === "manual" && r.item === r.original)).toBe(true);
    expect(state.utterances).toEqual([{ id: 1, lineIds: state.rows.map((r) => r.id), flags: [], transcript: "" }]);
    expect(state.notAdded).toEqual([]);
    expect(state.discarded).toEqual([]);
    expect(state.nextId).toBe(items.length + 1);
  });

  it("the lines are exactly as stored: the ₹48 edit stays ₹48, a total-only line stays total-only; the total is the original total", async () => {
    const { bill, items } = await stored();
    const state = reissueState(bill, items, crypto.randomUUID(), new Date().toISOString());
    expect(state.rows[0]!.item).toMatchObject({ qty: 2, unit: "kg", rate: 4800, total: 9600 });
    expect(state.rows[2]!.item).toMatchObject({ rate: null, rateUnit: null, total: 18_000, priceType: "total" });
    const built = buildFinalBill(state.rows, []);
    if (!built.ok) throw new Error(built.error);
    expect(built.totalPaise).toBe(bill.totalPaise);
    expect(built.items.map((i) => [i.displayName, i.qty, i.unit, i.ratePaise, i.totalPaise])).toEqual(items.map((i) => [i.displayName, i.qty, i.unit, i.ratePaise, i.totalPaise]));
  });

  it("restores onto an empty bill - and never onto one already started (a late call cannot wipe lines)", async () => {
    const { bill, items } = await stored();
    const state = reissueState(bill, items, crypto.randomUUID(), new Date().toISOString());
    expect(billReducer(newBill(), { type: "restore", state }).rows).toHaveLength(3);
    const started = billReducer(newBill(), { type: "add", lines: [{ item: state.rows[0]!.item, displayName: "x", source: "manual" }], flags: [], transcript: "" });
    expect(billReducer(started, { type: "restore", state }).rows).toHaveLength(1);
  });

  it("a Cash bill stays Cash", async () => {
    const { bill, items } = await stored({ name: "Cash", mobile: null });
    expect(reissueState(bill, items, crypto.randomUUID(), new Date().toISOString()).customer).toEqual({ name: "Cash", mobile: null });
  });
});
