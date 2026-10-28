import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { compareBill, type BillMetricsRow, type CancellationInput, type GateInput } from "@/domain/billMetrics";
import type { KiranaBillDB, LocalBillMetrics, SyncStatus } from "./db";

// KB-404 (docs/07-DECISIONS.md D80): the per-bill measurements. Written locally AFTER the bill commits, in their own
// transaction - a metrics failure never fails a bill, and no number here is ever read back into one. Pushed after the bills
// (append-only; a unique (shop, bill) key makes a retry a no-op), pulled for the shop's other devices, and read by the
// Developer-mode panel and scripts/pilot/gate.sql. NUMBERS AND ENUMS ONLY: no customer name or mobile, no transcript.

/** Save one bill's measurements (idempotent: a bill has one row). */
export async function saveBillMetrics(localDb: KiranaBillDB, shopId: string, row: BillMetricsRow): Promise<void> {
  const nowIso = new Date().toISOString();
  const existing = await localDb.billMetrics.get(row.billLocalId);
  if (existing) return;
  await localDb.billMetrics.add({ ...row, shopId, localId: crypto.randomUUID(), syncStatus: "pending", updatedAt: nowIso });
}

const toServer = (m: LocalBillMetrics, billId: string) => ({
  shop_id: m.shopId,
  bill_id: billId,
  bill_local_id: m.billLocalId,
  device_id: m.deviceId,
  local_id: m.localId,
  receipt_number: m.receiptNumber,
  total_paise: m.totalPaise,
  line_count: m.lineCount,
  turns: m.turns,
  seconds_to_bill: m.secondsToBill,
  utterances: m.utterances.map((u) => ({ path: u.path, stop_to_transcript_ms: u.stopToTranscriptMs, transcript_to_items_ms: u.transcriptToItemsMs })),
  finalise_to_receipt_ms: m.finaliseToReceiptMs,
  number_ms: m.numberMs ?? null,
  voice_lines: m.voiceLines,
  edited_lines: m.editedLines,
  manual_lines: m.manualLines,
  removed_lines: m.removedLines,
  not_added: m.notAdded,
  flags_raised: m.flagsRaised,
  flags_acknowledged: m.flagsAcknowledged,
  recorded_at: m.recordedAt,
});

const PERMANENT = (e: PostgrestError | null) => !!e && typeof e.code === "string" && (e.code.startsWith("23") || e.code === "42501" || e.code.startsWith("22"));

/** After the bills: only for a bill whose own push succeeded. A 23505 means a previous attempt landed - success. */
export async function pushBillMetrics(client: SupabaseClient, localDb: KiranaBillDB): Promise<{ anyTransientFailure: boolean }> {
  const pending = await localDb.billMetrics.where("syncStatus").equals("pending").toArray();
  let anyTransientFailure = false;
  for (const m of pending) {
    const bill = await localDb.bills.get(m.billLocalId);
    if (!bill?.serverId || bill.syncStatus !== "synced") continue;
    const { error } = await client.from("bill_metrics").insert(toServer(m, bill.serverId));
    if (error && error.code !== "23505") {
      if (PERMANENT(error)) {
        await localDb.billMetrics.update(m.billLocalId, { syncStatus: "conflict" as SyncStatus });
        console.warn(`[sync] billMetrics: permanent failure for localId=${m.localId}: ${error.code}`); // only the code
      } else anyTransientFailure = true;
      continue;
    }
    await localDb.billMetrics.update(m.billLocalId, { syncStatus: "synced" as SyncStatus, updatedAt: new Date().toISOString() });
  }
  return { anyTransientFailure };
}

const PULL_PAGE = 200;
const OVERLAP_MS = 60_000;

