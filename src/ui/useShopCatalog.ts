import { useCallback, useEffect, useState } from "react";
import { subscribeCatalogPulled } from "@/data/catalogPullStatus";
import type { KiranaBillDB } from "@/data/db";
import { loadShopCatalog, type ShopCatalog } from "@/data/shopCatalog";

export interface ShopCatalogState {
  catalog: ShopCatalog | null;
  /** This phone's own edit or learning changed it - load again. */
  reload: () => void;
  /** Counts the sync pulls that moved the catalog tables (other widgets that read the same rows refresh on it). */
  pulls: number;
}

/**
 * The billing catalog (parser, type-ahead, Add item, vocabulary) from Dexie. Reloaded after this phone's own edits (reload)
 * AND, KB-350, whenever a sync pull moved shop products / shop settings / learning - a price changed on another phone
 * must reach the next line. A reload that finds the same catalog keeps the old object (no parser rebuild, no re-render
 * under a line being edited). Lines already on the bill are their own copies and are never touched.
 */
export function useShopCatalog(db: KiranaBillDB | null, shopId: string | undefined): ShopCatalogState {
  const [catalog, setCatalog] = useState<ShopCatalog | null>(null);
  const [version, setVersion] = useState(0);
  const [pulls, setPulls] = useState(0);
  useEffect(() => {
    if (!db) return;
    return subscribeCatalogPulled(db.name, () => {
      setPulls((n) => n + 1);
      setVersion((v) => v + 1);
    });
  }, [db]);
  useEffect(() => {
    if (!db || !shopId) return;
    let active = true;
    void loadShopCatalog(db, shopId)
      .then((c) => {
        // KB-352: nothing changed -> the same object; only usage counts moved (every bill does that) -> a new catalog but the SAME `entries`,
        // so the parser built from them is not rebuilt.
        if (active) {
          setCatalog((old) => {
            if (!old) return c;
            if (JSON.stringify(old.entries) !== JSON.stringify(c.entries)) return c;
            return JSON.stringify(old) === JSON.stringify(c) ? old : { ...c, entries: old.entries };
          });
        }
      })
      .catch((err: unknown) => console.warn("[catalog] load failed:", err instanceof Error ? err.message : err));
    return () => {
      active = false;
    };
  }, [db, shopId, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { catalog, reload, pulls };
}
