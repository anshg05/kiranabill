import "fake-indexeddb/auto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { billFlags, type UtteranceRecord } from "@/domain/billEdit";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB, type LocalBill } from "./db";
import { createShop } from "./shops";
import { requestBillNumber, resetNumberState } from "./receiptNumbers";
import { pushBills } from "./sync";
import { finaliseBill, type FinaliseInput } from "./finalise";

/**
 * KB-351 (owner, 22 Oct 2026; D92): ONE bill-number sequence for the shop, on the real local stack - real signUp, RLS, the
 * next_bill_number function, push_bill. The race: two phones (two sessions of one owner, two local databases) save bills at
 * the same moment - the numbers are 1..N with no repeat and no jump, and every bill pushes with no conflict. Also: seeding
 * from the highest number used so far, a retry for the same bill, the cap / offline path, RLS, and a counter that cannot
 * be tampered with. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("KB-351 one sequence across phones - real local stack", () => {
  let pg: Client;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let shopId: string;
  let delayRpcMs = 0; // simulates a slow server for the cap test
  const requests: string[] = [];
  const deviceA = "aaaaaaaa-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const deviceB = "bbbbbbbb-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const dbA = new KiranaBillDB(`e2e-351-a-${crypto.randomUUID()}`);
  const dbB = new KiranaBillDB(`e2e-351-b-${crypto.randomUUID()}`);

  const slowFetch: typeof fetch = async (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes("/rpc/")) requests.push(new URL(u).pathname.replace("/rest/v1/rpc/", ""));
    if (delayRpcMs > 0 && u.includes("/rpc/next_bill_number")) await new Promise((r) => setTimeout(r, delayRpcMs));
    return fetch(input, init);
  };
  const newClient = () => createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: slowFetch } });

  /** Real parser output as a draft - the same shape the billing screen hands finaliseBill. */
  function draft(deviceId: string, shop: string, localId: string = crypto.randomUUID()): FinaliseInput {
    const t = "2 kilo chini";
    const items = parseUtterance(t, SEED_PARSER_CATALOG)!;
    const lines: FinalLine[] = items.map((item, i) => ({ id: `l${i + 1}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" }));
    const utterances: UtteranceRecord[] = [{ id: 1, lineIds: lines.map((l) => l.id), flags: [...evaluateReviewFlags(t, items, SEED_PARSER_CATALOG.entries)], transcript: t }];
    // custom_only shop: the seed's ids aren't this shop's products, so the lines carry no product id here.
    const shopless = lines.map((l) => ({ ...l, item: { ...l.item, catalogId: null }, original: { ...l.original, catalogId: null } }));
    const flags = billFlags(lines, utterances, SEED_PARSER_CATALOG.entries).map((f) => ({ ...f, acknowledged: f.severity === "HIGH" }));
    return { localId, shopId: shop, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: shopless, flags };
  }
  /** Bill Banao as the screen does it: ask the server for the number, then the one local write. */
  async function billOn(client: SupabaseClient, db: KiranaBillDB, deviceId: string, shop = shopId): Promise<string> {
    const d = draft(deviceId, shop);
    const n = await requestBillNumber(client, shop, d.localId);
    return (await finaliseBill(db, { ...d, serverNumber: n?.receiptNumber })).receiptNumber;
  }
  async function signUp(label: string) {
    const c = newClient();
    const email = `e2e-${label}-${crypto.randomUUID()}@kb351.local`;
    const password = crypto.randomUUID();
    const { data, error } = await c.auth.signUp({ email, password });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    return { client: c, email, password, userId: data.user.id };
  }
  async function pushedBill(db: KiranaBillDB, receiptNumber: string, source: LocalBill["receiptNumberSource"], shop: string, deviceId: string) {
    const localId = crypto.randomUUID();
    const at = new Date().toISOString();
    await db.bills.add({ localId, shopId: shop, status: "final", syncStatus: "pending", receiptNumber, receiptNumberSource: source, customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: at, finalizedAt: at, syncedAt: null });
    await db.billItems.add({ billLocalId: localId, shopId: shop, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false });
  }
  const serverNumbers = async (shop: string) =>
    (await pg.query<{ receipt_number: string }>("select receipt_number from bills where shop_id = $1", [shop])).rows.map((r) => r.receipt_number);

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    const owner = await signUp("owner");
    clientA = owner.client;
    shopId = (await createShop(clientA, { ownerUserId: owner.userId, name: "KB-351 e2e", phone: null, catalogMode: "custom_only" })).id;
    clientB = newClient(); // the SAME owner on a second phone
    const { error } = await clientB.auth.signInWithPassword({ email: owner.email, password: owner.password });
    if (error) throw new Error(`second session failed: ${error.message}`);
  });
  afterAll(async () => {
    await pg?.end();
    dbA.close();
    dbB.close();
  });

  it("1. a new shop starts at 1; the same bill asking again gets the SAME number (a retry never burns one)", async () => {
    const bill = crypto.randomUUID();
    const first = await requestBillNumber(clientA, shopId, bill);
    resetNumberState();
    const again = await requestBillNumber(clientB, shopId, bill);
    expect(first?.receiptNumber).toBe("1");
    expect(again?.receiptNumber).toBe("1");
    const next = await requestBillNumber(clientA, shopId, crypto.randomUUID());
    expect(next?.receiptNumber).toBe("2");
  });

  it("2. THE RACE: two phones save 20 bills each at the same moment - 40 numbers, consecutive, no repeat, no jump, and every bill pushes with no conflict", async () => {
    resetNumberState();
    const [fromA, fromB] = await Promise.all([
      Promise.all(Array.from({ length: 20 }, () => billOn(clientA, dbA, deviceA))),
      Promise.all(Array.from({ length: 20 }, () => billOn(clientB, dbB, deviceB))),
    ]);
    const all = [...fromA, ...fromB].map(Number).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 40 }, (_, i) => i + 3)); // 1 and 2 were taken in test 1
    expect((await pushBills(clientA, dbA)).anyTransientFailure).toBe(false);
    expect((await pushBills(clientB, dbB)).anyTransientFailure).toBe(false);
    expect((await dbA.bills.toArray()).concat(await dbB.bills.toArray()).every((b) => b.syncStatus === "synced" && b.receiptNumberSource === "counter")).toBe(true);
    const onServer = (await serverNumbers(shopId)).map(Number).sort((a, b) => a - b);
    expect(onServer).toEqual(Array.from({ length: 40 }, (_, i) => i + 3));
  });

  it("3. the next two bills at the same instant are 43 and 44 (5 and 6, never a jump)", async () => {
    const two = await Promise.all([billOn(clientA, dbA, deviceA), billOn(clientB, dbB, deviceB)]);
    expect(two.map(Number).sort((a, b) => a - b)).toEqual([43, 44]);
  });

  it("4. seeding: a shop with old bills continues after the highest number used - no jump, offline codes ignored, blocks' next_number counted", async () => {
    const owner = await signUp("seed");
    const seedShop = (await createShop(owner.client, { ownerUserId: owner.userId, name: "Seed shop", phone: null, catalogMode: "custom_only" })).id;
    const db = new KiranaBillDB(`e2e-351-seed-${crypto.randomUUID()}`);
    await pushedBill(db, "KB-000041", "block", seedShop, deviceA); // an old padded number
    await pushedBill(db, "58", "block", seedShop, deviceA);
    await pushedBill(db, "59", "block", seedShop, deviceA);
    await pushedBill(db, "AB12CD-900", "fallback", seedShop, deviceA); // an offline code never counts
    expect((await pushBills(owner.client, db)).anyTransientFailure).toBe(false);
    expect((await requestBillNumber(owner.client, seedShop, crypto.randomUUID()))?.receiptNumber).toBe("60");
    // another shop whose old block was used further than its pushed bills show
    const owner2 = await signUp("seed2");
    const shop2 = (await createShop(owner2.client, { ownerUserId: owner2.userId, name: "Seed shop 2", phone: null, catalogMode: "custom_only" })).id;
    await pg.query("insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number, allocated_at) values ($1, $2, 61, 110, 66, now())", [shop2, deviceA]);
    expect((await requestBillNumber(owner2.client, shop2, crypto.randomUUID()))?.receiptNumber).toBe("66");
    db.close();
  });

  it("5. the cap: a server slower than the cap gives null, the bill saves at once with an offline number, and the breaker skips the server for a while", async () => {
    resetNumberState();
    delayRpcMs = 600;
    const t0 = Date.now();
    const abandoned = crypto.randomUUID();
    const slow = await requestBillNumber(clientA, shopId, abandoned, { capMs: 150 });
    expect(slow).toBeNull();
    expect(Date.now() - t0).toBeLessThan(450); // gave up at the cap, did not wait for the server
    delayRpcMs = 0;
    requests.length = 0;
    const second = await billOn(clientA, dbA, deviceA); // breaker open: no request, an offline number
    expect(second).toMatch(/^AAAAAA-\d+$/);
    expect(requests).not.toContain("next_bill_number");
    expect((await dbA.bills.toArray()).find((b) => b.receiptNumber === second)?.receiptNumberSource).toBe("fallback");
    expect((await pushBills(clientA, dbA)).anyTransientFailure).toBe(false); // the offline-numbered bill pushes fine and keeps its number for ever
    expect(await serverNumbers(shopId)).toContain(second);
    resetNumberState();
    // The abandoned call still reaches the server late and takes one number that no bill will use: the accepted rare gap (owner Q4).
    let granted = 0;
    for (let i = 0; i < 30 && granted === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      granted = (await pg.query("select 1 from bill_number_grants where shop_id = $1 and local_id = $2", [shopId, abandoned])).rowCount ?? 0;
    }
    expect(granted).toBe(1);
  });

  it("6. RLS: another shop's owner cannot take a number for this shop (null, nothing written); anon cannot call it", async () => {
    const stranger = await signUp("stranger");
    await createShop(stranger.client, { ownerUserId: stranger.userId, name: "Not yours", phone: null, catalogMode: "custom_only" });
    expect(await requestBillNumber(stranger.client, shopId, crypto.randomUUID())).toBeNull();
    resetNumberState();
    const anon = await newClient().rpc("next_bill_number", { p_shop_id: shopId, p_local_id: crypto.randomUUID() });
    expect(anon.error?.code).toBe("42501");
    const before = (await pg.query<{ last_number: string }>("select last_number from shop_bill_counters where shop_id = $1", [shopId])).rows[0]!.last_number;
    expect(Number(before)).toBeGreaterThanOrEqual(44);
  });

  it("7. the counter cannot be tampered with: a member's direct UPDATE that is not exactly +1 is refused; the function is SECURITY INVOKER", async () => {
    const cur = (await pg.query<{ last_number: string }>("select last_number from shop_bill_counters where shop_id = $1", [shopId])).rows[0]!.last_number;
    const down = await clientA.from("shop_bill_counters").update({ last_number: 1 }).eq("shop_id", shopId);
    const jump = await clientA.from("shop_bill_counters").update({ last_number: Number(cur) + 1000 }).eq("shop_id", shopId);
    expect(down.error?.code).toBe("KB409");
    expect(jump.error?.code).toBe("KB409");
    expect((await pg.query<{ last_number: string }>("select last_number from shop_bill_counters where shop_id = $1", [shopId])).rows[0]!.last_number).toBe(cur);
    const inv = await pg.query<{ prosecdef: boolean }>("select prosecdef from pg_proc where proname in ('next_bill_number', 'shop_bill_counter_step')");
    expect(inv.rows).toHaveLength(2);
    expect(inv.rows.every((r) => r.prosecdef === false)).toBe(true);
  });
});
