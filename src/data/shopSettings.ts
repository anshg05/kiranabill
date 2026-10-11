import type { KiranaBillDB, LocalShop, ShopField } from "./db";
import { isBillLanguage, parseShopName } from "@/domain/shopSettings";
import type { BillLanguage } from "@/domain/receipt";

// KB-312 (S7, D64): a shop edit is written locally first - works offline - marked pending with a new
// updatedAt, and pushed by the ordinary sync. updatedAt is also the version pushShop checks: it takes the
// server's updated_at only if the row still has the updatedAt it pushed, so an edit made while a push is
// in flight stays pending. Two edits in the same millisecond therefore must still differ.
//
// KB-334 (D74, NI-40): the row also remembers WHICH fields were changed (pendingFields), stored with the
// pending row so it survives a reload, and pushShop sends only those - a stale phone cannot overwrite what
// another device changed in a field this phone never touched.

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
    const changed: ShopField[] = [];
    if (next.name !== current.name) changed.push("name");
    if (next.phone !== current.phone) changed.push("phone");
    if (next.billLanguage !== current.billLanguage) changed.push("billLanguage");
    if (changed.length === 0) return current;

    // A row the server has confirmed starts a fresh set. A row still waiting (pending, or stuck in conflict)
    // keeps what it was already trying to send; one that waited since before KB-334 has no set and stays
    // that way - it is pushed whole, never narrowed to this edit.
    const keepsPending = current.syncStatus !== "synced";
    const pendingFields: ShopField[] | undefined = !keepsPending
      ? changed
      : current.pendingFields === undefined
        ? undefined
        : [...current.pendingFields, ...changed.filter((f) => !current.pendingFields!.includes(f))];

    let updatedAt = new Date(nowMs).toISOString();
    if (updatedAt === current.updatedAt) updatedAt = new Date(nowMs + 1).toISOString();
    const saved: LocalShop = { ...next, syncStatus: "pending", updatedAt };
    if (pendingFields) saved.pendingFields = pendingFields;
    else delete saved.pendingFields;
    await db.shops.put(saved);
    return saved;
  });
}
