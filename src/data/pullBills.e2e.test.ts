import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { KiranaBillDB, type LocalBill, type LocalBillItem } from "./db";
import { createShop } from "./shops";
import { reserveBlock, consumeNextNumber } from "./receiptNumbers";
import { pullBills, pullShop, pushBills } from "./sync";
import { learnPendingBills } from "./learnBill";
import { loadReceipt } from "./receipt";
import { loadRecentRows, loadSearchIndex } from "./history";
import { compileQuery } from "@/domain/billSearch";

/**
 * KB-324: bills are pulled from the server, so a cleared phone, a new phone or a
 * new draft address gets its History back. Real local stack (D21, D32): a real
 * signUp, real RLS, the real push_bill and the real pullBills. Two "devices" =
 * two Dexie databases of the same user. Refuses anything but localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start` and every migration).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DAY = 86_400_000;

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

describe("KB-324 pull bills - real local stack", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const deviceA = crypto.randomUUID();
  const dbA = new KiranaBillDB(`e2e-pull-a-${crypto.randomUUID()}`);
  const openDbs: KiranaBillDB[] = [dbA];
  const newDevice = () => {
    const db = new KiranaBillDB(`e2e-pull-${crypto.randomUUID()}`);
    openDbs.push(db);
    return db;
  };

  const items = (billLocalId: string): LocalBillItem[] => [
    { billLocalId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 500, unit: "gm", ratePaise: 4500, rateUnit: "kg", totalPaise: 2250, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false },
    { billLocalId, shopId, lineNo: 2, shopProductId: null, displayName: "Chawal", spokenName: "chawal", qty: 2, unit: "kg", ratePaise: 5000, rateUnit: "kg", totalPaise: 10000, priceType: "default", source: "fastpath", reviewFlags: [{ code: "unusual_rate", severity: "MEDIUM", message: "m", acknowledged: true } as never], wasEdited: true },
    { billLocalId, shopId, lineNo: 3, shopProductId: null, displayName: "Namak", spokenName: null, qty: 1, unit: "kg", ratePaise: null, rateUnit: null, totalPaise: 2000, priceType: "total", source: "manual", reviewFlags: [], wasEdited: false },
  ];

  /** A finalised bill on device A, `daysAgo` days old (device time), pushed or left pending. */
  async function makeBill(opts: { daysAgo?: number; customer?: string; mobile?: string | null; status?: LocalBill["status"]; push?: boolean } = {}) {
    const localId = crypto.randomUUID();
    const receipt = await consumeNextNumber(client, dbA, shopId, deviceA);
    const at = new Date(Date.now() - (opts.daysAgo ?? 0) * DAY).toISOString();
    const rows = items(localId);
    const total = rows.reduce((s, i) => s + i.totalPaise, 0);
    await dbA.bills.add({
      localId, shopId, status: opts.status ?? "final", syncStatus: "pending", receiptNumber: receipt.receiptNumber, receiptNumberSource: receipt.source,
      customerName: opts.customer ?? "Cash", customerMobile: opts.mobile ?? null, subtotalPaise: total, totalPaise: total, schemaVersion: 1,
      deviceId: deviceA, createdAt: at, finalizedAt: at, syncedAt: null,
    });
    await dbA.billItems.bulkAdd(rows);
    if (opts.push !== false) {
      const r = await pushBills(client, dbA);
      expect(r.anyTransientFailure).toBe(false);
    }
    return localId;
  }

  const pull = (db: KiranaBillDB, extra: Parameters<typeof pullBills>[3] = {}) => pullBills(client, db, shopId, { awaitBackfill: true, ...extra });
  const localIds = async (db: KiranaBillDB) => (await db.bills.toArray()).map((b) => b.localId);

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb324.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-324 e2e", phone: null, catalogMode: "custom_only" });
    shopId = shop.id;
    await reserveBlock(client, dbA, shopId, deviceA);
  });

  afterAll(async () => {
    await pg?.end();
    openDbs.forEach((d) => d.close());
  });

  it("1. a new device gets the shop's bills back whole: bill, items, search rows, and the receipt is identical", async () => {
    const ramesh = await makeBill({ customer: "Ramesh", mobile: "9876543210" });
    const cash = await makeBill({ daysAgo: 2 });
    const dbB = newDevice();
    await pullShop(client, dbB, shopId);
    await pullShop(client, dbA, shopId);
    await pull(dbB);

    expect((await localIds(dbB)).sort()).toEqual([ramesh, cash].sort());
    const b = (await dbB.bills.get(ramesh))!;
    const a = (await dbA.bills.get(ramesh))!;
    expect(b).toMatchObject({
      status: "final", syncStatus: "synced", shopId, customerName: "Ramesh", customerMobile: "9876543210", receiptNumber: a.receiptNumber,
      receiptNumberSource: a.receiptNumberSource, totalPaise: a.totalPaise, subtotalPaise: a.subtotalPaise, deviceId: deviceA,
      createdAt: a.createdAt, finalizedAt: a.finalizedAt,
    });
    expect(b.serverId).toBeTruthy();
    expect(b.pulledAt).toBeTruthy();
    const bItems = await dbB.billItems.where("billLocalId").equals(ramesh).sortBy("lineNo");
    const aItems = await dbA.billItems.where("billLocalId").equals(ramesh).sortBy("lineNo");
    expect(bItems.map(({ id: _id, ...rest }) => rest)).toEqual(aItems.map(({ id: _id, ...rest }) => rest));
    expect(await loadReceipt(dbB, ramesh)).toEqual(await loadReceipt(dbA, ramesh));

    // History: the list and the search rows (D61), by name and by amount.
    const rows = await loadRecentRows(dbB, shopId, 50);
    expect(rows.map((r) => r.localId)).toEqual([ramesh, cash]);
    expect(rows.every((r) => r.syncStatus === "synced")).toBe(true);
    const index = await loadSearchIndex(dbB, shopId, null);
    expect(index.filter(compileQuery("ramesh")).map((r) => r.localId)).toEqual([ramesh]);
    expect(index.filter(compileQuery("142.50")).length).toBe(2);
    expect(index.filter(compileQuery("chawal")).length).toBe(2);
  });

  it("2. a pulled bill is never pushed again", async () => {
    const dbB = newDevice();
    await pull(dbB);
    expect(await dbB.bills.where("syncStatus").equals("pending").count()).toBe(0);
    const before = (await pg.query("select count(*)::int as n from bills where shop_id = $1", [shopId])).rows[0].n;
    expect((await pushBills(client, dbB)).anyTransientFailure).toBe(false);
    expect((await pg.query("select count(*)::int as n from bills where shop_id = $1", [shopId])).rows[0].n).toBe(before);
  });

  it("3. a pulled bill teaches nothing (hard rules 8 and 12): no events, aliases, observations or provisional products", async () => {
    const dbB = newDevice();
    await pull(dbB);
    expect(await dbB.bills.count()).toBeGreaterThan(0);
    expect(await learnPendingBills(dbB, shopId)).toBe(0);
    expect(await dbB.learningEvents.count()).toBe(0);
    expect(await dbB.learnedAliases.count()).toBe(0);
    expect(await dbB.priceObservations.count()).toBe(0);
    expect(await dbB.provisionalProducts.count()).toBe(0);
  });

  it("4. incremental: a bill made OFFLINE days ago and pushed today (old created_at) still arrives", async () => {
    const dbB = newDevice();
    await pull(dbB); // backfill done, cursor set
    const old = await makeBill({ daysAgo: 5, customer: "Offline Wala" });
    expect(await dbB.bills.get(old)).toBeUndefined();
    await pull(dbB);
    expect((await dbB.bills.get(old))?.customerName).toBe("Offline Wala");
  });

  it("5. a bill from BEFORE the migration (synced_at null) arrives via the backfill", async () => {
    // Local stack only (DB_URL is a constant 127.0.0.1): switch off just the new trigger to make a pre-migration row.
    const localId = crypto.randomUUID();
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("alter table bills disable trigger bills_set_synced_at");
      const ins = await c.query(
        `insert into bills (shop_id, local_id, receipt_number, customer_name, subtotal_paise, total_paise, status, schema_version, device_id, created_at, finalized_at)
         values ($1, $2, 'PRE-1', 'Purana Bill', 500, 500, 'draft', 1, 'old-device', now() - interval '30 days', now() - interval '30 days') returning id`,
        [shopId, localId],
      );
      await c.query(
        `insert into bill_items (bill_id, shop_id, line_no, display_name, total_paise, price_type, source) values ($1, $2, 1, 'Purana Item', 500, 'total', 'manual')`,
        [ins.rows[0].id, shopId],
      );
      await c.query("update bills set status = 'final' where id = $1", [ins.rows[0].id]);
      await c.query("alter table bills enable trigger bills_set_synced_at");
      await c.query("commit");
    } finally {
      await c.end();
    }
    expect((await pg.query("select synced_at from bills where local_id = $1", [localId])).rows[0].synced_at).toBeNull();

    const dbC = newDevice();
    await pull(dbC);
    expect((await dbC.bills.get(localId))?.customerName).toBe("Purana Bill");
    expect(await dbC.billItems.where("billLocalId").equals(localId).count()).toBe(1);
    expect((await loadSearchIndex(dbC, shopId, null)).some((r) => r.localId === localId)).toBe(true);
  });

  it("6. a bill pushed from A while B's backfill is half-way arrives exactly once (also when it sits in the part still to come)", async () => {
    for (let i = 0; i < 4; i++) await makeBill({ daysAgo: 1 + i, customer: `Bheed ${i}` }); // enough bills for several pages
    const dbD = newDevice();
    const total = (await pg.query("select count(*)::int as n from bills where shop_id = $1", [shopId])).rows[0].n as number;
    expect(total).toBeGreaterThan(4);
    await pull(dbD, { pageSize: 2, maxPages: 1 });
    expect(await dbD.bills.count()).toBe(2); // half-way: the newest two only
    const state = await dbD.syncState.get(`bills:${shopId}`);
    expect(state?.cursor).toContain("backfill");

    const inTheUnseenPast = await makeBill({ daysAgo: 20, customer: "Beech Mein" }); // old created_at: in the part still to come AND after the cursor by synced_at
    const newest = await makeBill({ customer: "Sabse Naya" });
    await pull(dbD, { pageSize: 2 });

    for (const id of [inTheUnseenPast, newest]) {
      expect((await dbD.bills.where("localId").equals(id).count())).toBe(1);
      expect(await dbD.billItems.where("billLocalId").equals(id).count()).toBe(3);
      expect(await dbD.billSearch.where("localId").equals(id).count()).toBe(1);
    }
    expect(await dbD.bills.count()).toBe(total + 2);
    expect((await dbD.syncState.get(`bills:${shopId}`))?.cursor).toContain("done");
  });

  it("7. an interrupted backfill resumes where it stopped and ends with every bill once", async () => {
    const dbE = newDevice();
    await pull(dbE, { pageSize: 3, maxPages: 2 });
    expect(await dbE.bills.count()).toBe(6);
    await pull(dbE, { pageSize: 3 });
    const all = (await pg.query("select local_id from bills where shop_id = $1", [shopId])).rows.map((r) => r.local_id as string);
    expect((await localIds(dbE)).sort()).toEqual(all.sort());
  });

  it("8. a bill that arrives already cancelled is stored but not listed or searchable", async () => {
    const cancelled = await makeBill({ status: "cancelled", customer: "Radd Wala" });
    const dbF = newDevice();
    await pull(dbF);
    expect((await dbF.bills.get(cancelled))?.status).toBe("cancelled");
    expect(await dbF.billItems.where("billLocalId").equals(cancelled).count()).toBe(3);
    expect((await loadRecentRows(dbF, shopId, 500)).some((r) => r.localId === cancelled)).toBe(false);
    expect(await dbF.billSearch.where("localId").equals(cancelled).count()).toBe(0);
  });

  it("9. another shop's bills never arrive (RLS)", async () => {
    const other = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await other.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb324.local`, password: crypto.randomUUID() });
    const shopB = await createShop(other, { ownerUserId: data.user!.id, name: "KB-324 other", phone: null, catalogMode: "custom_only" });
    const dbOther = new KiranaBillDB(`e2e-pull-other-${crypto.randomUUID()}`);
    openDbs.push(dbOther);
    const dev = crypto.randomUUID();
    await reserveBlock(other, dbOther, shopB.id, dev);
    const receipt = await consumeNextNumber(other, dbOther, shopB.id, dev);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await dbOther.bills.add({ localId: id, shopId: shopB.id, status: "final", syncStatus: "pending", receiptNumber: receipt.receiptNumber, receiptNumberSource: receipt.source, customerName: "Doosri Dukaan", customerMobile: null, subtotalPaise: 100, totalPaise: 100, schemaVersion: 1, deviceId: dev, createdAt: now, finalizedAt: now, syncedAt: null });
    await dbOther.billItems.add({ billLocalId: id, shopId: shopB.id, lineNo: 1, shopProductId: null, displayName: "Item", spokenName: null, qty: null, unit: null, ratePaise: null, rateUnit: null, totalPaise: 100, priceType: "total", source: "manual", reviewFlags: [], wasEdited: false });
    expect((await pushBills(other, dbOther)).anyTransientFailure).toBe(false);

    const dbG = newDevice();
    await pull(dbG);
    expect(await dbG.bills.get(id)).toBeUndefined();
    expect((await dbG.bills.toArray()).every((b) => b.shopId === shopId)).toBe(true);
  });
});
