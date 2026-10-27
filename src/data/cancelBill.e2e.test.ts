import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { billFlags, type UtteranceRecord } from "@/domain/billEdit";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullBills, syncNow } from "./sync";
import { finaliseBill, type FinaliseInput } from "./finalise";
import { cancelBillLocal, loadCancellationInfo } from "./cancelBill";

/**
 * KB-325 (D79) - cancel and reissue on the real local stack (D21, D32), shipped code: cancelBillLocal writes the
 * cancellation on the device, syncNow() pushes the bill and then calls cancel_bill(), and another device pulls it. A
 * cancel changes bills.status only (bills_enforce_immutability, D18); the reason, time and link live in
 * bill_cancellations. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("KB-325 e2e - cancel and reissue (local Postgres)", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const dbs: KiranaBillDB[] = [];

  async function device() {
    const db = new KiranaBillDB(`e2e-cancel-${crypto.randomUUID()}`);
    dbs.push(db);
    const deviceId = crypto.randomUUID();
    return { db, deviceId };
  }
  type Device = Awaited<ReturnType<typeof device>>;

  function draft(deviceId: string, localId: string, ...transcripts: string[]): FinaliseInput {
    const lines: FinalLine[] = [];
    const utterances: UtteranceRecord[] = [];
    transcripts.forEach((t, u) => {
      const items = parseUtterance(t, SEED_PARSER_CATALOG)!;
      const ids = items.map((item) => {
        const id = `l${lines.length + 1}`;
        lines.push({ id, utteranceId: u + 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" });
        return id;
      });
      utterances.push({ id: u + 1, lineIds: ids, flags: [...evaluateReviewFlags(t, items, SEED_PARSER_CATALOG.entries)], transcript: t });
    });
    // custom_only shop: the seed's product ids are not this shop's products, so the lines carry no product id here.
    const shopless = lines.map((l) => ({ ...l, item: { ...l.item, catalogId: null }, original: { ...l.original, catalogId: null } }));
    const flags = billFlags(lines, utterances, SEED_PARSER_CATALOG.entries).map((f) => ({ ...f, acknowledged: f.severity === "HIGH" }));
    return { localId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: shopless, flags };
  }
  async function bill(d: Device, ...transcripts: string[]) {
    const localId = crypto.randomUUID();
    await finaliseBill(d.db, draft(d.deviceId, localId, ...transcripts));
    return localId;
  }
  const sync = (d: Device) => syncNow({ client, localDb: d.db, shopId, deviceId: d.deviceId });
  const pullAll = async (d: Device) => {
    await pullBills(client, d.db, shopId, { awaitBackfill: true });
    await sync(d);
  };
  const cancel = (d: Device, billLocalId: string, replacementLocalId: string | null = null, reason: "wrong_price" | "wrong_item" = "wrong_price") =>
    cancelBillLocal(d.db, { shopId, billLocalId, reason, deviceId: d.deviceId, replacementLocalId });
  const serverBill = async (localId: string) =>
    (await pg.query<{ id: string; status: string; total_paise: string; receipt_number: string }>("select id, status, total_paise, receipt_number from bills where shop_id = $1 and local_id = $2", [shopId, localId])).rows[0];
  const serverCancellations = async (billLocalId: string) =>
    (await pg.query("select reason, bill_local_id, replacement_local_id, device_id, local_id from bill_cancellations where shop_id = $1 and bill_local_id = $2", [shopId, billLocalId])).rows;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb325.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-325 e2e", phone: null, catalogMode: "custom_only" })).id;
  }, 60_000);
  afterAll(async () => {
    await pg?.end();
    dbs.forEach((d) => d.close());
  });

  it("1. a synced bill, cancelled on A: the server bill is 'cancelled' with its items and total untouched, and ONE cancellation row says why", async () => {
    const a = await device();
    const id = await bill(a, "2 kilo chini 5 wala", "1 kilo besan");
    await sync(a);
    const before = await serverBill(id);
    expect(before!.status).toBe("final");
    expect(await cancel(a, id)).toEqual({ ok: true });
    await sync(a);
    const after = await serverBill(id);
    expect(after).toMatchObject({ status: "cancelled", total_paise: before!.total_paise, receipt_number: before!.receipt_number });
    const rows = await serverCancellations(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "wrong_price", bill_local_id: id, replacement_local_id: null, device_id: a.deviceId });
    const local = (await a.db.billCancellations.get(id))!;
    expect(local.syncStatus).toBe("synced");
    expect(local.serverId).toBeTruthy();
    expect((await a.db.bills.get(id))!.syncStatus).toBe("synced");
  }, 60_000);

  it("2. another device that held the bill as FINAL sees it cancelled, with the reason, after its next cycle; its sync state is untouched", async () => {
    const a = await device();
    const b = await device();
    const id = await bill(a, "2 kilo chini");
    await sync(a);
    await pullAll(b);
    expect((await b.db.bills.get(id))!.status).toBe("final");

    await cancel(a, id, null, "wrong_item");
    await sync(a);
    await sync(b);
    const onB = (await b.db.bills.get(id))!;
    expect(onB.status).toBe("cancelled");
    expect(onB.syncStatus).toBe("synced");
    expect(await b.db.billCancellations.get(id)).toMatchObject({ reason: "wrong_item", syncStatus: "synced" });
    expect(await b.db.billSearch.get(id)).toMatchObject({ cancelled: true });
  }, 90_000);

  it("3. a brand-new device (backfill) gets the bill already cancelled, with its reason, and lists it", async () => {
    const a = await device();
    const id = await bill(a, "1 kilo besan");
    await sync(a);
    await cancel(a, id);
    await sync(a);
    const c = await device();
    await pullAll(c);
    await sync(c);
    expect((await c.db.bills.get(id))!.status).toBe("cancelled");
    expect((await loadCancellationInfo(c.db, id)).cancellation).toMatchObject({ reason: "wrong_price" });
    expect(await c.db.billSearch.get(id)).toMatchObject({ cancelled: true });
  }, 90_000);

  it("4. finalised AND cancelled offline, before the bill's first push: one cycle pushes the bill, then its cancellation - in that order", async () => {
    const a = await device();
    const id = await bill(a, "2 kilo chini");
    await cancel(a, id);
    expect(await serverBill(id)).toBeUndefined();
    await sync(a);
    expect((await serverBill(id))!.status).toBe("cancelled");
    expect(await serverCancellations(id)).toHaveLength(1);
  }, 60_000);

  it("5. cancelled on two devices at once: one row; both end synced; the second device's record takes the first's server id", async () => {
    const a = await device();
    const b = await device();
    const id = await bill(a, "2 kilo chini");
    await sync(a);
    await pullAll(b);
    await cancel(a, id, null, "wrong_price");
    await cancel(b, id, null, "wrong_item"); // B had not heard yet
    await sync(a);
    await sync(b);
    const rows = await serverCancellations(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("wrong_price"); // the first to arrive
    const ra = (await a.db.billCancellations.get(id))!;
    const rb = (await b.db.billCancellations.get(id))!;
    expect([ra.syncStatus, rb.syncStatus]).toEqual(["synced", "synced"]);
    expect(rb.serverId).toBe(ra.serverId);
  }, 90_000);

  it("6. cancel_bill is idempotent for the same call, refuses an unknown bill (KB404), another shop's bill, and a reason outside the five", async () => {
    const a = await device();
    const id = await bill(a, "2 kilo chini");
    await sync(a);
    const args = { p_shop_id: shopId, p_bill_local_id: id, p_reason: "wrong_price", p_local_id: crypto.randomUUID(), p_device_id: a.deviceId, p_cancelled_at: new Date().toISOString(), p_replacement_local_id: null };
    const first = await client.rpc("cancel_bill", args);
    expect(first.error).toBeNull();
    const again = await client.rpc("cancel_bill", { ...args, p_local_id: crypto.randomUUID() });
    expect(again.error).toBeNull();
    expect(again.data).toBe(first.data);
    expect(await serverCancellations(id)).toHaveLength(1);

    const unknown = await client.rpc("cancel_bill", { ...args, p_bill_local_id: crypto.randomUUID() });
    expect(unknown.error?.code).toBe("KB404");

    const other = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await other.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb325.local`, password: crypto.randomUUID() })).error).toBeNull();
    const foreign = await other.rpc("cancel_bill", args);
    expect(foreign.error?.code).toBe("KB404"); // another shop's bill is invisible under RLS

    const id2 = await bill(a, "1 kilo besan");
    await sync(a);
    const bad = await client.rpc("cancel_bill", { ...args, p_bill_local_id: id2, p_local_id: crypto.randomUUID(), p_reason: "because" });
    expect(bad.error?.code).toBe("23514");
    expect((await serverBill(id2))!.status).toBe("final"); // the failed call left nothing half-done
  }, 90_000);

  it("7. a cancelled bill still cannot be edited (D18), and the cancellation table is append-only: no update, no delete", async () => {
    const a = await device();
    const id = await bill(a, "2 kilo chini");
    await sync(a);
    await cancel(a, id);
    await sync(a);
    const edit = await client.from("bills").update({ total_paise: 1 }).eq("shop_id", shopId).eq("local_id", id).select("id");
    expect(edit.error).not.toBeNull(); // bills_enforce_immutability: a cancelled bill can never be modified
    expect((await serverBill(id))!.total_paise).not.toBe("1");
    const upd = await client.from("bill_cancellations").update({ reason: "other" }).eq("shop_id", shopId).eq("bill_local_id", id).select("id");
    expect(upd.data ?? []).toHaveLength(0);
    const del = await client.from("bill_cancellations").delete().eq("shop_id", shopId).eq("bill_local_id", id).select("id");
    expect(del.data ?? []).toHaveLength(0);
    expect((await serverCancellations(id))[0].reason).toBe("wrong_price");
  }, 60_000);

  it("8. the replacement link both ways, on another device: the cancelled bill is 'replaced by', the new one 'replaces' - no bills column", async () => {
    const a = await device();
    const b = await device();
    const original = await bill(a, "2 kilo chini");
    const replacement = crypto.randomUUID();
    await sync(a);
    await cancel(a, original, replacement);
    await finaliseBill(a.db, draft(a.deviceId, replacement, "2 kilo chini 48 wala"));
    await sync(a);
    expect((await serverCancellations(original))[0].replacement_local_id).toBe(replacement);
    await pullAll(b);
    await sync(b);
    const infoOriginal = await loadCancellationInfo(b.db, original);
    const infoReplacement = await loadCancellationInfo(b.db, replacement);
    expect(infoOriginal.replacedBy?.localId).toBe(replacement);
    expect(infoReplacement.replaces?.localId).toBe(original);
    expect(infoReplacement.replaces?.receiptNumber).toBe((await serverBill(original))!.receipt_number);
    expect((await serverBill(replacement))!.receipt_number).not.toBe((await serverBill(original))!.receipt_number);
  }, 90_000);

  it("9. a bill whose OWN push is in permanent conflict: cancelling it works on the phone only - nothing reaches the server, the conflict stays visible", async () => {
    const a = await device();
    const id = await bill(a, "2 kilo chini");
    await a.db.bills.update(id, { totalPaise: 1, subtotalPaise: 1 }); // the totals no longer add up: push_bill answers KB422
    await sync(a);
    expect((await a.db.bills.get(id))!.syncStatus).toBe("conflict");
    expect(await serverBill(id)).toBeUndefined();

    expect(await cancel(a, id)).toEqual({ ok: true });
    await sync(a);
    expect((await a.db.bills.get(id))!.status).toBe("cancelled");
    expect((await a.db.bills.get(id))!.syncStatus).toBe("conflict"); // still counted by the sync chip as needing attention
    expect((await a.db.billCancellations.get(id))!.syncStatus).toBe("pending"); // never pushed for a bill the server does not have
    expect(await serverBill(id)).toBeUndefined();
    expect(await serverCancellations(id)).toHaveLength(0);
  }, 60_000);
});
