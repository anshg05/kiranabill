import { formatRupees } from "@/domain/money";

/** "Sugar: ₹55 / kg on 3 bills (now ₹48)" - a price-drift suggestion, in the Catalog (KB-311) and Developer mode (KB-312). */
export function priceDriftText(name: string, unit: string, suggestedPaise: number, bills: number, nowPaise: number): string {
  return `${name}: ${formatRupees(suggestedPaise)} / ${unit} on ${bills} bills (now ${formatRupees(nowPaise)})`;
}
