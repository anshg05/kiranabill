import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "./db";
import { PHASES_KEEP, listPhases, recordPhases } from "./phaseTimings";

// KB-352: where the time goes after Bill Banao, kept ON THIS PHONE ONLY (the device's meta table - never synced, no migration): per bill the
// number wait, the local write, the receipt read, the paint, and the background steps after it (learning, reload, sync).

let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`phases-${crypto.randomUUID()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe("phase timings (device-only)", () => {
  it("phases of one bill arrive in pieces and are merged into one row; times are whole ms", async () => {
    await recordPhases(db, "bill-1", { number: 173.4, write: 12.6, read: 3 });
    await recordPhases(db, "bill-1", { paint: 80 });
    await recordPhases(db, "bill-1", { learning: 40, reload: 25.2, sync: 900 });
    const rows = await listPhases(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billLocalId: "bill-1", number: 173, write: 13, read: 3, paint: 80, learning: 40, reload: 25, sync: 900 });
  });

  it("concurrent writers (the paint and the background steps) lose nothing", async () => {
    await Promise.all([recordPhases(db, "b", { paint: 50 }), recordPhases(db, "b", { learning: 10 }), recordPhases(db, "b", { sync: 20 }), recordPhases(db, "c", { paint: 1 })]);
    const rows = await listPhases(db);
    expect(rows.find((r) => r.billLocalId === "b")).toMatchObject({ paint: 50, learning: 10, sync: 20 });
    expect(rows).toHaveLength(2);
  });

  it("only the last bills are kept", async () => {
    for (let i = 0; i < PHASES_KEEP + 5; i++) await recordPhases(db, `bill-${i}`, { paint: i });
    const rows = await listPhases(db);
    expect(rows).toHaveLength(PHASES_KEEP);
    expect(rows[0]!.billLocalId).toBe("bill-5");
    expect(rows[rows.length - 1]!.billLocalId).toBe(`bill-${PHASES_KEEP + 4}`);
  });

  it("not a number is not a sample: NaN, undefined and negatives are dropped; junk in the store reads as nothing", async () => {
    await recordPhases(db, "x", { paint: Number.NaN, write: undefined as never, read: -4, sync: 7 });
    expect(await listPhases(db)).toEqual([expect.objectContaining({ billLocalId: "x", sync: 7 })]);
    expect((await listPhases(db))[0]).not.toHaveProperty("paint");
    await db.meta.put({ key: "billPhases", value: "{not json" });
    expect(await listPhases(db)).toEqual([]);
  });

  it("a failure to write is swallowed (a timing can never fail a bill)", async () => {
    db.close();
    await expect(recordPhases(db, "z", { paint: 1 })).resolves.toBeUndefined();
  });
});
