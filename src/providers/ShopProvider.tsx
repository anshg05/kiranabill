import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/data/supabaseClient";
import {
  createShop as createShopRequest,
  findOwnShop,
  type CatalogMode,
  type Shop,
} from "@/data/shops";
import { openShopDb, type KiranaBillDB, type LocalShop } from "@/data/db";
import { getOrCreateDeviceId, type DeviceDB } from "@/data/device";
import { bootstrapAfterOnboarding, bootstrapOnStart, readCachedShop } from "@/data/bootstrap";
import { startSyncLoop, stopSyncLoop, type OnlineEventSource } from "@/data/sync";

// KB-315 (docs/12-PARKED.md KI-32, docs/07-DECISIONS.md D38): wiring only -
// no new screens (KB-301 / KB-313). Opens THIS user's local database, reads
// the cached shop FIRST (so an offline start reaches a working app from
// Dexie alone), refreshes from the network when there's a live session, and
// runs the sync loop while a shop is active. A network error never sends a
// shopkeeper with a cached shop back to onboarding.

interface ShopContextValue {
  shop: Shop | null;
  loading: boolean;
  /** KB-301: online, no cached shop, and the server lookup failed. We can't
   * tell "no shop yet" from "network down", so the gate shows Retry - never
   * onboarding, which could create a second shop (12-PARKED.md KI-42). */
  loadError: boolean;
  retry: () => void;
  /** This user's local database - null until opened. */
  localDb: KiranaBillDB | null;
  /** This installation's persistent id (device.ts). */
  deviceId: string | null;
  createShop: (params: { name: string; phone: string | null; catalogChoice: "ready" | "empty" }) => Promise<void>;
}

const ShopContext = createContext<ShopContextValue | null>(null);

interface ShopProviderProps {
  children: ReactNode;
  /** Live or offline-session user (AuthProvider's userId). */
  userId: string | null;
  /** True only with a LIVE session - offline sessions never touch the network. */
  online: boolean;
  deviceDb: DeviceDB;
  /** Injected in tests to avoid hitting the real Supabase client. */
  client?: SupabaseClient;
  /** Injected in tests (Node has no window). */
  eventSource?: OnlineEventSource | null;
}

function fromLocal(local: LocalShop, userId: string): Shop {
  return { id: local.id, ownerUserId: userId, name: local.name, phone: local.phone, catalogMode: local.catalogMode };
}

export function ShopProvider({ children, userId, online, deviceDb, client = supabase, eventSource }: ShopProviderProps) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [localDb, setLocalDb] = useState<KiranaBillDB | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const dbRef = useRef<KiranaBillDB | null>(null);

  const startLoop = useCallback(
    (db: KiranaBillDB, shopId: string, device: string) =>
      startSyncLoop({ client, localDb: db, shopId, deviceId: device }, eventSource),
    [client, eventSource],
  );

  useEffect(() => {
    let active = true;
    if (!userId) {
      setShop(null);
      setLocalDb(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    const db = openShopDb(userId);
    dbRef.current = db;

    (async () => {
      const device = await getOrCreateDeviceId(deviceDb);
      const cached = await readCachedShop(db);
      if (!active) return;
      setDeviceId(device);
      setLocalDb(db);
      let current: Shop | null = cached ? fromLocal(cached, userId) : null;
      if (current) {
        setShop(current);
        setLoading(false);
      }

      let refreshFailed = false;
      if (online) {
        try {
          const found = await findOwnShop(client, userId);
          if (found) {
            await bootstrapOnStart(client, db, { shopId: found.id, deviceId: device, online: true });
            current = found;
          }
        } catch (err) {
          // Network trouble: keep whatever is cached; never send a shopkeeper
          // with a cached shop back to onboarding.
          console.warn("[shop] refresh failed, continuing from local data:", err);
          refreshFailed = true;
        }
      }
      if (!active) return;
      setShop(current);
      setLoadError(refreshFailed && !current);
      setLoading(false);
      if (current) startLoop(db, current.id, device);
    })().catch((err) => {
      // A cancelled run (cleanup already closed its db - React StrictMode's
      // dev double mount, or sign-out mid-load) fails on the closed database.
      // That is expected, not a bootstrap failure: stay silent.
      if (!active) return;
      console.warn("[shop] bootstrap failed:", err);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      stopSyncLoop();
      db.close();
      dbRef.current = null;
    };
  }, [attempt, client, deviceDb, online, startLoop, userId]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const createShop = useCallback(
    async (params: { name: string; phone: string | null; catalogChoice: "ready" | "empty" }) => {
      const db = dbRef.current;
      if (!userId || !db) throw new Error("createShop() called with no signed-in user");
      if (!online) throw new Error("Setting up a shop needs an internet connection.");

      const device = await getOrCreateDeviceId(deviceDb);
      const catalogMode: CatalogMode = params.catalogChoice === "ready" ? "base_imported" : "custom_only";
      const created = await createShopRequest(client, {
        ownerUserId: userId,
        name: params.name,
        phone: params.phone,
        catalogMode,
      });
      await bootstrapAfterOnboarding(client, db, { shopId: created.id, deviceId: device, catalogChoice: params.catalogChoice });
      setShop(created);
      startLoop(db, created.id, device);
    },
    [client, deviceDb, online, startLoop, userId],
  );

  return (
    <ShopContext.Provider value={{ shop, loading, loadError, retry, localDb, deviceId, createShop }}>{children}</ShopContext.Provider>
  );
}

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop() must be used inside a <ShopProvider>");
  return ctx;
}
