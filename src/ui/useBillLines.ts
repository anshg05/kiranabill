import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CatalogEntry } from "@/domain/catalog";
import {
  acknowledgementScopes,
  billFlags,
  editAmount,
  editQty,
  editRate,
  editUnit,
  isEdited,
  pendingChecks,
  type BillEntry,
  type PlacedFlag,
  type UtteranceRecord,
} from "@/domain/billEdit";
import { evaluateReviewFlags, type ReviewFlag } from "@/domain/reviewFlags";
import type { ParsedItem } from "@/domain/grammar";
import { CASH, parseCustomerName, parseIndianMobile } from "@/domain/customer";
import { amountNeeded, visibleFlags, type FinalFlag, type FinalLine } from "@/domain/finalBill";
import type { LearnDiscarded } from "@/domain/learning";
import type { BillLine } from "@/data/voiceBilling";
import type { KiranaBillDB } from "@/data/db";
import { DRAFT_SAVE_DELAY_MS, clearDraft, loadDraft, saveDraft } from "./billDraftStore";

// KB-303: the bill being built - its lines (each with a stable id, the
// utterance it came from, and what was spoken), editing, removing with a
// one-level undo, and the bill's flags re-derived after every change
// (domain/billEdit.ts billFlags). The app never changes a number itself: a
// line changes only through the shopkeeper's edit. KB-313: with a `persist`
// target the half-built bill is kept in the user's own database and comes back
// after a reload (billDraftStore.ts).

export interface BillRow extends BillEntry {
  readonly displayName: string;
  readonly source: BillLine["source"];
}

export type EditField = "qty" | "rate" | "amount" | "unit";

/**
 * KB-319 (KI-57; owner, 2 Oct 2026): an utterance that was heard but whose
 * items couldn't be read (parse 5xx / 429 / timeout / network). It stays on
 * the bill until the shopkeeper retries or dismisses it, and counts as a
 * pending check - nothing said goes unbilled unnoticed.
 */
export interface NotAdded {
  readonly id: string;
  readonly transcript: string;
  readonly retrying: boolean;
  /** Why it isn't on the bill yet. */
  readonly message: string;
}

/** The not-added reason after a parse that failed (5xx, 429, timeout, network). */
export const PARSE_FAILED = "Couldn't read the items";

/** How long "Chini removed — Undo" stays (owner: one level of undo). */
export const UNDO_MS = 6_000;

export interface BillState {
  /** KB-307: the bill's identity from the moment it starts - bills.local_id
   * (a UUID, D37) and created_at. Finalising twice under one localId writes
   * one bill (data/finalise.ts). */
  readonly localId: string;
  readonly startedAt: string;
  readonly rows: readonly BillRow[];
  readonly utterances: readonly UtteranceRecord[];
  readonly nextId: number;
  /** The last removal, for one-level undo. */
  readonly removed: { readonly row: BillRow; readonly at: number } | null;
  /** KB-304: the flag keys the shopkeeper said "Theek hai" to. Kept through a
   * removal, so Undo brings a line back acknowledged; cleared for a line (and
   * its utterance's bill-level checks) when that line is edited. */
  readonly acknowledged: ReadonlySet<string>;
  readonly notAdded: readonly NotAdded[];
  readonly nextNotAddedId: number;
  /** KB-305: the line added by hand whose qty editor opens - until the next change. */
  readonly focusLineId: string | null;
  /** KB-306 (D6, D52): who the bill is for - "Cash" by default, mobile optional
   * (10 digits). Only valid values reach here; it never touches the lines. */
  readonly customer: Customer;
  /** KB-307 commit 3: lines removed and not brought back - learning's
   * "deleted a line" signal (08 §2), kept on the saved bill locally. */
  readonly discarded: readonly BillRow[];
}

export interface BillDraft {
  readonly localId: string;
  readonly startedAt: string;
  readonly customer: Customer;
  readonly lines: readonly FinalLine[];
  readonly flags: readonly FinalFlag[];
  readonly discarded: readonly LearnDiscarded[];
}

export interface Customer {
  readonly name: string;
  readonly mobile: string | null;
}

type Action =
  | { type: "add"; lines: readonly BillLine[]; flags: readonly ReviewFlag[]; transcript: string; resolves?: string; focus?: boolean }
  | { type: "fail"; transcript: string }
  | { type: "retrying"; id: string }
  | { type: "retryFailed"; id: string; message: string }
  | { type: "dismiss"; id: string }
  | { type: "customer"; customer: Partial<Customer> }
  | { type: "reset" }
  | { type: "restore"; state: BillState }
  | { type: "replace"; id: string; row: BillRow }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "forget" }
  | { type: "acknowledge"; key: string };

