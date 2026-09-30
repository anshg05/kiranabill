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
import type { ReviewFlag } from "@/domain/reviewFlags";
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
}

type Action =
  | { type: "add"; lines: readonly BillLine[]; flags: readonly ReviewFlag[]; transcript: string }
  | { type: "replace"; id: string; row: BillRow }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "forget" }
  | { type: "acknowledge"; key: string };

export const EMPTY_BILL: State = { rows: [], utterances: [], nextId: 1, removed: null, acknowledged: new Set() };

export function billReducer(state: State, action: Action): State {
  switch (action.type) {
    case "add": {
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
      };
    }
    case "replace": {
      // KB-304 (owner): an acknowledgement lapses on any edit to its line.
      const scopes = acknowledgementScopes(action.row.id, action.row.utteranceId);
      const acknowledged = new Set([...state.acknowledged].filter((k) => !scopes.some((s) => k.startsWith(s))));
      return { ...state, rows: state.rows.map((r) => (r.id === action.id ? action.row : r)), acknowledged };
    }
    case "acknowledge":
      return { ...state, acknowledged: new Set([...state.acknowledged, action.key]) };
    case "remove": {
      const at = state.rows.findIndex((r) => r.id === action.id);
      if (at === -1) return state;
      return { ...state, rows: state.rows.filter((r) => r.id !== action.id), removed: { row: state.rows[at]!, at } };
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
  /** Unacknowledged HIGH flags - "N checks pending" (canFinalize's rule). */
  readonly pending: number;
  /** The line "Undo" would bring back, while it can. */
  readonly removed: BillRow | null;
  add: (lines: readonly BillLine[], flags: readonly ReviewFlag[], transcript?: string) => void;
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
  const pending = useMemo(() => pendingChecks(placed, state.acknowledged), [placed, state.acknowledged]);

  // One level of undo, for UNDO_MS.
  useEffect(() => {
    if (!state.removed) return;
    const timer = setTimeout(() => dispatch({ type: "forget" }), UNDO_MS);
    return () => clearTimeout(timer);
  }, [state.removed]);

  const add = useCallback(
    (lines: readonly BillLine[], raised: readonly ReviewFlag[], transcript = "") => dispatch({ type: "add", lines, flags: raised, transcript }),
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

  return { rows: state.rows, flags, pending, removed: state.removed?.row ?? null, add, edit, remove, undo, acknowledge };
}

/** was_edited for a row (03-DATA-MODEL.md bill_items; the KB-307 learning signal). */
export const wasEdited = (row: BillRow): boolean => isEdited(row.item, row.original);
