import { useCallback, useEffect, useMemo, useReducer } from "react";
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
import type { BillLine } from "@/data/voiceBilling";

// KB-303: the bill being built - its lines (each with a stable id, the
// utterance it came from, and what was spoken), editing, removing with a
// one-level undo, and the bill's flags re-derived after every change
// (domain/billEdit.ts billFlags). The app never changes a number itself: a
// line changes only through the shopkeeper's edit. Kept in memory until
// KB-313 persists the bill.

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

interface State {
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
}

type Action =
  | { type: "add"; lines: readonly BillLine[]; flags: readonly ReviewFlag[]; transcript: string; resolves?: string; focus?: boolean }
  | { type: "fail"; transcript: string }
  | { type: "retrying"; id: string }
  | { type: "retryFailed"; id: string; message: string }
  | { type: "dismiss"; id: string }
  | { type: "replace"; id: string; row: BillRow }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "forget" }
  | { type: "acknowledge"; key: string };

export const EMPTY_BILL: State = { rows: [], utterances: [], nextId: 1, removed: null, acknowledged: new Set(), notAdded: [], nextNotAddedId: 1, focusLineId: null };

const updateNotAdded = (state: State, id: string, change: Partial<NotAdded>): State => ({
  ...state,
  notAdded: state.notAdded.map((n) => (n.id === id ? { ...n, ...change } : n)),
});

export function billReducer(state: State, action: Action): State {
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
      return { ...state, rows: state.rows.filter((r) => r.id !== action.id), removed: { row: state.rows[at]!, at }, focusLineId: null };
    }
    case "undo": {
      if (!state.removed) return state;
      const rows = [...state.rows];
      rows.splice(Math.min(state.removed.at, rows.length), 0, state.removed.row);
      return { ...state, rows, removed: null };
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
  /** Unacknowledged HIGH flags plus not-added utterances - "N checks pending";
   * Bill Banao waits for 0 (canFinalize's rule, KB-307). */
  readonly pending: number;
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

export function useBillLines(catalog: readonly CatalogEntry[]): BillLines {
  const [state, dispatch] = useReducer(billReducer, EMPTY_BILL);

  const placed = useMemo(() => billFlags(state.rows, state.utterances, catalog), [state.rows, state.utterances, catalog]);
  const flags = useMemo(() => placed.map((f) => ({ ...f, acknowledged: state.acknowledged.has(f.key) })), [placed, state.acknowledged]);
  const pending = useMemo(() => pendingChecks(placed, state.acknowledged) + state.notAdded.length, [placed, state.acknowledged, state.notAdded]);

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
  const retrying = useCallback((id: string) => dispatch({ type: "retrying", id }), []);
  const retryFailed = useCallback((id: string, message: string) => dispatch({ type: "retryFailed", id, message }), []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);

  return {
    rows: state.rows,
    flags,
    pending,
    notAdded: state.notAdded,
    focusLineId: state.focusLineId,
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