export const EMPTY_BILL: BillState = { localId: "", startedAt: "", rows: [], utterances: [], nextId: 1, removed: null, acknowledged: new Set(), notAdded: [], nextNotAddedId: 1, focusLineId: null, customer: { name: CASH, mobile: null }, discarded: [] };

/** KB-307: a fresh, empty bill - "New bill" after finalising, and the first bill. */
export function newBill(): BillState {
  return { ...EMPTY_BILL, localId: crypto.randomUUID(), startedAt: new Date().toISOString() };
}

const updateNotAdded = (state: BillState, id: string, change: Partial<NotAdded>): BillState => ({
  ...state,
  notAdded: state.notAdded.map((n) => (n.id === id ? { ...n, ...change } : n)),
});

export function billReducer(state: BillState, action: Action): BillState {
  switch (action.type) {
    case "add": {
      // KB-319: a Retry's lines land only while its entry is still listed -
      // once added or dismissed, a late or second answer adds nothing.
      if (action.resolves !== undefined && !state.notAdded.some((n) => n.id === action.resolves)) return state;
      if (action.lines.length === 0) return state;
      const utteranceId = state.utterances.length + 1;
      const rows = action.lines.map((line, i): BillRow => ({
        id: `l${state.nextId + i}`,
        utteranceId,
        item: line.item,
        original: line.item,
        displayName: line.displayName,
        source: line.source,
      }));
      return {
        ...state,
        rows: [...state.rows, ...rows],
        utterances: [...state.utterances, { id: utteranceId, lineIds: rows.map((r) => r.id), flags: action.flags, transcript: action.transcript }],
        nextId: state.nextId + rows.length,
        notAdded: action.resolves === undefined ? state.notAdded : state.notAdded.filter((n) => n.id !== action.resolves),
        focusLineId: action.focus ? rows[0]!.id : null,
      };
    }
    case "fail":
      return {
        ...state,
        notAdded: [...state.notAdded, { id: `n${state.nextNotAddedId}`, transcript: action.transcript, retrying: false, message: PARSE_FAILED }],
        nextNotAddedId: state.nextNotAddedId + 1,
      };
    case "retrying":
      return updateNotAdded(state, action.id, { retrying: true });
    case "retryFailed":
      return updateNotAdded(state, action.id, { retrying: false, message: action.message });
    case "dismiss":
      return { ...state, notAdded: state.notAdded.filter((n) => n.id !== action.id) };
    case "customer":
      return { ...state, customer: { ...state.customer, ...action.customer } };
    case "reset":
      return newBill();
    case "restore":
      // KB-313: only onto a bill nobody has started - a late restore never wipes lines already added.
      return state.rows.length === 0 && state.notAdded.length === 0 && state.customer.name === CASH && state.customer.mobile === null ? action.state : state;
    case "replace": {
      // KB-304 (owner): an acknowledgement lapses on any edit to its line.
      const scopes = acknowledgementScopes(action.row.id, action.row.utteranceId);
      const acknowledged = new Set([...state.acknowledged].filter((k) => !scopes.some((s) => k.startsWith(s))));
      return { ...state, rows: state.rows.map((r) => (r.id === action.id ? action.row : r)), acknowledged, focusLineId: null };
    }
    case "acknowledge":
      return { ...state, acknowledged: new Set([...state.acknowledged, action.key]) };
    case "remove": {
      const at = state.rows.findIndex((r) => r.id === action.id);
      if (at === -1) return state;
      return {
        ...state,
        rows: state.rows.filter((r) => r.id !== action.id),
        removed: { row: state.rows[at]!, at },
        focusLineId: null,
        discarded: [...state.discarded, state.rows[at]!],
      };
    }
    case "undo": {
      if (!state.removed) return state;
      const rows = [...state.rows];
      rows.splice(Math.min(state.removed.at, rows.length), 0, state.removed.row);
      const back = state.removed.row.id;
      return { ...state, rows, removed: null, discarded: state.discarded.filter((r) => r.id !== back) };
    }
    case "forget":
      return state.removed ? { ...state, removed: null } : state;
  }
}

/** KB-304: a placed flag, and whether the shopkeeper said "Theek hai" to it. */
export interface ShownFlag extends PlacedFlag {
  readonly acknowledged: boolean;
}

