import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "@/data/db";
import type { ParsedItem } from "@/domain/grammar";
import { clearDraft, draftKey, isWorthSaving, loadDraft, parseStoredBill, saveDraft, serializeBill } from "./billDraftStore";
import { EMPTY_BILL, type BillRow, type BillState } from "./useBillLines";

// KB-313: the half-built bill, kept in the PER-USER database's meta table (D38), one key per shop.
// Prices come back exactly as they were - a restored bill is never re-priced from the catalog.
const item = (over: Partial<ParsedItem> = {}): ParsedItem => ({
  spokenName: "chini", catalogId: "p-chini", isCustom: false, matchStatus: "matched", qty: 500, unit: "gm", rate: 4500, rateUnit: "kg", total: 2250, priceType: "rate", ...over,
});
const row = (id: string, over: Partial<ParsedItem> = {}, extra: Partial<BillRow> = {}): BillRow => ({
  id, utteranceId: 1, item: item(over), original: item(), displayName: "Chini", source: "fastpath", ...extra,
});
const bill = (over: Partial<BillState> = {}): BillState => ({
  ...EMPTY_BILL, localId: "6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12", startedAt: "2026-10-08T10:00:00.000Z", nextId: 3,
  rows: [row("l1"), row("l2", { spokenName: "parle g", catalogId: null, isCustom: true, matchStatus: "none", qty: 3, unit: "piece", rate: 1000, rateUnit: "piece", total: 3000 })],
  utterances: [{ id: 1, lineIds: ["l1", "l2"], flags: [{ id: "f1", code: "unusual_rate", severity: "MEDIUM", message: "m", itemIndex: 0 }], transcript: "500 gram chini teen parle g" }],
  acknowledged: new Set(["item-0-unusual_rate"]),
  customer: { name: "Ramesh", mobile: "9876543210" },
  discarded: [row("gone")],
  ...over,
});

describe("serialising the half-built bill", () => {
  it("round-trips everything that matters, with every price exactly as it was", () => {
    const original = bill({ notAdded: [{ id: "n1", transcript: "kuch aur", retrying: false, message: "Couldn't read the items" }], nextNotAddedId: 2 });
    const back = parseStoredBill(serializeBill(original))!;
    expect(back).not.toBeNull();
    expect(back.localId).toBe(original.localId);
    expect(back.startedAt).toBe(original.startedAt);
    expect(back.rows).toEqual(original.rows);
    expect(back.rows[0]!.item).toMatchObject({ qty: 500, rate: 4500, rateUnit: "kg", total: 2250 });
    expect(back.utterances).toEqual(original.utterances);
    expect([...back.acknowledged]).toEqual(["item-0-unusual_rate"]);
    expect(back.customer).toEqual({ name: "Ramesh", mobile: "9876543210" });
    expect(back.discarded).toEqual(original.discarded);
    expect(back.nextId).toBe(3);
    expect(back.notAdded).toEqual(original.notAdded);
    expect(back.nextNotAddedId).toBe(2);
  });

  it("the one-level undo and the focused line are not kept; a retry that was in flight comes back as not retrying (its request died)", () => {
    const original = bill({
      removed: { row: row("x"), at: 0 }, focusLineId: "l1",
      notAdded: [{ id: "n1", transcript: "kuch aur", retrying: true, message: "Couldn't read the items" }],
    });
    const back = parseStoredBill(serializeBill(original))!;
    expect(back.removed).toBeNull();
    expect(back.focusLineId).toBeNull();
    expect(back.notAdded[0]).toMatchObject({ transcript: "kuch aur", retrying: false });
  });

  it("anything damaged is refused whole - never a half-restored bill and never a thrown error", () => {
    const good = JSON.parse(serializeBill(bill()));
    const bad: unknown[] = [
      "not json {", "", "null", "42", JSON.stringify({}), JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, rows: "no" }),
      JSON.stringify({ ...good, rows: [{ id: "l1" }] }),
      JSON.stringify({ ...good, rows: [{ ...good.rows[0], item: { ...good.rows[0].item, qty: "2" } }] }),
      JSON.stringify({ ...good, rows: [{ ...good.rows[0], item: { ...good.rows[0].item, rate: 45.5 } }] }), // paise are integers (rule 1)
      JSON.stringify({ ...good, rows: [{ ...good.rows[0], item: { ...good.rows[0].item, total: 1e300 } }] }),
      JSON.stringify({ ...good, customer: { name: "", mobile: null } }),
      JSON.stringify({ ...good, customer: { name: "Cash", mobile: "12345" } }),
      JSON.stringify({ ...good, localId: "" }),
      JSON.stringify({ ...good, utterances: [{ id: 1 }] }),
      JSON.stringify({ ...good, acknowledged: "x" }),
    ];
    for (const text of bad) expect(parseStoredBill(String(text))).toBeNull();
  });

  it("what is worth keeping: a line, a not-added utterance, or a typed customer - not an empty bill", () => {
    expect(isWorthSaving({ ...EMPTY_BILL, localId: "x", startedAt: "y" })).toBe(false);
    expect(isWorthSaving(bill())).toBe(true);
    expect(isWorthSaving({ ...EMPTY_BILL, notAdded: [{ id: "n1", transcript: "t", retrying: false, message: "m" }] })).toBe(true);
    expect(isWorthSaving({ ...EMPTY_BILL, customer: { name: "Ramesh", mobile: null } })).toBe(true);
    expect(isWorthSaving({ ...EMPTY_BILL, customer: { name: "Cash", mobile: "9876543210" } })).toBe(true);
  });
});

describe("the draft in the per-user database", () => {
  let db: KiranaBillDB;
  beforeEach(() => {
    db = new KiranaBillDB(`bill-draft-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("saves, loads and clears - one key per shop", async () => {
    await saveDraft(db, "shop-a", bill());
    expect(await loadDraft(db, "shop-a")).toMatchObject({ localId: "6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12", customer: { name: "Ramesh" } });
    expect(await loadDraft(db, "shop-b")).toBeNull();
    expect((await db.meta.toArray()).map((m) => m.key)).toEqual([draftKey("shop-a")]);
    await clearDraft(db, "shop-a");
    expect(await loadDraft(db, "shop-a")).toBeNull();
    expect(await db.meta.count()).toBe(0);
  });

  it("saving an empty bill removes an older draft instead of keeping it", async () => {
    await saveDraft(db, "shop-a", bill());
    await saveDraft(db, "shop-a", { ...EMPTY_BILL, localId: "z", startedAt: "z" });
    expect(await loadDraft(db, "shop-a")).toBeNull();
  });

  it("another user's database never sees it (D38: one database per signed-in user)", async () => {
    const other = new KiranaBillDB(`bill-draft-other-${crypto.randomUUID()}`);
    await saveDraft(db, "shop-a", bill());
    expect(await loadDraft(other, "shop-a")).toBeNull();
    other.close();
    await other.delete();
  });

  it("a damaged stored value loads as nothing, and is removed", async () => {
    await db.meta.put({ key: draftKey("shop-a"), value: "{broken" });
    expect(await loadDraft(db, "shop-a")).toBeNull();
    expect(await db.meta.get(draftKey("shop-a"))).toBeUndefined();
  });
});
