import { buildReceipt, type Receipt } from "@/domain/receipt";
import type { KiranaBillDB } from "./db";

/**
 * KB-308: a saved bill's receipt, from the LOCAL tables only (the shop's
 * name, phone, bill_language and logo_url are cached in `shops` - 03 §0), so
 * it draws offline. Reads the bill as stored, never the draft. null when the
 * bill or its shop isn't on this device.
 */
export async function loadReceipt(localDb: KiranaBillDB, billLocalId: string): Promise<Receipt | null> {
  const bill = await localDb.bills.get(billLocalId);
  if (!bill) return null;
  const shop = await localDb.shops.get(bill.shopId);
  if (!shop) return null;
  const items = await localDb.billItems.where("billLocalId").equals(billLocalId).sortBy("lineNo");
  return buildReceipt(bill, items, shop);
}
