import type { ParsedItem } from "@/domain/grammar";

// A line on the bill, from any path: a voice order (V3, useVoiceOrders), the fast path (dev ?try= only) or Add item.
// 18 Nov 2026 (owner + reviewer): the old transcript resolver that lived here (resolveUtterance - Layer 1, then a text Layer 2) was
// deleted with the old voice path; V3 makes its lines in domain/aiAnswerBill.ts. Only this type is left.

export interface BillLine {
  readonly item: ParsedItem;
  /** What the bill shows - the shop entry's name for a matched Layer 2 line (Q5b). */
  readonly displayName: string;
  /** LocalBillItem.source: "fastpath" = Layer 1, "voice" = Layer 2, "manual" = added by hand (KB-305). */
  readonly source: "fastpath" | "voice" | "manual";
  /** KB-385 (D106 item 3): the price was filled by OUR CODE, never spoken for this line - the bill marks it. */
  readonly filled?: "shop_price" | "repeat";
}
