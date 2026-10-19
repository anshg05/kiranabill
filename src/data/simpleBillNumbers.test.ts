import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "./db";
import { consumeNextNumber, takeNextNumber } from "./receiptNumbers";
import { numberChunks } from "@/domain/receipt";

// KB-341 (D87): plain bill numbers - 1, 2, 3 ... - no prefix, no padding; the rare fallback is a 6-character device code + "-n".

const shopRow = (receiptPrefix: string | null) => ({
  id: "shop-1", syncStatus: "synced" as const, name: "S", phone: null, address: null, logoUrl: null,
  catalogMode: "custom_only" as const, billLanguage: "en" as const, receiptPrefix, updatedAt: "2026-10-19T00:00:00.000Z",
});
const block = (over: Partial<{ id: string; deviceId: string; blockStart: number; blockEnd: number; nextNumber: number }> = {}) => ({
  id: "b1", shopId: "shop-1", deviceId: "dev-1", blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "x", syncStatus: "synced" as const, ...over,
});

describe("KB-341 - block numbers are plain numbers", () => {
  let db: KiranaBillDB;
  beforeEach(() => {
    db = new KiranaBillDB(`simple-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("a new shop's first bill is 1, then 2, 3 - no prefix, no padding", async () => {
    await db.shops.put(shopRow("KB"));
    await db.receiptNumberBlocks.put(block());
    const got: string[] = [];
    for (let i = 0; i < 3; i++) got.push((await takeNextNumber(db, "shop-1", "dev-1")).receiptNumber);
    expect(got).toEqual(["1", "2", "3"]);
  });

  it("the shop's receipt_prefix is unused for new numbers - 'KB', another prefix and none all give the same plain number", async () => {
    for (const prefix of ["KB", "SHARMA", null]) {
      await db.shops.put(shopRow(prefix));
      await db.receiptNumberBlocks.put(block({ blockEnd: 200, nextNumber: 59 }));
      expect((await takeNextNumber(db, "shop-1", "dev-1")).receiptNumber).toBe("59");
    }
  });

  it("an existing shop continues: a block part-used (next 13) gives 13, then the numbers after it - never one already used", async () => {
    await db.shops.put(shopRow("KB"));
    await db.receiptNumberBlocks.put(block({ nextNumber: 13 }));
    const a = await takeNextNumber(db, "shop-1", "dev-1");
    const b = await takeNextNumber(db, "shop-1", "dev-1");
    expect([a, b]).toEqual([{ receiptNumber: "13", source: "block" }, { receiptNumber: "14", source: "block" }]);
  });

  it("no zero padding at any size: 9 -> 10 -> 100 -> 1000", async () => {
    await db.shops.put(shopRow("KB"));
    for (const n of [9, 10, 100, 1000]) {
      await db.receiptNumberBlocks.put(block({ blockStart: n, blockEnd: n + 49, nextNumber: n }));
      expect((await takeNextNumber(db, "shop-1", "dev-1")).receiptNumber).toBe(String(n));
    }
  });
});

describe("KB-341 - the fallback number is a 6-character device code + '-n'", () => {
  let db: KiranaBillDB;
  beforeEach(() => {
    db = new KiranaBillDB(`simple-fb-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("'7F2A91-1', then '7F2A91-2': the first 6 characters of the device UUID, upper-case, and a counter that only goes up", async () => {
    await db.shops.put(shopRow("KB"));
    const device = "7f2a9134-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const first = await consumeNextNumber({} as never, db, "shop-1", device);
    const second = await consumeNextNumber({} as never, db, "shop-1", device);
    expect(first).toEqual({ receiptNumber: "7F2A91-1", source: "fallback" });
    expect(second.receiptNumber).toBe("7F2A91-2");
  });

  it("two devices with different codes never produce the same number, even at the same counter", async () => {
    const other = new KiranaBillDB(`simple-fb2-${crypto.randomUUID()}`);
    try {
      const a = await consumeNextNumber({} as never, db, "shop-1", "7f2a9134-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
      const b = await consumeNextNumber({} as never, other, "shop-1", "0b3c5d77-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
      expect(a.receiptNumber).toBe("7F2A91-1");
      expect(b.receiptNumber).toBe("0B3C5D-1");
    } finally {
      other.close();
      await other.delete();
    }
  });

  it("a fallback number is never a plain number (it has a hyphen) and never an old KB-000001 (the code is not 'KB')", async () => {
    const n = (await consumeNextNumber({} as never, db, "shop-1", "ab12cd34-0000-4000-8000-000000000000")).receiptNumber;
    expect(n).toMatch(/^[0-9A-F]{6}-\d+$/);
    expect(n.startsWith("KB-")).toBe(false);
  });

  it("the receipt may break only after the hyphen: '59' is one piece, '7F2A91-1' two, an old UUID number as before", () => {
    expect(numberChunks("59")).toEqual(["59"]);
    expect(numberChunks("7F2A91-1")).toEqual(["7F2A91-", "1"]);
    expect(numberChunks("KB-000059")).toEqual(["KB-", "000059"]);
    expect(numberChunks("KB-550e8400-e29b-41d4-a716-446655440000-1").join("")).toBe("KB-550e8400-e29b-41d4-a716-446655440000-1");
  });
});
