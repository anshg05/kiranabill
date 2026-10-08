import type { KiranaBillDB, LocalShop } from "./db";
import { isBillLanguage, parseShopName } from "@/domain/shopSettings";
import type { BillLanguage } from "@/domain/receipt";

// KB-312 (S7, D64): a shop edit is written locally first - works offline - marked pending with a new
// updatedAt, and pushed by the ordinary sync. updatedAt is also the version pushShop checks: it takes the
// server's updated_at only if the row still has the updatedAt it pushed, so an edit made while a push is
// in flight stays pending. Two edits in the same millisecond therefore must still differ.

export interface ShopSettingsChange {
  /** Already parsed (parseShopName); re-checked here. */
  name?: string;
  /** Already parsed (parseShopPhone): 10 digits, or null. */
  phone?: string | null;
  billLanguage?: BillLanguage;
}

/** Null if the shop isn't on this phone. A change that changes nothing writes nothing. */
export async function updateShopSettings(
  db: KiranaBillDB,
  shopId: string,
  change: ShopSettingsChange,
  nowMs: number = Date.now(),
): Promise<LocalShop | null> {
  if (change.name !== undefined && !parseShopName(change.name).ok) throw new Error("updateShopSettings: invalid shop name");
  if (change.billLanguage !== undefined && !isBillLanguage(change.billLanguage)) throw new Error("updateShopSettings: invalid bill language");

  return db.transaction("rw", db.shops, async () => {
    const current = await db.shops.get(shopId);
    if (!current) return null;
    const next: LocalShop = {
      ...current,
      name: change.name ?? current.name,
      phone: change.phone === undefined ? current.phone : change.phone,
      billLanguage: change.billLanguage ?? current.billLanguage,
    };
    if (next.name === current.name && next.phone === current.phone && next.billLanguage === current.billLanguage) return current;

    let updatedAt = new Date(nowMs).toISOString();
    if (updatedAt === current.updatedAt) updatedAt = new Date(nowMs + 1).toISOString();
    const saved: LocalShop = { ...next, syncStatus: "pending", updatedAt };
    await db.shops.put(saved);
    return saved;
  });
}
