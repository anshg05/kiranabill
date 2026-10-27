import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { gateReport, type UtteranceMetric } from "@/domain/billMetrics";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { pullBills, syncNow } from "./sync";
import { finaliseBill } from "./finalise";
import { cancelBillLocal } from "./cancelBill";
import { loadGateInputs, reconcileBills, recordFinalised, type FinalisedInput } from "./billMetrics";

/**
 * KB-404 (D80) on the real local stack (D21, D32), shipped code: a bill's measurements are pushed AFTER the bill (only for a
 * bill whose own push succeeded), pulled by the shop's other devices, never carry customer data, reconcile against the
 * server's bills, and scripts/pilot/gate.sql reads the same lines the app's report computes. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("KB-404 e2e - bill_metrics (local Postgres)", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const dbs: KiranaBillDB[] = [];

  async function device() {
    const db = new KiranaBillDB(`e2e-metrics-${crypto.randomUUID()}`);
    dbs.push(db);
    const deviceId = crypto.randomUUID();
    return { db, deviceId };
  }
  type Device = Awaited<ReturnType<typeof device>>;
  const lines = (t: string): FinalLine[] =>
    parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item: { ...item, catalogId: null }, original: { ...item, catalogId: null }, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));
  const input = (d: Device, billLocalId: string, over: Partial<FinalisedInput> = {}): FinalisedInput => ({
    billLocalId, deviceId: d.deviceId, turns: 1, secondsToBill: 12, utterances: [{ path: "fastpath", stopToTranscriptMs: 900, transcriptToItemsMs: 120 }], finaliseToReceiptMs: 200,
    snapshot: { voiceLines: 1, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0 }, ...over,
  });
  /** A finalised bill with its measurements; `at` fixes the order of "consecutive". */
  let clock = Date.now() - 3_600_000;
  async function bill(d: Device, over: Partial<FinalisedInput> = {}, t = "2 kilo chini") {
    const localId = crypto.randomUUID();
    clock += 1000;
    await finaliseBill(d.db, { localId, shopId, deviceId: d.deviceId, startedAt: new Date(clock).toISOString(), customer: { name: "Ramesh", mobile: "9876543210" }, lines: lines(t), flags: [], now: new Date(clock) });
    expect(await recordFinalised(d.db, shopId, input(d, localId, over))).toBe(true);
    return localId;
  }
  const sync = (d: Device) => syncNow({ client, localDb: d.db, shopId, deviceId: d.deviceId });
  const serverMetrics = async () => (await pg.query("select * from bill_metrics where shop_id = $1 order by recorded_at", [shopId])).rows;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb404.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-404 e2e", phone: null, catalogMode: "custom_only" })).id;
  }, 60_000);
  afterAll(async () => {
    await pg?.end();
    dbs.forEach((d) => d.close());
  });

  it("1. pushed after the bill: one row with the device's numbers - and NO customer name, mobile, transcript or item name", async () => {
    const a = await device();
    const id = await bill(a, { turns: 2, secondsToBill: 33 });
    await sync(a);
    const rows = (await serverMetrics()).filter((r) => r.bill_local_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ turns: 2, seconds_to_bill: 33, voice_lines: 1, line_count: 1, total_paise: "9000", device_id: a.deviceId });
    const text = JSON.stringify(rows[0]);
    for (const secret of ["Ramesh", "9876543210", "Chini", "chini"]) expect(text).not.toContain(secret);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "bill_id", "bill_local_id", "device_id", "edited_lines", "finalise_to_receipt_ms", "flags_acknowledged", "flags_raised", "id", "line_count", "local_id", "manual_lines", "not_added", "number_ms",
      "receipt_number", "recorded_at", "removed_lines", "seconds_to_bill", "shop_id", "total_paise", "turns", "updated_at", "utterances", "voice_lines",
    ]);
    expect((await a.db.billMetrics.get(id))!.syncStatus).toBe("synced");
  }, 60_000);

  it("2. idempotent: pushing again (a lost reply) leaves one row and still ends 'synced'", async () => {
    const a = await device();
    const id = await bill(a);
    await sync(a);
    await a.db.billMetrics.update(id, { syncStatus: "pending" });
    await sync(a);
    expect((await serverMetrics()).filter((r) => r.bill_local_id === id)).toHaveLength(1);
    expect((await a.db.billMetrics.get(id))!.syncStatus).toBe("synced");
  }, 60_000);

  it("3. a bill whose own push is in permanent conflict never gets its metrics pushed - they stay pending, nothing half-reaches the server", async () => {
    const a = await device();
    const id = await bill(a);
    await a.db.bills.update(id, { totalPaise: 1, subtotalPaise: 1 }); // totals no longer add up: push_bill answers KB422
    await sync(a);
    expect((await a.db.bills.get(id))!.syncStatus).toBe("conflict");
    expect((await a.db.billMetrics.get(id))!.syncStatus).toBe("pending");
    expect((await serverMetrics()).filter((r) => r.bill_local_id === id)).toHaveLength(0);
  }, 60_000);

  it("4. another device of the shop pulls the rows; another shop's member sees none (RLS)", async () => {
    const a = await device();
    const b = await device();
    const id = await bill(a, { turns: 4 });
    await sync(a);
    await pullBills(client, b.db, shopId, { awaitBackfill: true });
    await sync(b);
    expect((await b.db.billMetrics.get(id))!).toMatchObject({ turns: 4, deviceId: a.deviceId, syncStatus: "synced" });
    const { inputs } = await loadGateInputs(b.db, shopId);
    expect(inputs.some((i) => i.metrics.billLocalId === id)).toBe(true);

    const other = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await other.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb404.local`, password: crypto.randomUUID() })).error).toBeNull();
    const seen = await other.from("bill_metrics").select("id").eq("shop_id", shopId);
    expect(seen.data ?? []).toHaveLength(0);
  }, 90_000);

  it("5. reconcile (b): every bill made on this phone matches the server; each kind of difference and a stuck-unsynced bill is named", async () => {
    const a = await device();
    const ok = await bill(a);
    const tampered = await bill(a);
    const waiting = await bill(a);
    await sync(a);
    const clean = await reconcileBills(client, a.db, shopId);
    expect(clean).toMatchObject({ asked: true });
    expect(clean.problems).toEqual([]);

    // the device's copy drifts from the server's: receipt number, total, item count; one never leaves the phone
    await a.db.bills.update(tampered, { receiptNumber: "KB-TAMPERED", totalPaise: 9100 });
    const firstItem = (await a.db.billItems.where("billLocalId").equals(ok).first())!;
    await a.db.billItems.update(firstItem.id!, { qty: 99 }); // not compared (the item COUNT is)
    await a.db.billItems.add({ ...(await a.db.billItems.where("billLocalId").equals(tampered).first())!, id: undefined, lineNo: 9 });
    await a.db.bills.update(waiting, { syncStatus: "pending" });
    const res = await reconcileBills(client, a.db, shopId);
    const by = Object.fromEntries(res.problems.map((p) => [p.receiptNumber, p.problems]));
    expect(by["KB-TAMPERED"]).toEqual([
      expect.stringMatching(/^receipt number differs/),
      "total differs (9100 paise here, 9000 on the server)",
      "item count differs (2 here, 1 on the server)",
    ]);
    const waitingNumber = (await a.db.bills.get(waiting))!.receiptNumber;
    expect(by[waitingNumber]).toEqual(["is still waiting to sync"]);
    expect(Object.keys(by)).toHaveLength(2);
    expect(res.checked).toBe(3);
  }, 90_000);

  it("6. reconcile names a bill that never reached the server, and says 'not asked' when the server cannot be reached", async () => {
    const a = await device();
    const id = await bill(a); // never synced
    const res = await reconcileBills(client, a.db, shopId);
    const number = (await a.db.bills.get(id))!.receiptNumber;
    expect(res.problems.find((p) => p.receiptNumber === number)!.problems).toEqual(["is still waiting to sync", "is not on the server"]);
    const dead = createClient("http://127.0.0.1:9", anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect(await reconcileBills(dead, a.db, shopId)).toEqual({ checked: 0, problems: [], asked: false });
  }, 60_000);
});

describe("KB-404 e2e - scripts/pilot/gate.sql reads the same lines the app computes", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const dbs: KiranaBillDB[] = [];

  beforeAll(async () => {
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb404.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-404 gate", phone: null, catalogMode: "custom_only" })).id;
  }, 60_000);
  afterAll(async () => {
    await pg?.end();
    dbs.forEach((d) => d.close());
  });

  it("a mixed shop on two devices - voice, typing, a cancelled bill, a reissue, hand lines, an edit - gives identical numbers from the SQL and from the report", async () => {
    const mk = async () => {
      const db = new KiranaBillDB(`e2e-gate-${crypto.randomUUID()}`);
      dbs.push(db);
      const deviceId = crypto.randomUUID();
      return { db, deviceId };
    };
    const a = await mk();
    const b = await mk();
    let clock = Date.now() - 3_600_000;
    const lines = (t: string): FinalLine[] =>
      parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item: { ...item, catalogId: null }, original: { ...item, catalogId: null }, displayName: "x", source: "fastpath" as const }));
    const u = (path: UtteranceMetric["path"], stop: number, items: number | null): UtteranceMetric => ({ path, stopToTranscriptMs: stop, transcriptToItemsMs: items });
    async function mkBill(d: typeof a, over: Partial<FinalisedInput>) {
      const localId = crypto.randomUUID();
      clock += 1000;
      await finaliseBill(d.db, { localId, shopId, deviceId: d.deviceId, startedAt: new Date(clock).toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: new Date(clock) });
      await recordFinalised(d.db, shopId, {
        billLocalId: localId, deviceId: d.deviceId, turns: 1, secondsToBill: 10, utterances: [u("fastpath", 1000, 100)], finaliseToReceiptMs: 200,
        snapshot: { voiceLines: 1, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0 }, ...over,
      });
      return localId;
    }
    const snap = (o: Partial<FinalisedInput["snapshot"]> = {}) => ({ voiceLines: 1, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0, ...o });
    // 24 voice bills over two devices (so the window of 20 is full and the oldest 4 fall out), varied
    for (let i = 0; i < 24; i++) {
      const d = i % 2 ? a : b;
      await mkBill(d, {
        turns: 1 + (i % 4 === 0 ? 1 : 0),
        secondsToBill: 8 + i,
        utterances: [u("fastpath", 900 + i * 10, 100 + i), ...(i % 3 === 0 ? [u("voice", 1400 + i, 2000 + i * 5)] : []), ...(i % 7 === 0 ? [u("failed", 1100, null)] : [])],
        finaliseToReceiptMs: 150 + i,
        snapshot: snap({ editedLines: i % 5 === 0 ? 1 : 0, manualLines: i % 6 === 0 ? 1 : 0, removedLines: i % 8 === 0 ? 1 : 0, notAdded: i % 7 === 0 ? 1 : 0 }),
      });
    }
    for (let i = 0; i < 4; i++) await mkBill(a, { turns: 0, secondsToBill: 40 + i, utterances: [], snapshot: snap({ voiceLines: 0, manualLines: 2 }) }); // typing
    const cancelled = await mkBill(a, { turns: 1, secondsToBill: 99 });
    const replacement = crypto.randomUUID();
    await cancelBillLocal(a.db, { shopId, billLocalId: cancelled, reason: "wrong_price", deviceId: a.deviceId, replacementLocalId: replacement });
    clock += 1000;
    await finaliseBill(a.db, { localId: replacement, shopId, deviceId: a.deviceId, startedAt: new Date(clock).toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: new Date(clock) });
    await recordFinalised(a.db, shopId, { billLocalId: replacement, deviceId: a.deviceId, turns: 1, secondsToBill: 77, utterances: [u("voice", 5000, 5000)], finaliseToReceiptMs: 999, snapshot: snap() });
    const otherCancelled = await mkBill(b, { turns: 1 });
    await cancelBillLocal(b.db, { shopId, billLocalId: otherCancelled, reason: "customer_cancelled", deviceId: b.deviceId, replacementLocalId: null });
    for (const d of [a, b]) await syncNow({ client, localDb: d.db, shopId, deviceId: d.deviceId });
    for (const d of [a, b]) await syncNow({ client, localDb: d.db, shopId, deviceId: d.deviceId }); // cancellations and metrics settle

    // the app's report on one device (it holds the other device's pulled rows)
    await pullBills(client, a.db, shopId, { awaitBackfill: true });
    await syncNow({ client, localDb: a.db, shopId, deviceId: a.deviceId });
    const { inputs, cancellations } = await loadGateInputs(a.db, shopId);
    const g = gateReport(inputs, cancellations);

    const sql = readFileSync(join(__dirname, "..", "..", "scripts", "pilot", "gate.sql"), "utf8").replace("00000000-0000-0000-0000-000000000000", shopId);
    const out = Object.fromEntries((await pg.query<{ line: string; value: string | null }>(sql)).rows.map((r) => [r.line, r.value]));
    const n = (x: number | null) => (x === null ? null : String(x));

    expect(g.voice.n).toBe(20);
    expect(out.voice_bills_in_window).toBe(String(g.voice.n));
    expect(out.turns_median).toBe(n(g.turns.median));
    expect(out.seconds_voice_median).toBe(n(g.seconds.voice.median));
    expect(out.seconds_typed_median).toBe(n(g.seconds.typed.median));
    expect(out.seconds_typed_n).toBe(String(g.seconds.typed.n));
    expect([out.coverage_fastpath, out.coverage_llm, out.coverage_failed, out.coverage_pct]).toEqual([String(g.coverage.fastpath), String(g.coverage.llm), String(g.coverage.failed), n(g.coverage.pct)]);
    expect([out.zero_edit_zero, out.zero_edit_of, out.zero_edit_pct, out.needing_hands]).toEqual([String(g.zeroEdit.zero), String(g.zeroEdit.of), n(g.zeroEdit.pct), String(g.zeroEdit.needingHands)]);
    for (const [k, s] of [["stop_to_transcript", g.latency.stopToTranscript], ["fastpath_to_items", g.latency.fastpathToItems], ["llm_to_items", g.latency.llmToItems]] as const) {
      expect([out[`${k}_median_ms`], out[`${k}_p95_ms`], out[`${k}_n`]], k).toEqual([n(s.median), n(s.p95), String(s.n)]);
    }
    expect([out.finalise_to_receipt_median_ms, out.finalise_to_receipt_p95_ms, out.finalise_to_receipt_n]).toEqual([n(g.finaliseToReceipt.median), n(g.finaliseToReceipt.p95), String(g.finaliseToReceipt.n)]);
    expect(out.escaped_errors).toBe(String(g.escapedErrors));
    // sanity: these are real, non-trivial numbers, and the excluded bills really are out
    expect(g.coverage.llm).toBeGreaterThan(0);
    expect(g.coverage.failed).toBeGreaterThan(0);
    expect(g.zeroEdit.needingHands).toBeGreaterThan(0);
    expect(g.escapedErrors).toBe(1); // the cancelled-for-wrong-price bill; "customer cancelled" is not an error
    expect(out.reconciliation_problems).toBe("0");
    expect(Number(out.reconciliation_checked)).toBeGreaterThan(24);
  }, 240_000);
});
