import { reissueRows, type ReissueSource } from "@/domain/cancelBill";
import type { BillRow, BillState } from "./useBillLines";
import { newBill } from "./useBillLines";

// KB-325 (D79): the draft of the replacement for a cancelled bill - the stored lines exactly (domain/cancelBill.ts
// reissueRows), the same customer, under the replacement's id (the one the cancellation points to). It is restored into
// an EMPTY bill only (the reducer's "restore"), then goes through the ordinary Bill Banao: the review flags are
// re-derived from the lines and a line with no price still says "Price needed".

export function reissueState(
  bill: { readonly customerName: string; readonly customerMobile: string | null },
  items: readonly ReissueSource[],
  replacementLocalId: string,
  startedAt: string,
): BillState {
  const rows: BillRow[] = reissueRows(items).map((r, i) => ({ id: `l${i + 1}`, utteranceId: 1, item: r.item, original: r.item, displayName: r.displayName, source: r.source }));
  return {
    ...newBill(),
    localId: replacementLocalId,
    startedAt,
    rows,
    utterances: rows.length > 0 ? [{ id: 1, lineIds: rows.map((r) => r.id), flags: [], transcript: "" }] : [],
    nextId: rows.length + 1,
    customer: { name: bill.customerName, mobile: bill.customerMobile },
  };
}
