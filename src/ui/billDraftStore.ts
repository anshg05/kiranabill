import type { KiranaBillDB } from "@/data/db";
import { CASH, isStorableMobile, isStorableName } from "@/domain/customer";
import type { BillRow, BillState } from "./useBillLines";

// KB-313 (owner, 8 Oct 2026): the half-built bill, kept so a reload, Android killing the backgrounded tab or a
// crash never loses it (02, 05 §9, 16 §6). It lives in the `meta` table of the signed-in user's OWN database
// (D38: `kiranabill-<userId>`), never the shared device database - one user's bill must never show for another
// user on the same phone - one key per shop. No expiry. A restored line keeps the price it had: nothing here
// ever looks at the catalog (hard rule 7); the flags are re-derived from the lines by the hook, as always.

export const DRAFT_VERSION = 1;
/** A burst of edits is one write. */
export const DRAFT_SAVE_DELAY_MS = 250;

export const draftKey = (shopId: string): string => `billDraft:${shopId}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNullOr = <T>(v: unknown, test: (x: unknown) => x is T): v is T | null => v === null || test(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Money is integer paise (hard rule 1) - and a safe one. */
const isPaise = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const SOURCES = new Set(["voice", "fastpath", "manual"]);

function validItem(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.spokenName) &&
    isNullOr(v.catalogId, isStr) &&
    typeof v.isCustom === "boolean" &&
    isStr(v.matchStatus) &&
    isNullOr(v.qty, isNum) &&
    isStr(v.unit) &&
    isNullOr(v.rate, isPaise) &&
    isNullOr(v.rateUnit, isStr) &&
    isNullOr(v.total, isPaise) &&
    isStr(v.priceType)
  );
}

function validRow(v: unknown): v is BillRow {
  return isObj(v) && isStr(v.id) && isNum(v.utteranceId) && validItem(v.item) && validItem(v.original) && isStr(v.displayName) && isStr(v.source) && SOURCES.has(v.source);
}

function validUtterance(v: unknown): boolean {
  return (
    isObj(v) &&
    isNum(v.id) &&
    Array.isArray(v.lineIds) &&
    v.lineIds.every(isStr) &&
    Array.isArray(v.flags) &&
    v.flags.every((f) => isObj(f) && isStr(f.id) && isStr(f.code) && isStr(f.severity) && isStr(f.message) && isNullOr(f.itemIndex, isNum)) &&
    (v.transcript === undefined || isStr(v.transcript))
  );
}

export function serializeBill(state: BillState): string {
  return JSON.stringify({
    v: DRAFT_VERSION,
    localId: state.localId,
    startedAt: state.startedAt,
    rows: state.rows,
    utterances: state.utterances,
    nextId: state.nextId,
    acknowledged: [...state.acknowledged],
    // a retry in flight died with the page: it comes back as "not added" with its transcript, Retry still works
    notAdded: state.notAdded.map((n) => ({ id: n.id, transcript: n.transcript, message: n.message })),
    nextNotAddedId: state.nextNotAddedId,
    customer: state.customer,
    discarded: state.discarded,
  });
}

/** The bill as it was left, or null if the text is anything but a whole, valid draft - never throws. */
export function parseStoredBill(text: string): BillState | null {
  try {
    const d: unknown = JSON.parse(text);
    if (!isObj(d) || d.v !== DRAFT_VERSION) return null;
    if (!isStr(d.localId) || d.localId === "" || !isStr(d.startedAt)) return null;
    if (!Array.isArray(d.rows) || !d.rows.every(validRow)) return null;
    if (!Array.isArray(d.utterances) || !d.utterances.every(validUtterance)) return null;
    if (!isNum(d.nextId) || !isNum(d.nextNotAddedId)) return null;
    if (!Array.isArray(d.acknowledged) || !d.acknowledged.every(isStr)) return null;
    if (!Array.isArray(d.discarded) || !d.discarded.every(validRow)) return null;
    if (
      !Array.isArray(d.notAdded) ||
      !d.notAdded.every((n) => isObj(n) && isStr(n.id) && isStr(n.transcript) && isStr(n.message))
    ) {
      return null;
    }
    const c = d.customer;
    if (!isObj(c) || !isStr(c.name) || !isStorableName(c.name) || !isNullOr(c.mobile, isStr) || !isStorableMobile(c.mobile)) return null;
    return {
      localId: d.localId,
      startedAt: d.startedAt,
      rows: d.rows as BillRow[],
      utterances: d.utterances as BillState["utterances"],
      nextId: d.nextId,
      removed: null,
      acknowledged: new Set(d.acknowledged as string[]),
      notAdded: (d.notAdded as { id: string; transcript: string; message: string }[]).map((n) => ({ id: n.id, transcript: n.transcript, message: n.message, retrying: false })),
      nextNotAddedId: d.nextNotAddedId,
      focusLineId: null,
      customer: { name: c.name, mobile: c.mobile },
      discarded: d.discarded as BillRow[],
    };
  } catch {
    return null;
  }
}

/** Worth keeping: a line, a heard-but-not-added utterance, or a typed customer. Not an empty bill. */
export function isWorthSaving(state: BillState): boolean {
  return state.rows.length > 0 || state.notAdded.length > 0 || state.customer.name !== CASH || state.customer.mobile !== null;
}

export async function saveDraft(db: KiranaBillDB, shopId: string, state: BillState): Promise<void> {
  if (!isWorthSaving(state)) {
    await db.meta.delete(draftKey(shopId));
    return;
  }
  await db.meta.put({ key: draftKey(shopId), value: serializeBill(state) });
}

export async function clearDraft(db: KiranaBillDB, shopId: string): Promise<void> {
  await db.meta.delete(draftKey(shopId));
}

/** The saved draft, or null - a damaged one is removed rather than left to fail every start. */
export async function loadDraft(db: KiranaBillDB, shopId: string): Promise<BillState | null> {
  const row = await db.meta.get(draftKey(shopId));
  if (!row) return null;
  const state = parseStoredBill(row.value);
  if (!state) await clearDraft(db, shopId);
  return state;
}