/** The shop's other devices' rows (the gate reads across devices). Server stamp cursor, 60 s overlap; a row already here is kept. */
export async function pullBillMetrics(client: SupabaseClient, localDb: KiranaBillDB, shopId: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    const key = `billMetrics:${shopId}`;
    let newest = (await localDb.syncState.get(key))?.lastSyncedAt ?? null;
    const from = newest ? new Date(new Date(newest).getTime() - OVERLAP_MS).toISOString() : null;
    let after: { at: string; id: string } | null = null;
    for (;;) {
      let q = client.from("bill_metrics").select("*").eq("shop_id", shopId).order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(PULL_PAGE);
      if (after) q = q.or(`updated_at.gt.${after.at},and(updated_at.eq.${after.at},id.gt.${after.id})`);
      else if (from) q = q.gt("updated_at", from);
      const { data, error } = await q;
      if (error || !data) {
        console.warn(`[sync] billMetrics pull failed: ${error?.code ?? "no data"}`);
        return;
      }
      const have = await localDb.billMetrics.bulkGet(data.map((r) => r.bill_local_id as string));
      const fresh = data.flatMap((r, i): LocalBillMetrics[] =>
        have[i]
          ? []
          : [
              {
                billLocalId: r.bill_local_id as string,
                shopId,
                localId: r.local_id as string,
                serverId: r.id as string,
                syncStatus: "synced",
                updatedAt: r.updated_at as string,
                deviceId: r.device_id as string,
                receiptNumber: r.receipt_number as string,
                totalPaise: Number(r.total_paise),
                lineCount: r.line_count as number,
                turns: r.turns as number,
                secondsToBill: r.seconds_to_bill as number,
                utterances: ((r.utterances as Record<string, unknown>[]) ?? []).map((u) => ({
                  path: u.path as "fastpath" | "voice" | "failed",
                  stopToTranscriptMs: (u.stop_to_transcript_ms as number | null) ?? null,
                  transcriptToItemsMs: (u.transcript_to_items_ms as number | null) ?? null,
                })),
                finaliseToReceiptMs: (r.finalise_to_receipt_ms as number | null) ?? null,
                numberMs: (r.number_ms as number | null) ?? null,
                voiceLines: r.voice_lines as number,
                editedLines: r.edited_lines as number,
                manualLines: r.manual_lines as number,
                removedLines: r.removed_lines as number,
                notAdded: r.not_added as number,
                flagsRaised: r.flags_raised as number,
                flagsAcknowledged: r.flags_acknowledged as number,
                recordedAt: new Date(r.recorded_at as string).toISOString(),
              },
            ],
      );
      if (fresh.length > 0) await localDb.billMetrics.bulkAdd(fresh);
      const last = data[data.length - 1];
      if (last) {
        after = { at: last.updated_at as string, id: last.id as string };
        if (!newest || new Date(last.updated_at as string) > new Date(newest)) newest = last.updated_at as string;
      }
      if (data.length < PULL_PAGE || !last) break;
    }
    await localDb.syncState.put({ tableName: key, lastSyncedAt: newest, cursor: null, pendingCount: 0 });
  } catch (err) {
    console.warn(`[sync] billMetrics pull stopped: ${err instanceof Error ? err.name : "error"}`); // never a message - it can echo a row
  }
}

/** The inputs of the gate report from this phone's own data (its rows plus the other devices' pulled ones). */
export async function loadGateInputs(localDb: KiranaBillDB, shopId: string): Promise<{ inputs: GateInput[]; cancellations: CancellationInput[] }> {
  const metrics = await localDb.billMetrics.where("shopId").equals(shopId).toArray();
  const cancelRows = await localDb.billCancellations.where("shopId").equals(shopId).toArray();
  const reissues = new Set(cancelRows.flatMap((c) => (c.replacementLocalId ? [c.replacementLocalId] : [])));
  const bills = await localDb.bills.bulkGet([...new Set([...metrics.map((m) => m.billLocalId), ...cancelRows.map((c) => c.billLocalId)])]);
  const byId = new Map(bills.flatMap((b) => (b ? [[b.localId, b] as const] : [])));
  const inputs = metrics.flatMap((m): GateInput[] => {
    const b = byId.get(m.billLocalId);
    if (!b || (b.status !== "final" && b.status !== "cancelled")) return []; // its bill has not arrived yet
    return [{ metrics: m, status: b.status, finalizedAt: b.finalizedAt ?? b.createdAt, isReissue: reissues.has(m.billLocalId) }];
  });
  const cancellations = cancelRows.flatMap((c): CancellationInput[] => {
    const b = byId.get(c.billLocalId);
    return b ? [{ reason: c.reason, billFinalizedAt: b.finalizedAt ?? b.createdAt }] : [];
  });
  return { inputs, cancellations };
}

export interface ReconcileResult {
  /** Bills made on this phone that were compared. */
  readonly checked: number;
  readonly problems: readonly { readonly receiptNumber: string; readonly problems: readonly string[] }[];
  /** false when the server could not be asked (offline, error) - nothing is claimed either way. */
  readonly asked: boolean;
}

/**
 * "No bill lost or corrupted" (06 release gate): every finalised bill MADE ON THIS PHONE is on the server with the same
 * receipt number, total and item count - and none is stuck unsynced. Read-only; the server is asked for the bills, nothing
 * is written. (scripts/pilot/gate.sql checks the same thing from the server's side.)
 */
