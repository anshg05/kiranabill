import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB } from "./db";
import {
  syncNow,
  pushBills,
  pushLearningEvents,
  pushPriceObservations,
  pullShop,
} from "./sync";

/**
 * A minimal fake of Supabase's fluent query builder, tailored to exactly
 * the call shapes sync.ts actually uses. `handlers` maps a table name to
 * a function that receives the operation performed on it ("upsert",
 * "select", "delete", "insert", "update") and the payload, and returns
 * the { data, error } result - deliberately hand-rolled per test rather
 * than a generic mock, so each adversarial scenario controls exactly
 * what the "server" does.
 */
type Handler = (op: string, payload: unknown, filters: Record<string, unknown>) => { data: unknown; error: unknown };

function makeMockClient(handlers: Record<string, Handler>): SupabaseClient {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "";
    let payload: unknown;

    const builder = {
      upsert: (row: unknown) => {
        op = "upsert";
        payload = row;
        return builder;
      },
      insert: (rows: unknown) => {
        op = "insert";
        payload = rows;
        return builder;
      },
      update: (row: unknown) => {
        op = "update";
        payload = row;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      select: () => {
        if (!op) op = "select";
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      gt: (col: string, val: unknown) => {
        filters[`${col}__gt`] = val;
        return builder;
      },
      single: () => {
        const handler = handlers[table];
        if (!handler) throw new Error(`no handler for table "${table}"`);
        const result = handler(op, payload, filters);
        return Promise.resolve(result);
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

describe("sync.ts", () => {
  let localDb: KiranaBillDB;

  beforeEach(() => {
    localDb = new KiranaBillDB(`test-sync-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await localDb.delete();
  });

  describe("adversarial: reverse-order bill + learningEvent push, same cycle", () => {
    it("a learningEvent whose parent bill is ALSO pending in this cycle still resolves - two-phase, not interleaved", async () => {
      const serverBillId = "server-bill-1";
      const serverEventId = "server-event-1";

      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });

      await localDb.learningEvents.add({
        localId: "event-1",
        shopId: "shop-1",
        syncStatus: "pending",
        billLocalId: "bill-1", // references the SAME pending bill, not yet a serverId
        eventType: "bill_finalized",
        payload: {},
        createdAt: "2026-09-20T10:00:01.000Z",
        updatedAt: "2026-09-20T10:00:01.000Z",
        deviceId: "device-1",
      });

      const client = makeMockClient({
        bills: () => ({ data: { id: serverBillId }, error: null }),
        bill_items: () => ({ data: [], error: null }),
        learning_events: () => ({ data: { id: serverEventId }, error: null }),
      });

      // Calling the two phases directly, in the same order syncNow() does,
      // proves the dependency resolves WITHIN one cycle - not that it
      // merely happens to work if called twice.
      await pushBills(client, localDb);
      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("synced");
      expect(bill?.serverId).toBe(serverBillId);

      await pushLearningEvents(client, localDb);
      const event = await localDb.learningEvents.get("event-1");
      expect(event?.syncStatus).toBe("synced");
      expect(event?.serverId).toBe(serverEventId);
    });

    it("a learningEvent whose parent bill has NOT synced this cycle is left pending, not errored", async () => {
      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending", // deliberately never pushed in this test
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });

      await localDb.learningEvents.add({
        localId: "event-1",
        shopId: "shop-1",
        syncStatus: "pending",
        billLocalId: "bill-1",
        eventType: "bill_finalized",
        payload: {},
        createdAt: "2026-09-20T10:00:01.000Z",
        updatedAt: "2026-09-20T10:00:01.000Z",
        deviceId: "device-1",
      });

      const client = makeMockClient({
        learning_events: () => {
          throw new Error("should never be called - parent bill has no serverId yet");
        },
      });

      const result = await pushLearningEvents(client, localDb);
      expect(result.anyTransientFailure).toBe(false);

      const event = await localDb.learningEvents.get("event-1");
      expect(event?.syncStatus).toBe("pending");
    });
  });

  describe("adversarial: permanent vs transient push failures", () => {
    it("a permanent error (real Postgres/PostgREST code) marks conflict and does not count as a transient failure", async () => {
      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });

      const client = makeMockClient({
        bills: () => ({
          data: null,
          error: { code: "42501", message: "new row violates row-level security policy" },
        }),
      });

      const result = await pushBills(client, localDb);
      expect(result.anyTransientFailure).toBe(false);

      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("conflict");
    });

    it("a transient error (no Postgres error code - a network-layer failure) leaves the row pending for retry", async () => {
      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });

      const client = makeMockClient({
        bills: () => ({
          data: null,
          error: { message: "fetch failed" }, // no .code - not a structured Postgres error
        }),
      });

      const result = await pushBills(client, localDb);
      expect(result.anyTransientFailure).toBe(true);

      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("pending"); // NOT conflict - eligible for retry
    });

    it("a trigger rejection (P0001, e.g. bills_immutability) also marks conflict, not just RLS's 42501", async () => {
      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "cancelled",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 999999, // a smuggled change alongside a cancel - exactly KB-103's own trigger test case
        totalPaise: 999999,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: "2026-09-20T10:00:00.000Z",
      });

      const client = makeMockClient({
        bills: () => ({
          data: null,
          error: { code: "P0001", message: "bills: cancelling a finalised bill may only change status" },
        }),
      });

      const result = await pushBills(client, localDb);
      expect(result.anyTransientFailure).toBe(false);

      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("conflict");
    });
  });

  describe("adversarial: retrying an append-only insert that already succeeded server-side", () => {
    it("price_observations: a 23505 duplicate-key retry is treated as success, not wrongly marked conflict", async () => {
      const existingServerId = "server-obs-1";

      await localDb.priceObservations.add({
        localId: "obs-1",
        shopId: "shop-1",
        syncStatus: "pending",
        shopProductId: "sp-1",
        observedPricePaise: 4500,
        occurredAt: "2026-09-20T10:00:00.000Z",
        updatedAt: "2026-09-20T10:00:00.000Z",
        deviceId: "device-1",
      });

      // Simulates: the first push attempt's INSERT actually landed
      // server-side, but its confirmation never reached this device (a
      // dropped response, not a dropped request) - so the row is retried
      // as if it never succeeded. price_observations has no UPDATE
      // policy at all (confirmed against 20260920095526_rls.sql), so a
      // naive .upsert() would hit ON CONFLICT DO UPDATE on the existing
      // row and get rejected by RLS outright - the exact bug being
      // tested against here.
      const client = makeMockClient({
        price_observations: (op) => {
          if (op === "insert") {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          if (op === "select") {
            return { data: { id: existingServerId }, error: null };
          }
          throw new Error(`unexpected op "${op}" for price_observations`);
        },
      });

      const result = await pushPriceObservations(client, localDb);
      expect(result.anyTransientFailure).toBe(false);

      const observation = await localDb.priceObservations.get("obs-1");
      expect(observation?.syncStatus).toBe("synced"); // NOT "conflict"
      expect(observation?.serverId).toBe(existingServerId);
    });

    it("learning_events: same retry-after-success scenario, against the other append-only table", async () => {
      const existingServerId = "server-event-1";

      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "synced",
        serverId: "server-bill-1",
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: "2026-09-20T10:00:00.000Z",
      });

      await localDb.learningEvents.add({
        localId: "event-1",
        shopId: "shop-1",
        syncStatus: "pending",
        billLocalId: "bill-1",
        eventType: "bill_finalized",
        payload: {},
        createdAt: "2026-09-20T10:00:01.000Z",
        updatedAt: "2026-09-20T10:00:01.000Z",
        deviceId: "device-1",
      });

      const client = makeMockClient({
        learning_events: (op) => {
          if (op === "insert") {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          if (op === "select") {
            return { data: { id: existingServerId }, error: null };
          }
          throw new Error(`unexpected op "${op}" for learning_events`);
        },
      });

      const result = await pushLearningEvents(client, localDb);
      expect(result.anyTransientFailure).toBe(false);

      const event = await localDb.learningEvents.get("event-1");
      expect(event?.syncStatus).toBe("synced"); // NOT "conflict"
      expect(event?.serverId).toBe(existingServerId);
    });
  });

  describe("adversarial: pull racing a concurrent local edit (shops, last-write-wins)", () => {
    it("a pull does NOT clobber a local row that is still pending an unpushed edit", async () => {
      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "pending", // a local edit not yet pushed
        name: "Local Edited Name",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: null,
        updatedAt: "2026-09-20T12:00:00.000Z",
      });

      const client = makeMockClient({
        shops: () => ({
          data: {
            id: "shop-1",
            name: "Remote Name",
            phone: null,
            address: null,
            logo_url: null,
            catalog_mode: "custom_only",
            bill_language: "hi",
            receipt_prefix: null,
            updated_at: "2026-09-20T13:00:00.000Z", // newer than local, but local is still pending
          },
          error: null,
        }),
      });

      await pullShop(client, localDb, "shop-1");

      const shop = await localDb.shops.get("shop-1");
      expect(shop?.name).toBe("Local Edited Name"); // untouched
      expect(shop?.syncStatus).toBe("pending");
    });

    it("a pull DOES overwrite an already-synced local row when remote is newer, and logs the discard", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced", // no unpushed edit - this is genuinely stale
        name: "Stale Local Name",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: null,
        updatedAt: "2026-09-20T11:00:00.000Z",
      });

      const client = makeMockClient({
        shops: () => ({
          data: {
            id: "shop-1",
            name: "Remote Name",
            phone: null,
            address: null,
            logo_url: null,
            catalog_mode: "custom_only",
            bill_language: "hi",
            receipt_prefix: null,
            updated_at: "2026-09-20T13:00:00.000Z",
          },
          error: null,
        }),
      });

      await pullShop(client, localDb, "shop-1");

      const shop = await localDb.shops.get("shop-1");
      expect(shop?.name).toBe("Remote Name");
      expect(shop?.syncStatus).toBe("synced");

      // Discard is logged with enough detail to reconstruct what happened -
      // not silently untraceable, even though the doc's discard-the-loser
      // rule itself is implemented exactly as specified, unsoftened.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("last-write-wins"),
        expect.objectContaining({
          discardedLocal: expect.objectContaining({ name: "Stale Local Name" }),
          wonRemote: expect.objectContaining({ name: "Remote Name" }),
        }),
      );

      warnSpy.mockRestore();
    });

    it("a pull is a no-op when the local synced row is already at least as new as remote", async () => {
      await localDb.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Current Name",
        phone: null,
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: null,
        updatedAt: "2026-09-20T13:00:00.000Z",
      });

      const client = makeMockClient({
        shops: () => ({
          data: {
            id: "shop-1",
            name: "Older Remote Name",
            phone: null,
            address: null,
            logo_url: null,
            catalog_mode: "custom_only",
            bill_language: "hi",
            receipt_prefix: null,
            updated_at: "2026-09-20T12:00:00.000Z", // older than local
          },
          error: null,
        }),
      });

      await pullShop(client, localDb, "shop-1");

      const shop = await localDb.shops.get("shop-1");
      expect(shop?.name).toBe("Current Name"); // unchanged
    });
  });

  describe("syncNow orchestration", () => {
    it("runs bills before learningEvents, then the independent push-first tables, then pulls - and reports aggregate transient failure", async () => {
      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });

      const client = makeMockClient({
        bills: () => ({ data: { id: "server-bill-1" }, error: null }),
        bill_items: () => ({ data: [], error: null }),
        learned_aliases: () => ({ data: [], error: null }),
        provisional_products: () => ({ data: [], error: null }),
        price_observations: () => ({ data: [], error: null }),
        receipt_number_blocks: () => ({ data: [], error: null }),
        shops: () => ({ data: null, error: { message: "not found" } }),
        shop_products: () => ({ data: [], error: null }),
        base_products: () => ({ data: [], error: null }),
      });

      const result = await syncNow({ client, localDb, shopId: "shop-1" });
      expect(result.anyTransientFailure).toBe(false);

      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("synced");
    });
  });
});