export interface BillLines {
  readonly rows: readonly BillRow[];
  readonly flags: readonly ShownFlag[];
  /** Unacknowledged HIGH flags, lines that need an amount ("Price needed" -
   * KB-307 decision 2) and not-added utterances - "N checks pending". Bill
   * Banao waits for 0. */
  readonly pending: number;
  /** KB-307: this bill's id and start time; reset() starts the next bill. */
  readonly localId: string;
  readonly startedAt: string;
  reset: () => void;
  /** KB-313: the saved draft (if any) has been looked at - false only while it loads. */
  readonly ready: boolean;
  discardDraft: () => Promise<void>;
  clearBill: () => Promise<void>;
  /** KB-307: everything data/finalise.ts needs, as the screen holds it now. */
  readonly draft: BillDraft;
  /** KB-319: heard, not on the bill yet - Retry or dismiss. */
  readonly notAdded: readonly NotAdded[];
  /** The line "Undo" would bring back, while it can. */
  readonly removed: BillRow | null;
  /** `resolves`: the not-added entry a Retry is filling - ignored if it's gone. */
  add: (lines: readonly BillLine[], flags: readonly ReviewFlag[], transcript?: string, resolves?: string) => void;
  /** KB-305: a line added by hand (source "manual"), its own entry - so
   * already_on_bill / duplicate_line work against voice lines; its qty editor opens. */
  addByHand: (item: ParsedItem, displayName: string) => void;
  /** KB-305: the hand-added line whose qty editor is open, or null. */
  readonly focusLineId: string | null;
  readonly customer: Customer;
  /** KB-306: commit a typed name / mobile; returns the message to show, or null when stored. */
  setCustomerName: (text: string) => string | null;
  setCustomerMobile: (text: string) => string | null;
  fail: (transcript: string) => void;
  retrying: (id: string) => void;
  retryFailed: (id: string, message: string) => void;
  dismiss: (id: string) => void;
  /** Commits a typed value; returns the message to show, or null when applied. */
  edit: (id: string, field: EditField, value: string) => string | null;
  remove: (id: string) => void;
  undo: () => void;
  acknowledge: (key: string) => void;
}

/** KB-313: where the half-built bill is kept - the signed-in user's own database (D38), one key per shop. */
export interface BillPersist {
  readonly db: KiranaBillDB;
  readonly shopId: string;
}

