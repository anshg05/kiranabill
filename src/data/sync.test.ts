import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, type LocalBill } from "./db";
import { getSyncStatus, isSyncFailing, resetSyncStatus } from "./syncStatus";
import { isLearningPullDone, pullLearningState } from "./pullLearning";
import {
  syncNow,
  pushBills,
  pushLearnedAliases,
  pullShopProducts,
  pullBills,
  pullReceiptNumberBlocks,
  startSyncLoop,
  stopSyncLoop,
  isSyncLoopRunning,
  type OnlineEventSource,
  pushLearningEvents,
  pushPriceObservations,
  pullShop,
  pushShop,
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
type HandlerResult = { data: unknown; error: unknown };
type Handler = (op: string, payload: unknown, filters: Record<string, unknown>) => HandlerResult | Promise<HandlerResult>;

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

  // KB-110b: bills are pushed through client.rpc("push_bill", ...). A handler
  // keyed "rpc:<name>" receives ("rpc", args, {}).
  const rpc = (name: string, args: unknown) => {
    const handler = handlers[`rpc:${name}`];
    if (!handler) throw new Error(`no handler for rpc "${name}"`);
    return Promise.resolve(handler("rpc", args, {}));
  };

  // KB-315: syncNow() refuses to run without a live session. A mock client
  // has one unless the test passes handlers["auth:session"] returning null.
  const auth = {
    getSession: async () => {
      const override = handlers["auth:session"];
      const session = override ? (await override("session", null, {})).data : { user: { id: "user-1" } };
      return { data: { session }, error: null };
    },
  };

  return { from, rpc, auth } as unknown as SupabaseClient;
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
        receiptNumberSource: "block",
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
        "rpc:push_bill": () => ({ data: serverBillId, error: null }),
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
        receiptNumberSource: "block",
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
        receiptNumberSource: "block",
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
        "rpc:push_bill": () => ({
          data: null,
          error: { code: "42501", message: "new row violates row-level security policy" },
        }),
      });

      const result = await pushBills(client, localDb);
      expect(result.anyTransientFailure).toBe(false);

      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("conflict");
    });

    // KB-306 (owner): customers' names and numbers are personal data (DPDP Act 2023) -
    // a failed push logs only which bill and why, never the bill itself.
    it("KB-306: a permanent bill failure logs only the localId and the error code - no name, no mobile, no bill", async () => {
      await localDb.bills.add({
        localId: "bill-pii",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        receiptNumberSource: "block",
        customerName: "Ramesh Kumar",
        customerMobile: "9876543210",
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });
      const client = makeMockClient({
        "rpc:push_bill": () => ({
          data: null,
          error: { code: "23514", message: 'new row for relation "bills" violates check constraint "bills_customer_mobile_check"', details: "Failing row contains (Ramesh Kumar, 9876543210)" },
        }),
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await pushBills(client, localDb);
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain("bill-pii");
        expect(logged).toContain("23514");
        expect(logged).not.toContain("Ramesh");
        expect(logged).not.toContain("9876543210");
        expect(logged).not.toContain("Failing row");
      } finally {
        warn.mockRestore();
      }
      expect((await localDb.bills.get("bill-pii"))?.syncStatus).toBe("conflict");
    });

    it("a transient error (no Postgres error code - a network-layer failure) leaves the row pending for retry", async () => {
      await localDb.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        receiptNumberSource: "block",
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
        "rpc:push_bill": () => ({
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
        receiptNumberSource: "block",
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
        "rpc:push_bill": () => ({
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
        receiptNumberSource: "block",
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

  describe("KB-312 / KI-37: a learning event with no bill (learning_reset) is pushed with bill_id null", () => {
    it("pushes it, marks it synced, and a bill-linked event still waits for its bill's serverId", async () => {
      const now = "2026-10-08T10:00:00.000Z";
      await localDb.learningEvents.bulkAdd([
        { localId: "reset-1", shopId: "shop-1", syncStatus: "pending", billLocalId: "", eventType: "learning_reset", payload: { clearedCounts: { learnedAliases: 2 } }, createdAt: now, updatedAt: now, deviceId: "d1" },
        { localId: "ev-unsynced-bill", shopId: "shop-1", syncStatus: "pending", billLocalId: "bill-not-synced", eventType: "bill_finalized", payload: {}, createdAt: now, updatedAt: now, deviceId: "d1" },
      ]);
      const inserted: Array<Record<string, unknown>> = [];
      const client = makeMockClient({
        learning_events: (op, payload) => {
          if (op === "insert") inserted.push(payload as Record<string, unknown>);
          return { data: { id: "server-reset-1" }, error: null };
        },
      });
      const result = await pushLearningEvents(client, localDb);
      expect(result.anyTransientFailure).toBe(false);
      expect(inserted).toHaveLength(1); // the bill-linked one is NOT pushed
      expect(inserted[0]).toMatchObject({ shop_id: "shop-1", local_id: "reset-1", bill_id: null, event_type: "learning_reset", payload: { clearedCounts: { learnedAliases: 2 } } });
      expect((await localDb.learningEvents.get("reset-1"))).toMatchObject({ syncStatus: "synced", serverId: "server-reset-1" });
      expect((await localDb.learningEvents.get("ev-unsynced-bill"))?.syncStatus).toBe("pending");
    });
  });

  describe("adversarial: pull racing a concurrent local edit (shops - the server's updated_at is the only clock, D64)", () => {
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

    // KB-312 / D64: the SERVER's updated_at is the only clock. A synced local row carries the server's own
    // string (stored verbatim, microseconds and all); a pull takes the server row whenever the strings differ,
    // whichever device clock is "later" - never a comparison against a device clock.
    const localShop = (over: Partial<import("./db").LocalShop> = {}): import("./db").LocalShop => ({
      id: "shop-1", syncStatus: "synced", name: "Local Name", phone: null, address: null, logoUrl: null,
      catalogMode: "custom_only", billLanguage: "en", receiptPrefix: null, updatedAt: "2026-09-20T13:00:00.123456+00:00", ...over,
    });
    const remoteShop = (over: Record<string, unknown> = {}) => ({
      id: "shop-1", name: "Remote Name", phone: null, address: null, logo_url: null, catalog_mode: "custom_only",
      bill_language: "en", receipt_prefix: null, updated_at: "2026-09-20T13:00:00.123456+00:00", ...over,
    });

    it("a synced local row is replaced when the server's updated_at differs - even when the DEVICE clock says local is newer", async () => {
      // A device whose clock is 5 minutes ahead: its row says 13:05, the server says 13:01 (another phone's later edit).
      await localDb.shops.add(localShop({ updatedAt: "2026-09-20T13:05:00.000Z" }));
      const client = makeMockClient({ shops: () => ({ data: remoteShop({ updated_at: "2026-09-20T13:01:00.000000+00:00" }), error: null }) });
      await pullShop(client, localDb, "shop-1");
      const shop = await localDb.shops.get("shop-1");
      expect(shop?.name).toBe("Remote Name");
      expect(shop?.syncStatus).toBe("synced");
      expect(shop?.updatedAt).toBe("2026-09-20T13:01:00.000000+00:00"); // stored exactly as returned
    });

    it("an identical updated_at (microseconds included) is a no-op - strings compared verbatim, never through Date", async () => {
      await localDb.shops.add(localShop({ name: "Current Name", updatedAt: "2026-09-20T13:00:00.123456+00:00" }));
      const client = makeMockClient({ shops: () => ({ data: remoteShop({ name: "Same Version", updated_at: "2026-09-20T13:00:00.123456+00:00" }), error: null }) });
      await pullShop(client, localDb, "shop-1");
      expect((await localDb.shops.get("shop-1"))?.name).toBe("Current Name"); // not re-taken
    });

    it("a server version one MICROSECOND later is taken (a Date round-trip would call them equal)", async () => {
      await localDb.shops.add(localShop({ name: "Current Name", updatedAt: "2026-09-20T13:00:00.123456+00:00" }));
      const client = makeMockClient({ shops: () => ({ data: remoteShop({ name: "One Microsecond Later", updated_at: "2026-09-20T13:00:00.123457+00:00" }), error: null }) });
      await pullShop(client, localDb, "shop-1");
      const shop = await localDb.shops.get("shop-1");
      expect(shop?.name).toBe("One Microsecond Later");
      expect(shop?.updatedAt).toBe("2026-09-20T13:00:00.123457+00:00");
    });
  });

  describe("pushShop (KB-312, D64): the server's updated_at comes back and is stored; an edit made while the push is in flight survives", () => {
    const row = (over: Partial<import("./db").LocalShop> = {}): import("./db").LocalShop => ({
      id: "shop-1", syncStatus: "pending", name: "Edited Name", phone: "9876543210", address: null, logoUrl: null,
      catalogMode: "custom_only", billLanguage: "hi", receiptPrefix: null, updatedAt: "2026-09-20T12:00:00.000Z", ...over,
    });

    it("sends the fields without updated_at, then stores the server's updated_at exactly as returned and marks the row synced", async () => {
      await localDb.shops.add(row());
      let sent: Record<string, unknown> | null = null;
      const client = makeMockClient({
        shops: (_op, payload) => {
          sent = payload as Record<string, unknown>;
          return { data: [{ id: "shop-1", updated_at: "2026-09-20T12:00:03.654321+00:00" }], error: null };
        },
      });
      const result = await pushShop(client, localDb);
      expect(result.anyTransientFailure).toBe(false);
      expect(sent).toMatchObject({ name: "Edited Name", phone: "9876543210", bill_language: "hi" });
      expect(sent).not.toHaveProperty("updated_at"); // the server stamps it (trigger)
      const shop = await localDb.shops.get("shop-1");
      expect(shop).toMatchObject({ syncStatus: "synced", updatedAt: "2026-09-20T12:00:03.654321+00:00" });
    });

    it("an edit made while the push is in flight is NOT clobbered: the row stays pending with the new edit, and the next cycle pushes it", async () => {
      await localDb.shops.add(row());
      const pushed: string[] = [];
      let calls = 0;
      const client = makeMockClient({
        shops: async (_op, payload) => {
          calls += 1;
          pushed.push((payload as { name: string }).name);
          if (calls === 1) {
            // the shopkeeper saves again while the first request is still out
            await localDb.shops.update("shop-1", { name: "Edited Again", updatedAt: "2026-09-20T12:00:01.000Z", syncStatus: "pending" });
          }
          return { data: [{ id: "shop-1", updated_at: `2026-09-20T12:00:0${calls + 2}.000000+00:00` }], error: null };
        },
      });

      await pushShop(client, localDb);
      let shop = await localDb.shops.get("shop-1");
      expect(shop).toMatchObject({ name: "Edited Again", syncStatus: "pending", updatedAt: "2026-09-20T12:00:01.000Z" }); // survived

      await pushShop(client, localDb); // the next cycle
      shop = await localDb.shops.get("shop-1");
      expect(pushed).toEqual(["Edited Name", "Edited Again"]);
      expect(shop).toMatchObject({ name: "Edited Again", syncStatus: "synced", updatedAt: "2026-09-20T12:00:04.000000+00:00" });
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
        receiptNumberSource: "block",
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
        "rpc:push_bill": () => ({ data: "server-bill-1", error: null }),
        learned_aliases: () => ({ data: [], error: null }),
        provisional_products: () => ({ data: [], error: null }),
        price_observations: () => ({ data: [], error: null }),
        receipt_number_blocks: () => ({ data: [], error: null }),
        shops: () => ({ data: null, error: { message: "not found" } }),
        shop_products: () => ({ data: [], error: null }),
        base_products: () => ({ data: [], error: null }),
      });

      const result = await syncNow({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
      expect(result.anyTransientFailure).toBe(false);

      const bill = await localDb.bills.get("bill-1");
      expect(bill?.syncStatus).toBe("synced");
    });
  });
});

// ---------------------------------------------------------------------------
// KB-110b (docs/07-DECISIONS.md D37, docs/12-PARKED.md KI-29/KI-31): bills
// push through push_bill() in one call; drafts stay local; an explicit error
// classification shared by every push function; one sync run at a time.
// These prove the client's orchestration only - scripts/rls-negative-tests.ts
// and src/data/sync.e2e.test.ts prove the real schema interaction (D21).
// ---------------------------------------------------------------------------
describe("sync.ts - KB-110b push_bill path", () => {
  let localDb: KiranaBillDB;

  beforeEach(() => {
    localDb = new KiranaBillDB(`test-sync-110b-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await localDb.delete();
  });

  const billLocalId = "6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a11";

  async function addBill(overrides: Partial<LocalBill> = {}) {
    await localDb.bills.add({
      localId: billLocalId,
      shopId: "shop-1",
      status: "final",
      syncStatus: "pending",
      receiptNumber: "KB-000007",
      receiptNumberSource: "block",
      customerName: "Cash",
      customerMobile: null,
      subtotalPaise: 5250,
      totalPaise: 5250,
      schemaVersion: 1,
      deviceId: "device-1",
      createdAt: "2026-09-27T10:00:00.000Z",
      finalizedAt: "2026-09-27T10:00:05.000Z",
      syncedAt: null,
      ...overrides,
    });
  }

  it("sends the bill and ALL its items in one push_bill call - rate_unit, receipt_number_source included - and stores the returned server id", async () => {
    await addBill({ receiptNumberSource: "fallback" });
    await localDb.billItems.bulkAdd([
      { billLocalId, shopId: "shop-1", lineNo: 2, shopProductId: null, displayName: "Chawal", spokenName: "chawal", qty: 5, unit: "kg", ratePaise: null, rateUnit: null, totalPaise: 3000, priceType: "total", source: "fastpath", reviewFlags: [], wasEdited: false },
      { billLocalId, shopId: "shop-1", lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 500, unit: "gm", ratePaise: 4500, rateUnit: "kg", totalPaise: 2250, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false },
    ]);

    const calls: unknown[] = [];
    const client = makeMockClient({
      "rpc:push_bill": (_op, args) => {
        calls.push(args);
        return { data: "server-bill-uuid", error: null };
      },
    });

    const result = await pushBills(client, localDb);
    expect(result.anyTransientFailure).toBe(false);
    expect(calls).toHaveLength(1);
    const args = calls[0] as { p_bill: Record<string, unknown>; p_items: Array<Record<string, unknown>> };
    expect(args.p_bill).toMatchObject({ local_id: billLocalId, status: "final", receipt_number_source: "fallback", total_paise: 5250 });
    expect(args.p_items.map((i) => i.line_no)).toEqual([1, 2]); // line order, not insertion order
    expect(args.p_items[0]).toMatchObject({ qty: 500, unit: "gm", rate_paise: 4500, rate_unit: "kg", total_paise: 2250 });
    expect(args.p_items[1]).toMatchObject({ rate_paise: null, rate_unit: null });

    const bill = await localDb.bills.get(billLocalId);
    expect(bill?.syncStatus).toBe("synced");
    expect(bill?.serverId).toBe("server-bill-uuid");
  });

  it("drafts are never pushed - they stay on the device, still pending (D37)", async () => {
    await addBill({ status: "draft" });
    const client = makeMockClient({
      "rpc:push_bill": () => {
        throw new Error("push_bill must not be called for a draft");
      },
    });
    const result = await pushBills(client, localDb);
    expect(result.anyTransientFailure).toBe(false);
    expect((await localDb.bills.get(billLocalId))?.syncStatus).toBe("pending");
  });

  // Every row of D37's classification table, through the real pushBills().
  // KB422 (KB-307, KI-41): a final/cancelled bill with no items or totals that do not add up.
  const PERMANENT = ["42501", "P0001", "23505", "23503", "23502", "23514", "22P02", "KB400", "KB409", "KB422"];
  const TRANSIENT = ["40P01", "40001", "57014", "08006", "53300", "55P03", "PGRST202", "XX999"];

  for (const code of PERMANENT) {
    it(`classification: ${code} is PERMANENT - the bill is marked conflict, not retried`, async () => {
      await addBill();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = makeMockClient({ "rpc:push_bill": () => ({ data: null, error: { code, message: `simulated ${code}` } }) });
      const result = await pushBills(client, localDb);
      expect(result.anyTransientFailure).toBe(false);
      expect((await localDb.bills.get(billLocalId))?.syncStatus).toBe("conflict");
      warn.mockRestore();
    });
  }

  for (const code of TRANSIENT) {
    it(`classification: ${code} is TRANSIENT - the bill stays pending and the cycle backs off`, async () => {
      await addBill();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = makeMockClient({ "rpc:push_bill": () => ({ data: null, error: { code, message: `simulated ${code}` } }) });
      const result = await pushBills(client, localDb);
      expect(result.anyTransientFailure).toBe(true);
      expect((await localDb.bills.get(billLocalId))?.syncStatus).toBe("pending");
      // Only a code outside both lists is logged as unclassified.
      const loggedUnclassified = warn.mock.calls.some((c) => String(c[0]).includes("unclassified error code"));
      expect(loggedUnclassified).toBe(code === "XX999");
      warn.mockRestore();
    });
  }

  it("classification: no code at all (a network failure) is TRANSIENT", async () => {
    await addBill();
    const client = makeMockClient({ "rpc:push_bill": () => ({ data: null, error: { message: "fetch failed" } }) });
    const result = await pushBills(client, localDb);
    expect(result.anyTransientFailure).toBe(true);
    expect((await localDb.bills.get(billLocalId))?.syncStatus).toBe("pending");
  });

  it("the classification is shared: a deadlock (40P01) on learned_aliases is transient too, 42501 still permanent", async () => {
    const alias = (localId: string) => ({
      localId,
      shopId: "shop-1",
      syncStatus: "pending" as const,
      alias: "chinni",
      shopProductId: "sp-1",
      hitCount: 1,
      confidence: 0.5,
      source: "correction" as const,
      updatedAt: "2026-09-27T10:00:00.000Z",
      deviceId: "device-1",
    });
    await localDb.learnedAliases.bulkAdd([alias("alias-deadlock"), alias("alias-rls")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeMockClient({
      learned_aliases: (_op, payload) => {
        const code = (payload as { local_id: string }).local_id === "alias-deadlock" ? "40P01" : "42501";
        return { data: null, error: { code, message: `simulated ${code}` } };
      },
    });
    const result = await pushLearnedAliases(client, localDb);
    warn.mockRestore();
    expect(result.anyTransientFailure).toBe(true);
    expect((await localDb.learnedAliases.get("alias-deadlock"))?.syncStatus).toBe("pending");
    expect((await localDb.learnedAliases.get("alias-rls"))?.syncStatus).toBe("conflict");
  });

  it("re-entrancy: two overlapping syncNow() calls run ONE cycle - push_bill is called once, both callers share the result", async () => {
    await addBill();
    let pushCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = makeMockClient({
      "rpc:push_bill": (() => {
        pushCalls += 1;
        return gate.then(() => ({ data: "server-bill-uuid", error: null }));
      }) as unknown as Handler,
      learned_aliases: () => ({ data: [], error: null }),
      provisional_products: () => ({ data: [], error: null }),
      price_observations: () => ({ data: [], error: null }),
      receipt_number_blocks: () => ({ data: [], error: null }),
      shops: () => ({ data: null, error: { message: "not found" } }),
      shop_products: () => ({ data: [], error: null }),
      base_products: () => ({ data: [], error: null }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = syncNow({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
    const second = syncNow({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    warn.mockRestore();
    expect(pushCalls).toBe(1);
    expect((await localDb.bills.get(billLocalId))?.syncStatus).toBe("synced");
  });
});

// ---------------------------------------------------------------------------
// KB-315 (docs/07-DECISIONS.md D38): never sync without a live session; the
// loop's lifecycle; per-shop cursor; this device's blocks only.
// ---------------------------------------------------------------------------
describe("sync.ts - KB-315", () => {
  let localDb: KiranaBillDB;

  beforeEach(() => {
    localDb = new KiranaBillDB(`test-sync-315-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    stopSyncLoop();
    await localDb.delete();
  });

  const everyTableEmpty: Record<string, Handler> = {
    "rpc:push_bill": () => ({ data: "server-bill-uuid", error: null }),
    learned_aliases: () => ({ data: [], error: null }),
    provisional_products: () => ({ data: [], error: null }),
    price_observations: () => ({ data: [], error: null }),
    receipt_number_blocks: () => ({ data: [], error: null }),
    shops: () => ({ data: null, error: { message: "not found" } }),
    shop_products: () => ({ data: [], error: null }),
    base_products: () => ({ data: [], error: null }),
  };

  it("NO live session -> the whole cycle is skipped: nothing is pushed, the bill stays pending (never a conflict), reported transient", async () => {
    await localDb.bills.add({
      localId: "6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12", shopId: "shop-1", status: "final", syncStatus: "pending",
      receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Cash", customerMobile: null,
      subtotalPaise: 100, totalPaise: 100, schemaVersion: 1, deviceId: "device-1",
      createdAt: "2026-09-27T10:00:00.000Z", finalizedAt: "2026-09-27T10:00:00.000Z", syncedAt: null,
    });
    const client = makeMockClient({
      "auth:session": () => ({ data: null, error: null }),
      "rpc:push_bill": () => {
        throw new Error("push_bill must not be called without a live session");
      },
    });
    const result = await syncNow({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
    expect(result).toEqual({ anyTransientFailure: true, skippedNoSession: true });
    expect((await localDb.bills.get("6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12"))?.syncStatus).toBe("pending");
  });

  it("loop lifecycle: start is idempotent (one 'online' listener), stop removes the listener and marks it stopped", async () => {
    const listeners = new Set<() => void>();
    const source: OnlineEventSource = {
      addEventListener: (_t, l) => listeners.add(l),
      removeEventListener: (_t, l) => listeners.delete(l),
    };
    const client = makeMockClient(everyTableEmpty);
    const options = { client, localDb, shopId: "shop-1", deviceId: "device-1" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    startSyncLoop(options, source);
    startSyncLoop(options, source);
    expect(isSyncLoopRunning()).toBe(true);
    expect(listeners.size).toBe(1);

    stopSyncLoop();
    expect(isSyncLoopRunning()).toBe(false);
    expect(listeners.size).toBe(0);
    warn.mockRestore();
  });

  // -------------------------------------------------------------------------
  // KB-313 / NI-38: while the browser is offline the loop sends nothing and schedules no timer; the 'online'
  // event runs a cycle at once and resumes the cadence (one timer, however many events). The loop's own
  // timer is told apart from anything else by its length (>= 10 s), and recorded instead of really waiting.
  // -------------------------------------------------------------------------
  describe("KB-313 / NI-38 - the loop waits while offline", () => {
    interface Recorded { fn: () => void; ms: number; cleared: boolean }
    let recorded: Recorded[];
    let online: boolean;
    let requests: number;
    let listeners: Set<() => void>;
    const source = (): OnlineEventSource => ({
      addEventListener: (_t, l) => listeners.add(l),
      removeEventListener: (_t, l) => listeners.delete(l),
    });
    const liveTimers = () => recorded.filter((r) => !r.cleared);

    beforeEach(() => {
      recorded = [];
      listeners = new Set();
      requests = 0;
      online = true;
      resetSyncStatus();
      vi.stubGlobal("navigator", { get onLine() { return online; } });
      const realSet = globalThis.setTimeout;
      const realClear = globalThis.clearTimeout;
      vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
        if (typeof ms === "number" && ms >= 10_000) {
          const r: Recorded = { fn, ms, cleared: false };
          recorded.push(r);
          return r as unknown as ReturnType<typeof setTimeout>;
        }
        return realSet(fn, ms, ...rest);
      }) as typeof setTimeout);
      vi.spyOn(globalThis, "clearTimeout").mockImplementation(((handle: unknown) => {
        const r = recorded.find((x) => x === handle);
        if (r) r.cleared = true;
        else realClear(handle as never);
      }) as typeof clearTimeout);
    });
    afterEach(() => {
      stopSyncLoop();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const countingClient = (extra: Record<string, Handler> = {}) =>
      makeMockClient({
        ...everyTableEmpty,
        shop_products: () => {
          requests += 1;
          return { data: [], error: null };
        },
        ...extra,
      });
    const options = (client: SupabaseClient) => ({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
    const settle = (n: number) => vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(n));
    const pause = () => new Promise((r) => setTimeout(r, 60));

    it("offline at start: no request at all and no timer - the loop is still 'running', waiting for 'online'", async () => {
      online = false;
      startSyncLoop(options(countingClient()), source());
      await pause();
      expect(requests).toBe(0);
      expect(liveTimers()).toHaveLength(0);
      expect(isSyncLoopRunning()).toBe(true);
      expect(listeners.size).toBe(1);
    });

    it("online it polls every 15 s; when the timer fires after the browser went offline, it sends nothing and does not reschedule", async () => {
      startSyncLoop(options(countingClient()), source());
      await settle(1);
      await vi.waitFor(() => expect(liveTimers()).toHaveLength(1));
      expect(liveTimers()[0]!.ms).toBe(15_000);

      online = false;
      const tick = liveTimers()[0]!;
      tick.cleared = true;
      tick.fn();
      await pause();
      expect(requests).toBe(1); // nothing new
      expect(liveTimers()).toHaveLength(0);
    });

    it("'online' after that: a cycle runs at once and the 15 s cadence resumes", async () => {
      startSyncLoop(options(countingClient()), source());
      await settle(1);
      await vi.waitFor(() => expect(liveTimers()).toHaveLength(1));
      online = false;
      const tick = liveTimers()[0]!;
      tick.cleared = true;
      tick.fn();
      await pause();

      online = true;
      [...listeners].forEach((l) => l());
      await settle(2);
      await vi.waitFor(() => expect(liveTimers()).toHaveLength(1));
      expect(liveTimers()[0]!.ms).toBe(15_000);
    });

    it("many 'online' events never stack timers: one live timer", async () => {
      startSyncLoop(options(countingClient()), source());
      await settle(1);
      online = true;
      [...listeners].forEach((l) => l());
      [...listeners].forEach((l) => l());
      [...listeners].forEach((l) => l());
      await pause();
      await vi.waitFor(() => expect(liveTimers()).toHaveLength(1));
    });

    it("syncNow while the browser is offline (e.g. right after Bill Banao) sends nothing and is not counted as a failure", async () => {
      await localDb.bills.add({
        localId: "6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12", shopId: "shop-1", status: "final", syncStatus: "pending",
        receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Cash", customerMobile: null,
        subtotalPaise: 100, totalPaise: 100, schemaVersion: 1, deviceId: "device-1",
        createdAt: "2026-10-08T10:00:00.000Z", finalizedAt: "2026-10-08T10:00:00.000Z", syncedAt: null,
      });
      online = false;
      const client = countingClient({ "rpc:push_bill": () => { throw new Error("push_bill must not be called while offline"); } });
      const result = await syncNow(options(client));
      expect(result).toEqual({ anyTransientFailure: false, skippedOffline: true });
      expect(requests).toBe(0);
      expect(getSyncStatus()).toMatchObject({ consecutiveFailures: 0, syncing: false });
      expect((await localDb.bills.get("6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12"))?.syncStatus).toBe("pending");
    });

    it("cycles feed the chip's status: three failed cycles in a row -> failing; a cycle with no live session -> noSession", async () => {
      await localDb.bills.add({
        localId: "6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12", shopId: "shop-1", status: "final", syncStatus: "pending",
        receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Cash", customerMobile: null,
        subtotalPaise: 100, totalPaise: 100, schemaVersion: 1, deviceId: "device-1",
        createdAt: "2026-10-08T10:00:00.000Z", finalizedAt: "2026-10-08T10:00:00.000Z", syncedAt: null,
      });
      const failing = countingClient({ "rpc:push_bill": () => ({ data: null, error: { message: "fetch failed" } }) });
      for (let i = 0; i < 3; i++) await syncNow(options(failing));
      expect(isSyncFailing(getSyncStatus())).toBe(true);

      await syncNow(options(countingClient({ "auth:session": () => ({ data: null, error: null }) })));
      expect(getSyncStatus().noSession).toBe(true);
      expect(getSyncStatus().consecutiveFailures).toBe(3); // a no-session skip is not a failure

      await localDb.bills.update("6f1c2b0e-4a57-4c1e-9d8a-2b7f0d3e5a12", { syncStatus: "synced" });
      await syncNow(options(countingClient()));
      expect(getSyncStatus()).toMatchObject({ consecutiveFailures: 0, noSession: false, syncing: false });
    });
  });

  // -------------------------------------------------------------------------
  // KB-326 (D66): a learning_reset that the server doesn't know yet must never be undone - not by a pull (rule A),
  // and not by pushing learning rows stamped before the reset event (rule B).
  // -------------------------------------------------------------------------
  describe("KB-326 - learning_reset ordering", () => {
    const at = "2026-10-09T10:00:00.000Z";
    const resetEvent = (syncStatus: "pending" | "synced" | "conflict") => ({
      localId: "reset-1", shopId: "shop-1", syncStatus, billLocalId: "", eventType: "learning_reset", payload: { clearedCounts: {} }, createdAt: at, updatedAt: at, deviceId: "device-1",
    });
    const pendingAlias = {
      localId: "alias-1", shopId: "shop-1", syncStatus: "pending" as const, alias: "chini", shopProductId: "p1", hitCount: 1, confidence: 0.5, source: "confirmation" as const, updatedAt: at, deviceId: "device-1",
    };
    const pushedTables = (calls: string[]) => ({
      ...everyTableEmpty,
      learned_aliases: () => { calls.push("learned_aliases"); return { data: { id: "srv-alias" }, error: null }; },
      price_observations: () => { calls.push("price_observations"); return { data: { id: "srv-obs" }, error: null }; },
      provisional_products: () => { calls.push("provisional_products"); return { data: { id: "srv-prov" }, error: null }; },
    });

    it("rule B: the reset event could not be pushed -> this cycle pushes NO learning rows (the server must never hold a post-reset row stamped before the reset)", async () => {
      await localDb.learningEvents.add(resetEvent("pending"));
      await localDb.learnedAliases.add(pendingAlias);
      const calls: string[] = [];
      const client = makeMockClient({ ...pushedTables(calls), learning_events: () => ({ data: null, error: { message: "fetch failed" } }) });
      const result = await syncNow({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
      expect(result.anyTransientFailure).toBe(true);
      expect(calls).toEqual([]);
      expect((await localDb.learnedAliases.get("alias-1"))?.syncStatus).toBe("pending"); // waits for the next cycle
    });

    it("rule B: the event pushed fine -> the learning rows go up in the same cycle (the event first)", async () => {
      await localDb.learningEvents.add(resetEvent("pending"));
      await localDb.learnedAliases.add(pendingAlias);
      const calls: string[] = [];
      const client = makeMockClient({ ...pushedTables(calls), learning_events: () => ({ data: { id: "srv-reset" }, error: null }) });
      await syncNow({ client, localDb, shopId: "shop-1", deviceId: "device-1" });
      expect(calls).toContain("learned_aliases");
      expect((await localDb.learnedAliases.get("alias-1"))?.syncStatus).toBe("synced");
    });

    it("rule A: a reset that has not reached the server (pending, or stuck in conflict) -> the learning pull sends no request at all", async () => {
      for (const status of ["pending", "conflict"] as const) {
        await localDb.learningEvents.put(resetEvent(status));
        const client = { from: () => { throw new Error("must not ask the server while a reset is not on it"); } } as unknown as SupabaseClient;
        const result = await pullLearningState(client, localDb, "shop-1");
        expect(result).toEqual({ done: false, skipped: "reset-not-pushed" });
      }
      expect(await isLearningPullDone(localDb, "shop-1")).toBe(false);
    });
  });

  it("the shop_products pull cursor is kept PER SHOP", async () => {
    const seenFilters: Array<Record<string, unknown>> = [];
    const client = makeMockClient({
      shop_products: (_op, _payload, filters) => {
        seenFilters.push({ ...filters });
        return { data: [{ id: `p-${filters.shop_id}`, shop_id: filters.shop_id, updated_at: "2026-09-27T10:00:00.000Z", aliases: [] }], error: null };
      },
    });
    await pullShopProducts(client, localDb, "shop-1");
    await pullShopProducts(client, localDb, "shop-2");
    expect(seenFilters[1]).toEqual({ shop_id: "shop-2" }); // no cursor inherited from shop-1
    expect((await localDb.syncState.get("shopProducts:shop-1"))?.lastSyncedAt).toBe("2026-09-27T10:00:00.000Z");
    expect(await localDb.syncState.get("shopProducts:shop-2")).toBeDefined();
    expect(await localDb.syncState.get("shopProducts")).toBeUndefined();
  });

  it("KB-311: the shop_products pull re-reads the last minute before its cursor (a late commit is never skipped)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const client = makeMockClient({
      shop_products: (_op, _payload, filters) => {
        seen.push({ ...filters });
        return { data: seen.length === 1 ? [{ id: "p-1", shop_id: "shop-1", updated_at: "2026-10-08T10:00:00.000Z", aliases: [] }] : [], error: null };
      },
    });
    await pullShopProducts(client, localDb, "shop-1");
    await pullShopProducts(client, localDb, "shop-1");
    expect(seen[1]).toEqual({ shop_id: "shop-1", updated_at__gt: "2026-10-08T09:59:00.000Z" });
    // The cursor itself never moves backwards.
    expect((await localDb.syncState.get("shopProducts:shop-1"))?.lastSyncedAt).toBe("2026-10-08T10:00:00.000Z");
  });

  it("KB-324: offline, the bills pull waits quietly - no request at all; online it asks for this shop's bills", async () => {
    const asked: string[] = [];
    const client = makeMockClient({
      bills: () => {
        asked.push("bills");
        return { data: [], error: null };
      },
    });
    vi.stubGlobal("navigator", { onLine: false });
    try {
      await pullBills(client, localDb, "shop-1", { awaitBackfill: true });
      expect(asked).toEqual([]);
      expect(await localDb.syncState.get("bills:shop-1")).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("receipt blocks are pulled for THIS device only", async () => {
    let filters: Record<string, unknown> = {};
    const client = makeMockClient({
      receipt_number_blocks: (_op, _payload, f) => {
        filters = { ...f };
        return { data: [], error: null };
      },
    });
    await pullReceiptNumberBlocks(client, localDb, "shop-1", "device-A");
    expect(filters).toEqual({ shop_id: "shop-1", device_id: "device-A" });
  });
});
