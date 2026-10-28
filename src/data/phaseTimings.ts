import type { KiranaBillDB } from "./db";

// KB-352 (owner, 28 Oct 2026): where the time goes after Bill Banao, per bill - kept ON THIS PHONE ONLY, in the device's meta table (never
// synced, no migration). Numbers only: whole milliseconds. A timing can never fail a bill: every failure here is swallowed.

export type PhaseName = "number" | "write" | "read" | "paint" | "learning" | "reload" | "sync";
export const PHASE_NAMES: readonly PhaseName[] = ["number", "write", "read", "paint", "learning", "reload", "sync"];
export type PhaseRow = { readonly billLocalId: string } & Partial<Record<PhaseName, number>>;

const KEY = "billPhases";
export const PHASES_KEEP = 40;

/** The paint and the background steps write the same row at different moments - one writer at a time, so none is lost. */
let queue: Promise<unknown> = Promise.resolve();

export async function listPhases(localDb: KiranaBillDB): Promise<PhaseRow[]> {
  try {
    const parsed: unknown = JSON.parse((await localDb.meta.get(KEY))?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is PhaseRow => typeof r?.billLocalId === "string") : [];
  } catch {
    return [];
  }
}

export function recordPhases(localDb: KiranaBillDB, billLocalId: string, phases: Partial<Record<PhaseName, number>>): Promise<void> {
  const write = async (): Promise<void> => {
    try {
      const rows = await listPhases(localDb);
      const at = rows.findIndex((r) => r.billLocalId === billLocalId);
      const row: Record<string, unknown> = { ...(at >= 0 ? rows[at] : { billLocalId }) };
      for (const name of PHASE_NAMES) {
        const v = phases[name];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) row[name] = Math.round(v);
      }
      if (at >= 0) rows[at] = row as PhaseRow;
      else rows.push(row as PhaseRow);
      await localDb.meta.put({ key: KEY, value: JSON.stringify(rows.slice(-PHASES_KEEP)) });
    } catch (err) {
      console.warn("[phases] not recorded:", err instanceof Error ? err.name : "error");
    }
  };
  queue = queue.then(write, write);
  return queue as Promise<void>;
}
