import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB } from "./db";
import { reserveBlock, consumeNextNumber } from "./receiptNumbers";

type Handler = (op: string, payload: unknown, filters: Record<string, unknown>) => { data: unknown; error: unknown };

function makeMockClient(handlers: Record<string, Handler>): SupabaseClient {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "";
    let payload: unknown;

    const builder = {
      select: (col: string) => {
        if (!op) op = "select";
        filters.select = col;
        return builder;
      },
      insert: (row: unknown) => {
        op = "insert";
        payload = row;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      order: (col: string, opts: unknown) => {
        filters.order = { col, opts };
        return builder;
      },
      limit: (n: number) => {
        filters.limit = n;
        return builder;
      },
      single: () => {
        const handler = handlers[table];
        if (!handler) throw new Error(`no handler for table "${table}"`);
        return Promise.resolve(handler(op, payload, filters));
      },
      then: (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
        const handler = handlers[table];
        if (!handler) throw new Error(`no handler for table "${table}"`);
        return Promise.resolve(handler(op, payload, filters)).then(onFulfilled);
      },
    };
    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

describe("receiptNumbers.ts", () => {
  let localDb: KiranaBillDB;

  beforeEach(() => {
    localDb = new KiranaBillDB(`test-receipt-${crypto.randomUUID()}`);
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(async () => {
    await localDb.delete();
    vi.unstubAllGlobals();
  });

  describe("reserveBlock", () => {
    it("starts the first block for a shop at 1-50", async () => {
      const client = makeMockClient({
        receipt_number_blocks: (op) => {
          if (op === "select") return { data: [], error: null }; // no existing blocks
          if (op === "insert") return { data: { id: "block-1" }, error: null };
          throw new Error(`unexpected op "${op}"`);
        },
      });

      await reserveBlock(client, localDb, "shop-1", "device-1");

      const block = await localDb.receiptNumberBlocks.get("block-1");
      expect(block?.blockStart).toBe(1);
      expect(block?.blockEnd).toBe(50);
      expect(block?.nextNumber).toBe(1);
      expect(block?.syncStatus).toBe("synced");
    });

    it("starts the next block right after the highest existing block_end", async () => {
      const client = makeMockClient({
        receipt_number_blocks: (op) => {
          if (op === "select") return { data: [{ block_end: 150 }], error: null };
          if (op === "insert") return { data: { id: "block-2" }, error: null };
          throw new Error(`unexpected op "${op}"`);
        },
      });

      await reserveBlock(client, localDb, "shop-1", "device-1");

      const block = await localDb.receiptNumberBlocks.get("block-2");
      expect(block?.blockStart).toBe(151);
      expect(block?.blockEnd).toBe(200);
    });
  });

  describe("consumeNextNumber", () => {
    it("consumes from the active block, formats as {prefix}-{6-digit padded number}", async () => {
      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Test Shop",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: "KB",
        updatedAt: new Date().toISOString(),
      });
      await localDb.receiptNumberBlocks.add({
        id: "block-1",
        shopId: "shop-1",
        deviceId: "device-1",
        blockStart: 1,
        blockEnd: 50,
        nextNumber: 142,
        allocatedAt: new Date().toISOString(),
        syncStatus: "synced",
      });
      // Force nextNumber to a value within a wider block for this test's
      // exact-string assertion (block bounds don't matter here, only the
      // formatting of a specific consumed number).
      await localDb.receiptNumberBlocks.update("block-1", { blockEnd: 200 });

      const client = makeMockClient({});
      const result = await consumeNextNumber(client, localDb, "shop-1", "device-1");

      expect(result).toEqual({ receiptNumber: "KB-000142", source: "block" });

      const block = await localDb.receiptNumberBlocks.get("block-1");
      expect(block?.nextNumber).toBe(143);
      expect(block?.syncStatus).toBe("pending");
    });

    it("falls back to a full-device-UUID-based number when no block has numbers remaining", async () => {
      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Test Shop",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: "KB",
        updatedAt: new Date().toISOString(),
      });
      await localDb.receiptNumberBlocks.add({
        id: "block-1",
        shopId: "shop-1",
        deviceId: "device-1",
        blockStart: 1,
        blockEnd: 50,
        nextNumber: 51, // exhausted - nextNumber > blockEnd
        allocatedAt: new Date().toISOString(),
        syncStatus: "synced",
      });

      const client = makeMockClient({});
      const deviceId = "550e8400-e29b-41d4-a716-446655440000";
      const result = await consumeNextNumber(client, localDb, "shop-1", deviceId);

      expect(result.source).toBe("fallback");
      expect(result.receiptNumber).toBe(`KB-${deviceId}-1`);
    });

    it("fallback numbers never repeat across consecutive exhaustion calls", async () => {
      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Test Shop",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: "KB",
        updatedAt: new Date().toISOString(),
      });
      // No block at all - immediately exhausted.

      const client = makeMockClient({});
      const deviceId = "device-uuid-1";
      const first = await consumeNextNumber(client, localDb, "shop-1", deviceId);
      const second = await consumeNextNumber(client, localDb, "shop-1", deviceId);

      expect(first.receiptNumber).not.toBe(second.receiptNumber);
      expect(first.receiptNumber).toBe(`KB-${deviceId}-1`);
      expect(second.receiptNumber).toBe(`KB-${deviceId}-2`);
    });

    it("fires a background reservation when remaining numbers drop below the threshold, without blocking", async () => {
      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Test Shop",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: "KB",
        updatedAt: new Date().toISOString(),
      });
      // 43 remaining before this consume (44..50 inclusive = 7 remaining
      // after consuming 43) - below the 10-number threshold.
      await localDb.receiptNumberBlocks.add({
        id: "block-1",
        shopId: "shop-1",
        deviceId: "device-1",
        blockStart: 1,
        blockEnd: 50,
        nextNumber: 43,
        allocatedAt: new Date().toISOString(),
        syncStatus: "synced",
      });

      let reserveCalled = false;
      let reserveResolved = false;
      const client = makeMockClient({
        receipt_number_blocks: (op) => {
          if (op === "select") {
            reserveCalled = true;
            return { data: [{ block_end: 50 }], error: null };
          }
          if (op === "insert") {
            reserveResolved = true;
            return { data: { id: "block-2" }, error: null };
          }
          throw new Error(`unexpected op "${op}"`);
        },
      });

      const start = performance.now();
      const result = await consumeNextNumber(client, localDb, "shop-1", "device-1");
      const elapsedMs = performance.now() - start;

      // The consume call itself resolves without waiting for the
      // fire-and-forget reservation network round-trip.
      expect(result.source).toBe("block");
      expect(elapsedMs).toBeLessThan(50);

      // Give the fire-and-forget promise a microtask/tick to run.
      await new Promise((r) => setTimeout(r, 0));
      expect(reserveCalled).toBe(true);
      expect(reserveResolved).toBe(true);

      const newBlock = await localDb.receiptNumberBlocks.get("block-2");
      expect(newBlock?.blockStart).toBe(51);
    });

    it("does NOT fire a background reservation while offline, even below the threshold", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Test Shop",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: "KB",
        updatedAt: new Date().toISOString(),
      });
      await localDb.receiptNumberBlocks.add({
        id: "block-1",
        shopId: "shop-1",
        deviceId: "device-1",
        blockStart: 1,
        blockEnd: 50,
        nextNumber: 43,
        allocatedAt: new Date().toISOString(),
        syncStatus: "synced",
      });

      const client = makeMockClient({
        receipt_number_blocks: () => {
          throw new Error("should never be called while offline");
        },
      });

      const result = await consumeNextNumber(client, localDb, "shop-1", "device-1");
      expect(result.source).toBe("block");

      await new Promise((r) => setTimeout(r, 0));
      // No assertion needed beyond "didn't throw" - the mock itself
      // throws if reserveBlock's client calls ever fire.
    });
  });
});
