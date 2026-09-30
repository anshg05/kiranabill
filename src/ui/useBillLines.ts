import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { CatalogEntry } from "@/domain/catalog";
import { billFlags, editAmount, editQty, editRate, editUnit, isEdited, type BillEntry, type UtteranceRecord } from "@/domain/billEdit";
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
}

type Action =
  | { type: "add"; lines: readonly BillLine[]; flags: readonly ReviewFlag[] }
  | { type: "replace"; id: string; row: BillRow }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "forget" };

export const EMPTY_BILL: State = { rows: [], utterances: [], nextId: 1, removed: null };

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
        utterances: [...state.utterances, { id: utteranceId, lineIds: rows.map((r) => r.id), flags: action.flags }],
        nextId: state.nextId + rows.length,
      };
    }
    case "replace":
      return { ...state, rows: state.rows.map((r) => (r.id === action.id ? action.row : r)) };
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

export interface BillLines {
  readonly rows: readonly BillRow[];
  readonly flags: readonly ReviewFlag[];
  /** The line "Undo" would bring back, while it can. */
  readonly removed: BillRow | null;
  add: (lines: readonly BillLine[], flags: readonly ReviewFlag[]) => void;
  /** Commits a typed value; returns the message to show, or null when applied. */
  edit: (id: string, field: EditField, value: string) => string | null;
  remove: (id: string) => void;
  undo: () => void;
}

export function useBillLines(catalog: readonly CatalogEntry[]): BillLines {
  const [state, dispatch] = useReducer(billReducer, EMPTY_BILL);

  const flags = useMemo(() => billFlags(state.rows, state.utterances, catalog), [state.rows, state.utterances, catalog]);

  // One level of undo, for UNDO_MS.
  useEffect(() => {
    if (!state.removed) return;
    const timer = setTimeout(() => dispatch({ type: "forget" }), UNDO_MS);
    return () => clearTimeout(timer);
  }, [state.removed]);

  const add = useCallback((lines: readonly BillLine[], raised: readonly ReviewFlag[]) => dispatch({ type: "add", lines, flags: raised }), []);

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

  return { rows: state.rows, flags, removed: state.removed?.row ?? null, add, edit, remove, undo };
}

/** was_edited for a row (03-DATA-MODEL.md bill_items; the KB-307 learning signal). */
export const wasEdited = (row: BillRow): boolean => isEdited(row.item, row.original);
