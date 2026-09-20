import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/data/supabaseClient";
import {
  createShop as createShopRequest,
  copyBaseCatalog,
  findOwnShop,
  type CatalogMode,
  type Shop,
} from "@/data/shops";

interface ShopContextValue {
  shop: Shop | null;
  loading: boolean;
  createShop: (params: {
    name: string;
    phone: string | null;
    catalogChoice: "ready" | "empty";
    deviceId: string;
  }) => Promise<void>;
}

const ShopContext = createContext<ShopContextValue | null>(null);

interface ShopProviderProps {
  children: ReactNode;
  userId: string | null;
  /** Injected in tests to avoid hitting the real Supabase client. */
  client?: SupabaseClient;
}

export function ShopProvider({ children, userId, client = supabase }: ShopProviderProps) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (!userId) {
      setShop(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    findOwnShop(client, userId)
      .then((found) => {
        if (!active) return;
        setShop(found);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        // A failed lookup is treated the same as "no shop yet" - the S2
        // form is always a safe fallback, never a dead end.
        setShop(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client, userId]);

  const createShop = useCallback(
    async (params: { name: string; phone: string | null; catalogChoice: "ready" | "empty"; deviceId: string }) => {
      if (!userId) throw new Error("createShop() called with no signed-in user");

      const catalogMode: CatalogMode = params.catalogChoice === "ready" ? "base_imported" : "custom_only";
      const created = await createShopRequest(client, {
        ownerUserId: userId,
        name: params.name,
        phone: params.phone,
        catalogMode,
      });

      if (params.catalogChoice === "ready") {
        await copyBaseCatalog(client, created.id, params.deviceId);
      }

      setShop(created);
    },
    [client, userId],
  );

  return <ShopContext.Provider value={{ shop, loading, createShop }}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop() must be used inside a <ShopProvider>");
  return ctx;
}
