import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, type LocalBill, type LocalBillItem } from "./db";
import { createShop } from "./shops";
import { consumeNextNumber, reserveBlock } from "./receiptNumbers";
import { pushBills } from "./sync";

/**
 * KB-307 commit 1 (KI-41; owner, 3 Oct 2026): the server never trusts the
 * client's arithmetic. A final or cancelled bill must have at least one item,
 * its items must sum to subtotal_paise, and subtotal = total (no discounts or
 * tax yet). Through the SHIPPED path (D32): Dexie -> pushBills() -> push_bill()
 * -> the bills totals trigger. A rejection is KB422 = permanent ("conflict"),
 * never retried forever. Local stack only; `npm run test:e2e`.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-307 e2e - KI-41: bills must add up (local Postgres, shipped push path)", () => {
  let client: SupabaseClient;
  let shopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-integrity-${crypto.randomUUID()}`);

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb307.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-307 e2e", phone: null, catalogMode: "custom_only" })).id;
    await reserveBlock(client, localDb, shopId, deviceId);
  });

  /** Writes a bill + its items locally and pushes them; returns the sync verdict and the server's status. */
  async function push(status: "final" | "cancelled", totalPaise: number, itemTotals: number[]) {
    const localId = crypto.randomUUID();
    const receipt = await consumeNextNumber(client, localDb, shopId, deviceId);
    const now = new Date().toISOString();
    const bill: LocalBill = {
      localId, shopId, status, syncStatus: "pending",
      receiptNumber: receipt.receiptNumber, receiptNumberSource: receipt.source,
      customerName: "Cash", customerMobile: null, subtotalPaise: totalPaise, totalPaise, schemaVersion: 1,
      deviceId, createdAt: now, finalizedAt: now, syncedAt: null,
    };
    await localDb.bills.add(bill);
    const items: LocalBillItem[] = itemTotals.map((t, i) => ({
      billLocalId: localId, shopId, lineNo: i + 1, shopProductId: null, displayName: `Line ${i + 1}`, spokenName: null,
      qty: 1, unit: "piece", ratePaise: t, rateUnit: "piece", totalPaise: t, priceType: "rate", source: "manual", reviewFlags: [], wasEdited: false,
    }));
    if (items.length) await localDb.billItems.bulkAdd(items);
    await pushBills(client, localDb);
    const local = await localDb.bills.get(localId);
    const { data } = await client.from("bills").select("status").eq("shop_id", shopId).eq("local_id", localId).maybeSingle();
    return { syncStatus: local?.syncStatus, serverStatus: (data as { status?: string } | null)?.status ?? null };
  }

  it("a final bill that adds up (4500 + 9000 = 13500) syncs", async () => {
    expect(await push("final", 13500, [4500, 9000])).toEqual({ syncStatus: "synced", serverStatus: "final" });
  });

  it("a final bill with ZERO items is rejected - conflict, nothing on the server", async () => {
    expect(await push("final", 0, [])).toEqual({ syncStatus: "conflict", serverStatus: null });
  });

  it("items that don't sum to the total (4500 + 9000 vs 14000) are rejected", async () => {
    expect(await push("final", 14000, [4500, 9000])).toEqual({ syncStatus: "conflict", serverStatus: null });
  });

  it("a CANCELLED bill that doesn't add up is rejected too", async () => {
    expect(await push("cancelled", 14000, [4500, 9000])).toEqual({ syncStatus: "conflict", serverStatus: null });
  });

  it("a CANCELLED bill with zero items is rejected", async () => {
    expect(await push("cancelled", 0, [])).toEqual({ syncStatus: "conflict", serverStatus: null });
  });

  it("a cancelled bill that adds up syncs as cancelled", async () => {
    expect(await push("cancelled", 13500, [4500, 9000])).toEqual({ syncStatus: "synced", serverStatus: "cancelled" });
  });
});