export function useBillLines(catalog: readonly CatalogEntry[], persist?: BillPersist): BillLines {
  const [state, dispatch] = useReducer(billReducer, undefined, newBill);
  const db = persist?.db ?? null;
  const shopId = persist?.shopId ?? null;
  // ready: the saved draft (if any) has been looked at. Without a database there is nothing to wait for.
  const [ready, setReady] = useState(persist === undefined);
  // After Bill Banao until the next bill: the saved bill's draft must not come back.
  const frozen = useRef(false);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!db || !shopId) return;
    let live = true;
    void (async () => {
      try {
        const stored = await loadDraft(db, shopId);
        if (!stored || !live) return;
        if (await db.bills.get(stored.localId)) {
          await clearDraft(db, shopId); // finalised meanwhile (a crash right after Bill Banao) - never re-finalise it
          return;
        }
        dispatch({ type: "restore", state: stored });
      } catch (err) {
        console.warn("[billDraft] restore failed:", err instanceof Error ? err.message : err);
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [db, shopId]);

  // Keep it: shortly after every change, and at once when the page is hidden or closed.
  useEffect(() => {
    if (!db || !shopId || !ready) return;
    const timer = setTimeout(() => {
      if (!frozen.current) void saveDraft(db, shopId, latest.current).catch((err: unknown) => console.warn("[billDraft] save failed:", err instanceof Error ? err.message : err));
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [db, shopId, ready, state]);
  useEffect(() => {
    if (!db || !shopId || !ready) return;
    const flush = () => {
      if (!frozen.current) void saveDraft(db, shopId, latest.current).catch((err: unknown) => console.warn("[billDraft] save failed:", err instanceof Error ? err.message : err));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [db, shopId, ready]);

  const placed = useMemo(() => billFlags(state.rows, state.utterances, catalog), [state.rows, state.utterances, catalog]);
  // KB-307: on a line that needs an amount, "Price needed" replaces
  // missing_total / incomplete_item - one line is never two checks, and a
  // "Theek hai" can never pass an unpriced line.
  const visible = useMemo(() => visibleFlags(placed, state.rows), [placed, state.rows]);
  const flags = useMemo(() => visible.map((f) => ({ ...f, acknowledged: state.acknowledged.has(f.key) })), [visible, state.acknowledged]);
  const pending = useMemo(
    () => pendingChecks(visible, state.acknowledged) + state.rows.filter((r) => amountNeeded(r.item) !== null).length + state.notAdded.length,
    [visible, state.acknowledged, state.rows, state.notAdded],
  );
  const draft = useMemo(
    () => ({
      localId: state.localId,
      startedAt: state.startedAt,
      customer: state.customer,
      lines: state.rows,
      flags,
      discarded: state.discarded.map((r) => ({ spokenName: r.item.spokenName || null, shopProductId: r.item.catalogId, source: r.source })),
    }),
    [state.localId, state.startedAt, state.customer, state.rows, flags, state.discarded],
  );

  // One level of undo, for UNDO_MS.
  useEffect(() => {
    if (!state.removed) return;
    const timer = setTimeout(() => dispatch({ type: "forget" }), UNDO_MS);
    return () => clearTimeout(timer);
  }, [state.removed]);

  const add = useCallback(
    (lines: readonly BillLine[], raised: readonly ReviewFlag[], transcript = "", resolves?: string) =>
      dispatch({ type: "add", lines, flags: raised, transcript, resolves }),
    [],
  );

  const edit = useCallback(
    (id: string, field: EditField, value: string): string | null => {
      const row = state.rows.find((r) => r.id === id);
      if (!row) return null;
      const item = row.item;
      const result =
        field === "qty"
          ? // A qty-less line (D47) takes the product's own unit with its qty.
            editQty(item, value, item.unit ? undefined : catalog.find((c) => c.id === item.catalogId)?.unit)
          : field === "rate"
            ? editRate(item, value)
            : field === "amount"
              ? editAmount(item, value)
              : editUnit(item, value);
      if (!result.ok) return result.error;
      dispatch({ type: "replace", id, row: { ...row, item: result.item } });
      return null;
    },
    [catalog, state.rows],
  );

  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const acknowledge = useCallback((key: string) => dispatch({ type: "acknowledge", key }), []);
  const addByHand = useCallback(
    (item: ParsedItem, displayName: string) =>
      // No transcript: none of the spoken-number checks apply to a typed line.
      dispatch({ type: "add", lines: [{ item, displayName, source: "manual" }], flags: evaluateReviewFlags("", [item], catalog), transcript: "", focus: true }),
    [catalog],
  );
  const fail = useCallback((transcript: string) => dispatch({ type: "fail", transcript }), []);
  const setCustomerName = useCallback((text: string) => {
    const name = parseCustomerName(text);
    if (!name.ok) return name.error;
    dispatch({ type: "customer", customer: { name: name.value } });
    return null;
  }, []);
  const setCustomerMobile = useCallback((text: string) => {
    const mobile = parseIndianMobile(text);
    if (!mobile.ok) return mobile.error;
    dispatch({ type: "customer", customer: { mobile: mobile.value } });
    return null;
  }, []);
  const retrying = useCallback((id: string) => dispatch({ type: "retrying", id }), []);
  const retryFailed = useCallback((id: string, message: string) => dispatch({ type: "retryFailed", id, message }), []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const reset = useCallback(() => {
    frozen.current = false;
    dispatch({ type: "reset" });
  }, []);
  /** Bill Banao saved this bill: its draft goes, and stays gone until the next bill. */
  const discardDraft = useCallback(async () => {
    frozen.current = true;
    if (db && shopId) await clearDraft(db, shopId);
  }, [db, shopId]);
  /** "Clear bill": the bill is thrown away - nothing is saved, nothing is learned (hard rule 8). */
  const clearBill = useCallback(async () => {
    frozen.current = false;
    dispatch({ type: "reset" });
    if (db && shopId) await clearDraft(db, shopId);
  }, [db, shopId]);

  return {
    rows: state.rows,
    flags,
    pending,
    localId: state.localId,
    startedAt: state.startedAt,
    reset,
    ready,
    discardDraft,
    clearBill,
    draft,
    notAdded: state.notAdded,
    focusLineId: state.focusLineId,
    customer: state.customer,
    setCustomerName,
    setCustomerMobile,
    removed: state.removed?.row ?? null,
    add,
    edit,
    remove,
    undo,
    acknowledge,
    addByHand,
    fail,
    retrying,
    retryFailed,
    dismiss,
  };
}

/** was_edited for a row (03-DATA-MODEL.md bill_items; the KB-307 learning signal). */
export const wasEdited = (row: BillRow): boolean => isEdited(row.item, row.original);
