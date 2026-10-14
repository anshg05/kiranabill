import type { ParsedItem } from "./grammar.js";
import type { Paise } from "./money.js";

// KB-325 (docs/07-DECISIONS.md D79): cancel and reissue a bill. Hard rule 2: a finalised bill is never edited - a wrong
// one is cancelled (its status only) and, if wanted, replaced by a NEW bill. Pure: data/cancelBill.ts writes.

/** The five preset reasons - the codes bill_cancellations' CHECK accepts. Nothing is typed: no personal data, nothing to escape. */
export const CANCEL_REASONS = ["wrong_item", "wrong_price", "wrong_quantity", "customer_cancelled", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const REASON_LABEL: Record<CancelReason, string> = {
  wrong_item: "Wrong item",
  wrong_price: "Wrong price",
  wrong_quantity: "Wrong quantity",
  customer_cancelled: "Customer cancelled",
  other: "Other",
};

export const isCancelReason = (x: unknown): x is CancelReason => typeof x === "string" && (CANCEL_REASONS as readonly string[]).includes(x);

/** Why this bill can't be cancelled, or null. Only a saved (final) bill, and once. */
export function cancelBlocker(bill: { status: "draft" | "final" | "cancelled" }, alreadyCancelled: boolean): string | null {
  if (bill.status === "draft") return "Only a saved bill can be cancelled";
  if (bill.status === "cancelled" || alreadyCancelled) return "This bill is already cancelled";
  return null;
}

/** A stored bill line (bill_items), as much as the reissue needs. */
export interface ReissueSource {
  readonly displayName: string;
  readonly spokenName: string | null;
  readonly shopProductId: string | null;
  readonly qty: number | null;
  readonly unit: string | null;
  readonly ratePaise: Paise | null;
  readonly rateUnit: string | null;
  readonly totalPaise: Paise;
  readonly priceType: "rate" | "total" | "default" | "unknown";
}

export interface ReissueRow {
  readonly item: ParsedItem;
  readonly displayName: string;
  /** Always "manual": a reissued line is not speech, so it teaches no alias a second time. */
  readonly source: "manual";
}

/**
 * The lines of the replacement draft: each stored line exactly as stored - qty, unit, rate (with its own unit), total,
 * price type. Nothing is re-priced from today's catalog (hard rule 7) and nothing is filled in (rule 5): an unpriced
 * line stays unpriced and "Price needed" comes back. A line with no product is a custom line. The review flags are
 * re-derived by the bill as for any other line.
 */
export function reissueRows(items: readonly ReissueSource[]): ReissueRow[] {
  return items.map((it): ReissueRow => {
    const priced = it.priceType !== "unknown";
    return {
      displayName: it.displayName,
      source: "manual",
      item: {
        spokenName: it.spokenName ?? it.displayName,
        catalogId: it.shopProductId,
        isCustom: it.shopProductId === null,
        matchStatus: it.shopProductId === null ? "none" : "matched",
        qty: it.qty,
        unit: it.unit ?? "",
        rate: it.ratePaise,
        rateUnit: it.ratePaise === null ? null : it.rateUnit,
        total: priced ? it.totalPaise : null,
        priceType: it.priceType,
      },
    };
  });
}