export async function reconcileBills(client: SupabaseClient, localDb: KiranaBillDB, shopId: string): Promise<ReconcileResult> {
  const mine = (await localDb.bills.where("shopId").equals(shopId).toArray()).filter((b) => (b.status === "final" || b.status === "cancelled") && !b.pulledAt);
  const server = new Map<string, { receiptNumber: string; totalPaise: number; lineCount: number; status: "draft" | "final" | "cancelled" }>();
  for (let i = 0; i < mine.length; i += 50) {
    const ids = mine.slice(i, i + 50).map((b) => b.localId);
    const { data, error } = await client.from("bills").select("local_id, receipt_number, total_paise, status, bill_items(count)").eq("shop_id", shopId).in("local_id", ids);
    if (error || !data) return { checked: 0, problems: [], asked: false };
    for (const r of data as unknown as { local_id: string; receipt_number: string; total_paise: string | number; status: "draft" | "final" | "cancelled"; bill_items: { count: number }[] }[]) {
      server.set(r.local_id, { receiptNumber: r.receipt_number, totalPaise: Number(r.total_paise), lineCount: r.bill_items[0]?.count ?? 0, status: r.status });
    }
  }
  const problems: { receiptNumber: string; problems: string[] }[] = [];
  for (const b of mine) {
    const lineCount = await localDb.billItems.where("billLocalId").equals(b.localId).count();
    const found = compareBill({ receiptNumber: b.receiptNumber, totalPaise: b.totalPaise, lineCount, status: b.status as "final" | "cancelled", syncStatus: b.syncStatus }, server.get(b.localId) ?? null);
    if (found.length > 0) problems.push({ receiptNumber: b.receiptNumber, problems: found });
  }
  return { checked: mine.length, problems, asked: true };
}

/** What the screen counted at Bill Banao. */
export interface FinaliseSnapshot {
  readonly voiceLines: number;
  readonly editedLines: number;
  readonly manualLines: number;
  readonly removedLines: number;
  readonly notAdded: number;
  readonly flagsRaised: number;
  readonly flagsAcknowledged: number;
}

export interface FinalisedInput {
  readonly billLocalId: string;
  readonly deviceId: string;
  readonly turns: number;
  readonly secondsToBill: number;
  readonly utterances: BillMetricsRow["utterances"];
  readonly finaliseToReceiptMs: number | null;
  readonly numberMs?: number | null;
  readonly snapshot: FinaliseSnapshot;
}

/**
 * After the bill is committed and its receipt is on screen: write its measurements. The receipt number, total and item count
 * are READ FROM THE STORED BILL (what the reconciliation compares with the server's). Never throws - a failure here is
 * logged by name only and the bill is untouched.
 */
export async function recordFinalised(localDb: KiranaBillDB, shopId: string, input: FinalisedInput): Promise<boolean> {
  try {
    const bill = await localDb.bills.get(input.billLocalId);
    if (!bill || bill.status !== "final") return false;
    const lineCount = await localDb.billItems.where("billLocalId").equals(input.billLocalId).count();
    await saveBillMetrics(localDb, shopId, {
      billLocalId: input.billLocalId,
      deviceId: input.deviceId,
      receiptNumber: bill.receiptNumber,
      totalPaise: bill.totalPaise,
      lineCount,
      turns: input.turns,
      secondsToBill: input.secondsToBill,
      utterances: input.utterances,
      finaliseToReceiptMs: input.finaliseToReceiptMs === null ? null : Math.max(0, Math.round(input.finaliseToReceiptMs)),
      numberMs: input.numberMs == null ? null : Math.max(0, Math.round(input.numberMs)),
      ...input.snapshot,
      recordedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.warn("[metrics] could not record this bill's measurements:", err instanceof Error ? err.name : "error");
    return false;
  }
}

const COLD_KEY = "coldStarts";
const COLD_KEEP = 20;

/** App cold start (budget < 2 s): one sample per page load, kept on this phone only (it belongs to no bill). */
/** KB-352: the milestones of that start, ms since the page began (js, auth, db, shop, catalog, mic - see ui/coldMarks.ts) plus the page's own load. */
export type ColdPhases = Readonly<Record<string, number>>;

export async function recordColdStart(localDb: KiranaBillDB, ms: number, at: string = new Date().toISOString(), phases?: ColdPhases): Promise<void> {
  try {
    const list = await listColdStarts(localDb);
    const clean = phases ? Object.fromEntries(Object.entries(phases).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0).map(([k, v]) => [k, Math.round(v)])) : undefined;
    await localDb.meta.put({ key: COLD_KEY, value: JSON.stringify([...list, { ms: Math.round(ms), at, ...(clean && Object.keys(clean).length > 0 ? { phases: clean } : {}) }].slice(-COLD_KEEP)) });
  } catch (err) {
    console.warn("[metrics] cold start not recorded:", err instanceof Error ? err.name : "error");
  }
}

export async function listColdStarts(localDb: KiranaBillDB): Promise<{ ms: number; at: string; phases?: ColdPhases }[]> {
  try {
    const parsed: unknown = JSON.parse((await localDb.meta.get(COLD_KEY))?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is { ms: number; at: string; phases?: ColdPhases } => typeof x?.ms === "number" && typeof x?.at === "string") : [];
  } catch {
    return [];
  }
}
