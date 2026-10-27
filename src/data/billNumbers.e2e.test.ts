import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, type LocalBill } from "./db";
import { createShop } from "./shops";
import { requestBillNumber } from "./receiptNumbers";
import { pullBills, pullShop, pushBills } from "./sync";
import { loadSearchIndex } from "./history";
import { cancelBillLocal, loadCancellationInfo } from "./cancelBill";
import { compileQuery } from "@/domain/billSearch";

/**
 * KB-341 (D87): plain bill numbers beside old ones in ONE shop, on the real local stack (real signUp, RLS, push_bill, pull).
 * An old "KB-000012" (saved before the change), plain numbers from the shop's own block, and a short fallback number all
 * save, push, pull to a second phone, are found by the History search, and cancel/reissue links them. Refuses anything
 * but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-341 mixed old + plain + fallback numbers - real local stack", () => {
  let client: SupabaseClient;
  let shopId: string;
  const deviceA = "7f2a9134-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const dbA = new KiranaBillDB(`e2e-num-a-${crypto.randomUUID()}`);
  const dbB = new KiranaBillDB(`e2e-num-b-${crypto.randomUUID()}`);

  /** The shop's next number from the server counter (KB-351), as the app takes it at Bill Banao. */
  const take = async () => (await requestBillNumber(client, shopId, crypto.randomUUID()))!;

  async function addBill(receiptNumber: string, source: LocalBill["receiptNumberSource"], customer = "Cash"): Promise<string> {
    const localId = crypto.randomUUID();
    const at = new Date().toISOString();
    await dbA.bills.add({ localId, shopId, status: "final", syncStatus: "pending", receiptNumber, receiptNumberSource: source, customerName: customer, customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId: deviceA, createdAt: at, finalizedAt: at, syncedAt: null });
    await dbA.billItems.add({ billLocalId: localId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false });
    return localId;
  }

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb341.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-341 e2e", phone: null, catalogMode: "custom_only" })).id;
  });
  afterAll(() => {
    dbA.close();
    dbB.close();
  });

  it("the first number of a new shop is 1, the next 2 (plain, from the server counter), and the old/fallback shapes sit beside them", async () => {
    const one = await take();
    const two = await take();
    expect([one.receiptNumber, two.receiptNumber]).toEqual(["1", "2"]);
    const idOld = await addBill("KB-000012", "block", "Old Ramesh");
    const idOne = await addBill(one.receiptNumber, "counter");
    const idTwo = await addBill(two.receiptNumber, "counter");
    const idFallback = await addBill("7F2A91-1", "fallback", "Offline Suresh");
    const r = await pushBills(client, dbA);
    expect(r.anyTransientFailure).toBe(false);
    expect((await dbA.bills.toArray()).every((b) => b.syncStatus === "synced")).toBe(true);

    // A second phone pulls all four with their numbers exactly as saved.
    await pullShop(client, dbB, shopId);
    await pullBills(client, dbB, shopId, { awaitBackfill: true });
    const pulled = Object.fromEntries((await dbB.bills.toArray()).map((b) => [b.localId, b.receiptNumber]));
    expect(pulled).toEqual({ [idOld]: "KB-000012", [idOne]: "1", [idTwo]: "2", [idFallback]: "7F2A91-1" });

    // History search on the second phone: by sequence, with "bill", and the fallback is NOT bill 1.
    const index = await loadSearchIndex(dbB, shopId, null);
    const ids = (q: string) => index.filter(compileQuery(q)).map((r) => r.localId).sort();
    expect(ids("bill 12")).toEqual([idOld]);
    expect(ids("12")).toEqual([idOld]);
    expect(ids("bill 1")).toEqual([idOne]);
    expect(ids("बिल 2")).toEqual([idTwo]);
    expect(ids("7f2a91-1")).toEqual([idFallback]);
  });

  it("cancel + reissue links plain and old numbers: 'Replaces' / 'Replaced by' carry the numbers as saved", async () => {
    const oldId = (await dbA.bills.toArray()).find((b) => b.receiptNumber === "KB-000012")!.localId;
    const replacement = crypto.randomUUID();
    const next = await take();
    expect(next.receiptNumber).toBe("3");
    const at = new Date().toISOString();
    await dbA.bills.add({ localId: replacement, shopId, status: "final", syncStatus: "pending", receiptNumber: next.receiptNumber, receiptNumberSource: "counter", customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId: deviceA, createdAt: at, finalizedAt: at, syncedAt: null });
    const done = await cancelBillLocal(dbA, { shopId, billLocalId: oldId, reason: "wrong_item", deviceId: deviceA, replacementLocalId: replacement });
    expect(done.ok).toBe(true);
    expect((await loadCancellationInfo(dbA, oldId)).replacedBy?.receiptNumber).toBe("3");
    expect((await loadCancellationInfo(dbA, replacement)).replaces?.receiptNumber).toBe("KB-000012");
  });
});
