import { useEffect, useState } from "react";
import type { KiranaBillDB } from "@/data/db";

// KB-340 (D86): the shop's name for the billing header. It starts from the shop in memory, then reads the stored row (the
// one Settings writes - saved on this phone first), and reads it again whenever `refresh` changes (Settings closing).
export function useShopName(db: KiranaBillDB | null, shopId: string | undefined, fallback: string | undefined, refresh: unknown): string | undefined {
  const [name, setName] = useState<string | undefined>(fallback);
  useEffect(() => {
    setName((current) => current ?? fallback);
  }, [fallback]);
  useEffect(() => {
    if (!db || !shopId) return;
    let live = true;
    db.shops
      .get(shopId)
      .then((row) => live && row?.name && setName(row.name))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [db, shopId, refresh]);
  return name;
}
