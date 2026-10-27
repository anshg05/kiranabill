import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, type LocalBill } from "./db";
import { createShop } from "./shops";
import { pushBills, resetProbeState, syncNow } from "./sync";

/**
 * KB-345 (D90): sync_probe on the real local stack (real signUp, RLS, PostgREST) and the loop's request counts. A fetch
 * wrapper counts every REST call, so "one request when nothing changed" is measured, not assumed. Refuses non-localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start` and every migration, including 20261020090000_sync_probe.sql).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-345 sync_probe - real local stack", () => {
  let client: SupabaseClient;
  let shopId: string;
  const requests: string[] = [];
  let failProbe = false;
  const deviceA = "aaaaaaaa-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const deviceB = "bbbbbbbb-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const dbA = new KiranaBillDB(`e2e-probe-a-${crypto.randomUUID()}`);
  const dbB = new KiranaBillDB(`e2e-probe-b-${crypto.randomUUID()}`);

  const counting: typeof fetch = async (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes("/rest/v1/")) requests.push(new URL(u).pathname.replace("/rest/v1/", ""));
    if (failProbe && u.includes("/rpc/sync_probe")) {
      return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.sync_probe", details: null, hint: null }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return fetch(input, init);
  };

  async function bill(db: KiranaBillDB, deviceId: string): Promise<string> {
    const localId = crypto.randomUUID();
    const at = new Date().toISOString();
    const n = (await db.bills.count()) + 1;
    await db.bills.add({ localId, shopId, status: "final", syncStatus: "pending", receiptNumber: `T${deviceId.slice(0, 2)}-${n}`, receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId, createdAt: at, finalizedAt: at, syncedAt: null } satisfies LocalBill);
    await db.billItems.add({ billLocalId: localId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false });
    return localId;
  }
  const opts = (db: KiranaBillDB, deviceId: string, pull: "all" | "probe" | "none") => ({ client, localDb: db, shopId, deviceId, pull });
  const hits = (re: RegExp) => requests.filter((r) => re.test(r)).length;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: counting } });
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb345.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-345 e2e", phone: null, catalogMode: "custom_only" })).id;
  });
  afterEach(() => {
    failProbe = false;
    vi.useRealTimers();
    resetProbeState();
  });
  afterAll(() => {
    dbA.close();
    dbB.close();
  });

  it("1. the probe answers one object with a stamp per table, and the same answer twice while nothing changes", async () => {
    const a = await client.rpc("sync_probe", { p_shop_id: shopId });
    const b = await client.rpc("sync_probe", { p_shop_id: shopId });
    expect(a.error).toBeNull();
    expect(Object.keys(a.data as object).sort()).toEqual(["bill_cancellations", "bill_metrics", "bills", "learning", "receipt_number_blocks", "shop_products", "shops"]);
    expect(a.data).toEqual(b.data);
    expect((a.data as { receipt_number_blocks: number[] }).receipt_number_blocks).toEqual([0, 0]); // KB-351: blocks are retired - none reserved any more
  });

  it("2. a probe of ANOTHER shop answers nothing (RLS) - never its stamps", async () => {
    const other = await client.rpc("sync_probe", { p_shop_id: crypto.randomUUID() });
    expect(other.data).toEqual({ bills: null, bill_cancellations: null, bill_metrics: null, shop_products: null, shops: null, learning: null, receipt_number_blocks: [0, 0] });
  });

  it("3. a quiet cycle costs ONE request (the probe); the first cycle after start is a full pull", async () => {
    resetProbeState();
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests.length).toBeGreaterThanOrEqual(9); // no baseline yet: the old full pull (KB-351: one request fewer, no blocks)
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests).toEqual(["rpc/sync_probe"]);
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests).toEqual(["rpc/sync_probe"]);
  });

  it("4. another phone's bill: the next probe cycle pulls the BILLS and nothing else", async () => {
    await syncNow(opts(dbA, deviceA, "probe")); // baseline
    const id = await bill(dbB, deviceB);
    expect((await pushBills(client, dbB)).anyTransientFailure).toBe(false);
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(hits(/^rpc\/sync_probe$/)).toBe(1);
    expect(hits(/^bills/)).toBeGreaterThanOrEqual(1);
    expect(hits(/shop_products|base_products|^shops|learned_aliases|provisional_products|price_observations|learning_events|bill_cancellations|bill_metrics|receipt_number_blocks/)).toBe(0);
    expect((await dbA.bills.get(id))?.syncStatus).toBe("synced"); // arrived on phone A
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests).toEqual(["rpc/sync_probe"]); // and quiet again
  });

  it("5. a pending bill on this phone is pushed by a probe cycle, and the next cycle is quiet again", async () => {
    await syncNow(opts(dbA, deviceA, "probe"));
    const id = await bill(dbA, deviceA);
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(hits(/rpc\/push_bill/)).toBe(1);
    expect((await dbA.bills.get(id))?.syncStatus).toBe("synced");
    await syncNow(opts(dbA, deviceA, "probe")); // its own bill comes back through the probe once
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests).toEqual(["rpc/sync_probe"]);
  });

  it("6. about every 5 minutes a full pull runs even when nothing moved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await syncNow(opts(dbA, deviceA, "probe"));
    vi.setSystemTime(Date.now() + 4 * 60_000);
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests).toEqual(["rpc/sync_probe"]);
    vi.setSystemTime(Date.now() + 61_000);
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(requests.length).toBeGreaterThanOrEqual(9);
  });

  it("7. if the server has no sync_probe (an older database) the loop pulls in full, as before, and does not keep asking", async () => {
    failProbe = true;
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    const first = requests.length;
    expect(first).toBeGreaterThanOrEqual(9);
    expect(hits(/rpc\/sync_probe/)).toBe(1);
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "probe"));
    expect(hits(/rpc\/sync_probe/)).toBe(0); // blocked for a while
    expect(requests.length).toBeGreaterThanOrEqual(9); // but still pulling
  });

  it("8. 'none' pushes and pulls nothing when nothing is pending (the last push before the app is hidden)", async () => {
    requests.length = 0;
    await syncNow(opts(dbA, deviceA, "none"));
    expect(requests).toEqual([]);
  });
});
