import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, type LocalBill, type LocalBillItem } from "./db";
import { createShop } from "./shops";
import { reserveBlock, consumeNextNumber } from "./receiptNumbers";
import { syncNow, pushBills } from "./sync";

/**
 * KB-110b - real local Docker stack, the SHIPPED code path (docs/07-DECISIONS.md
 * D21, D32): a real Supabase Auth user (signUp against the local stack), real
 * RLS, the real push_bill() function, and this project's own createShop /
 * reserveBlock / consumeNextNumber / syncNow - never a hand-built request to
 * the same endpoints. Dexie runs on fake-indexeddb (Node has no IndexedDB).
 *
 * Run: `npm run test:e2e` (the "e2e" Vitest project - not part of `npm test`).
 * Needs `npx supabase start` and every migration applied locally. Refuses to
 * run against anything but 127.0.0.1/localhost. Final bills can't be deleted
 * (the immutability triggers), so each run creates its own throwaway user and
 * shop; `npx supabase db reset` clears them.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

describe("KB-110b sync e2e - real local stack, shipped code path", () => {
  let client: SupabaseClient;
  let shopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-${crypto.randomUUID()}`);

  beforeAll(async () => {
    assertLocal();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({
      email: `e2e-${crypto.randomUUID()}@kb110b.local`,
      password: crypto.randomUUID(),
    });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-110b e2e", phone: null, catalogMode: "custom_only" });
    shopId = shop.id;
    await reserveBlock(client, localDb, shopId, deviceId);
  });

  function billRow(localId: string, receipt: { receiptNumber: string; source: "block" | "fallback" }, totalPaise: number, status: LocalBill["status"] = "final"): LocalBill {
    return {
      localId,
      shopId,
      status,
      syncStatus: "pending",
      receiptNumber: receipt.receiptNumber,
      receiptNumberSource: receipt.source,
      customerName: "Cash",
      customerMobile: null,
      subtotalPaise: totalPaise,
      totalPaise,
      schemaVersion: 1,
      deviceId,
      createdAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
      syncedAt: null,
    };
  }

  function item(billLocalId: string, lineNo: number, fields: Pick<LocalBillItem, "displayName" | "qty" | "unit" | "ratePaise" | "rateUnit" | "totalPaise" | "priceType">): LocalBillItem {
    return { billLocalId, shopId, lineNo, shopProductId: null, spokenName: fields.displayName.toLowerCase(), source: "fastpath", reviewFlags: [], wasEdited: false, ...fields };
  }

  const crossUnitItems = (billLocalId: string) => [
    item(billLocalId, 1, { displayName: "Chini", qty: 500, unit: "gm", ratePaise: 4500, rateUnit: "kg", totalPaise: 2250, priceType: "default" }),
    item(billLocalId, 2, { displayName: "Chawal", qty: 2, unit: "kg", ratePaise: 5000, rateUnit: "kg", totalPaise: 10000, priceType: "default" }),
    item(billLocalId, 3, { displayName: "Namak", qty: 1, unit: "kg", ratePaise: null, rateUnit: null, totalPaise: 2000, priceType: "total" }),
  ];

  async function serverBill(localId: string) {
    const { data, error } = await client
      .from("bills")
      .select("id, status, receipt_number, receipt_number_source, total_paise, subtotal_paise, customer_name, device_id, schema_version, bill_items(line_no, qty, unit, rate_paise, rate_unit, total_paise, shop_id)")
      .eq("shop_id", shopId)
      .eq("local_id", localId);
    if (error) throw error;
    return data;
  }

  async function writeFinalisedBill(localId: string, items: LocalBillItem[], db = localDb, status: LocalBill["status"] = "final") {
    const receipt = await consumeNextNumber(client, db, shopId, deviceId);
    const total = items.reduce((sum, i) => sum + i.totalPaise, 0);
    await db.bills.add(billRow(localId, receipt, total, status));
    await db.billItems.bulkAdd(items);
    return receipt;
  }

  const bill1 = crypto.randomUUID();

  it("1. a finalised bill with cross-unit items lands whole: bill + all 3 items + rate_unit + receipt_number_source; serverId stored", async () => {
    await writeFinalisedBill(bill1, crossUnitItems(bill1));
    // 7. (same cycle) a learning event on this bill, pending before the bill has a serverId
    await localDb.learningEvents.add({
      localId: crypto.randomUUID(), shopId, syncStatus: "pending", billLocalId: bill1, eventType: "bill_finalized",
      payload: { e2e: true }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deviceId,
    });

    const result = await syncNow({ client, localDb, shopId });
    expect(result.anyTransientFailure).toBe(false);

    const rows = await serverBill(bill1);
    expect(rows).toHaveLength(1);
    const server = rows[0]!;
    expect(server.status).toBe("final");
    expect(server.receipt_number_source).toBe("block");
    expect(server.total_paise).toBe(14250);
    const items = [...server.bill_items].sort((a, b) => a.line_no - b.line_no);
    expect(items.map((i) => [i.line_no, Number(i.qty), i.unit, i.rate_paise, i.rate_unit, i.total_paise])).toEqual([
      [1, 500, "gm", 4500, "kg", 2250],
      [2, 2, "kg", 5000, "kg", 10000],
      [3, 1, "kg", null, null, 2000],
    ]);
    expect(items.every((i) => i.shop_id === shopId)).toBe(true);

    const local = await localDb.bills.get(bill1);
    expect(local?.syncStatus).toBe("synced");
    expect(local?.serverId).toBe(server.id);
  });

  it("7. the bill's learning event pushed in the same cycle, with the SERVER bill id (KI-29's stranding is gone)", async () => {
    const serverId = (await localDb.bills.get(bill1))!.serverId!;
    const { data, error } = await client.from("learning_events").select("bill_id, event_type").eq("shop_id", shopId).eq("bill_id", serverId);
    expect(error).toBeNull();
    expect(data).toEqual([{ bill_id: serverId, event_type: "bill_finalized" }]);
    const localEvents = await localDb.learningEvents.where("shopId").equals(shopId).toArray();
    expect(localEvents.every((e) => e.syncStatus === "synced")).toBe(true);
  });

  it("2. a lost-response retry (same content pushed again) is a no-op success - still exactly 1 bill + 3 items, local synced", async () => {
    await localDb.bills.update(bill1, { syncStatus: "pending" });
    const result = await syncNow({ client, localDb, shopId });
    expect(result.anyTransientFailure).toBe(false);
    const rows = await serverBill(bill1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bill_items).toHaveLength(3);
    expect((await localDb.bills.get(bill1))?.syncStatus).toBe("synced");
  });

  it("4. cancel after sync: server status becomes cancelled, every other column identical (bills_immutability's jsonb diff passes)", async () => {
    const before = (await serverBill(bill1))[0]!;
    await localDb.bills.update(bill1, { status: "cancelled", syncStatus: "pending" });
    await syncNow({ client, localDb, shopId });
    const after = (await serverBill(bill1))[0]!;
    expect(after.status).toBe("cancelled");
    expect({ ...after, status: "x" }).toEqual({ ...before, status: "x" });
    expect((await localDb.bills.get(bill1))?.syncStatus).toBe("synced");
  });

  it("5. a bill finalised AND cancelled offline, pushed once, lands cancelled with its items", async () => {
    const bill2 = crypto.randomUUID();
    await writeFinalisedBill(bill2, crossUnitItems(bill2), localDb, "cancelled");
    await syncNow({ client, localDb, shopId });
    const server = (await serverBill(bill2))[0]!;
    expect(server.status).toBe("cancelled");
    expect(server.bill_items).toHaveLength(3);
  });

  it("6. a fallback-numbered bill (a device with no reserved block) lands with receipt_number_source 'fallback'", async () => {
    const secondDevice = new KiranaBillDB(`e2e-dev2-${crypto.randomUUID()}`);
    const bill3 = crypto.randomUUID();
    const receipt = await writeFinalisedBill(bill3, crossUnitItems(bill3), secondDevice);
    expect(receipt.source).toBe("fallback"); // the shipped consumeNextNumber chose the fallback path
    await pushBills(client, secondDevice);
    const server = (await serverBill(bill3))[0]!;
    expect(server.receipt_number_source).toBe("fallback");
    expect(server.receipt_number).toBe(receipt.receiptNumber);
    await secondDevice.delete();
  });

  it("3. a DIVERGENT retry (a local item total changed after sync) is KB409 -> local conflict, server unchanged", async () => {
    const bill4 = crypto.randomUUID();
    await writeFinalisedBill(bill4, crossUnitItems(bill4));
    await syncNow({ client, localDb, shopId });
    const before = (await serverBill(bill4))[0]!;

    const line1 = await localDb.billItems.where("[billLocalId+lineNo]").equals([bill4, 1]).first();
    await localDb.billItems.update(line1!.id!, { totalPaise: 2500 });
    await localDb.bills.update(bill4, { syncStatus: "pending" });
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      const result = await syncNow({ client, localDb, shopId });
      expect(result.anyTransientFailure).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
    expect((await localDb.bills.get(bill4))?.syncStatus).toBe("conflict");
    expect(warnings.some((w) => w.includes("KB409"))).toBe(true);
    expect((await serverBill(bill4))[0]).toEqual(before);
  });

  it("8. concurrency: two overlapping syncNow() calls, AND two overlapping pushBills() bypassing the guard (push_bill's own race path) -> one bill, no conflict", async () => {
    const bill5 = crypto.randomUUID();
    await writeFinalisedBill(bill5, crossUnitItems(bill5));
    await Promise.all([syncNow({ client, localDb, shopId }), syncNow({ client, localDb, shopId })]);
    expect(await serverBill(bill5)).toHaveLength(1);
    expect((await localDb.bills.get(bill5))?.syncStatus).toBe("synced");

    const bill6 = crypto.randomUUID();
    await writeFinalisedBill(bill6, crossUnitItems(bill6));
    const results = await Promise.all([pushBills(client, localDb), pushBills(client, localDb)]);
    expect(results.every((r) => !r.anyTransientFailure)).toBe(true);
    const rows = await serverBill(bill6);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bill_items).toHaveLength(3);
    expect((await localDb.bills.get(bill6))?.syncStatus).toBe("synced");
  });
});
