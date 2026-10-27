import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB } from "./db";
import { takeFallbackNumber } from "./receiptNumbers";
import { numberChunks } from "@/domain/receipt";

// KB-341 (D87): the rare offline number is a 6-character device code + "-n". (KB-351: the plain numbers 1, 2, 3 ... now come from
// the server's counter - see serverNumber.test.ts and serverBillNumbers.e2e.test.ts; blocks are retired.)

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
    const device = "7f2a9134-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(await takeFallbackNumber(db, device)).toBe("7F2A91-1");
    expect(await takeFallbackNumber(db, device)).toBe("7F2A91-2");
  });

  it("two devices with different codes never produce the same number, even at the same counter", async () => {
    const other = new KiranaBillDB(`simple-fb2-${crypto.randomUUID()}`);
    try {
      expect(await takeFallbackNumber(db, "7f2a9134-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toBe("7F2A91-1");
      expect(await takeFallbackNumber(other, "0b3c5d77-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toBe("0B3C5D-1");
    } finally {
      other.close();
      await other.delete();
    }
  });

  it("a fallback number is never a plain number (it has a hyphen) and never an old KB-000001 (the code is not 'KB')", async () => {
    const n = await takeFallbackNumber(db, "ab12cd34-0000-4000-8000-000000000000");
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
