import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, isAuthRetryableFetchError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, openShopDb, type LocalBill } from "./db";
import { DeviceDB, getOrCreateDeviceId, getActiveUserId, setActiveUserId } from "./device";
import { createShop } from "./shops";
import { bootstrapAfterOnboarding, bootstrapOnStart } from "./bootstrap";
import { consumeNextNumber } from "./receiptNumbers";
import { startSyncLoop, stopSyncLoop, isSyncLoopRunning, syncNow, type OnlineEventSource } from "./sync";
import { resolveAuthMode, signOutDevice } from "./offlineSession";

/**
 * KB-315 (docs/12-PARKED.md KI-32, docs/07-DECISIONS.md D38) - real local
 * Docker stack, the SHIPPED code path (D21, D32): real signUp / RLS /
 * copy_base_catalog / receipt blocks, this project's own bootstrap, device,
 * sync and offlineSession modules, and the real @supabase/auth-js for the
 * offline-identity case. `npm run test:e2e`. Refuses non-local URLs.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const UNREACHABLE = "http://127.0.0.1:9"; // nothing listens here - "no network"

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
}

/** A supabase-js client whose auth storage holds `stored` (a real session,
 * possibly tampered with), talking to `baseUrl`. */
function clientWithStoredSession(baseUrl: string, stored: Session): SupabaseClient {
  const memory = new Map<string, string>([["kb-e2e-auth", JSON.stringify(stored)]]);
  return createClient(baseUrl, anonKey!, {
    auth: {
      storageKey: "kb-e2e-auth",
      storage: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
        removeItem: (k: string) => void memory.delete(k),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

describe("KB-315 bootstrap e2e - real local stack, shipped code path", () => {
  let client: SupabaseClient;
  let userId: string;
  let shopId: string;
  let deviceId: string;
  let db: KiranaBillDB;
  const credentials = { email: `e2e-315-${crypto.randomUUID()}@kb315.local`, password: crypto.randomUUID() }; // local only, never printed
  const deviceDbName = `e2e-device-${crypto.randomUUID()}`;
  const listeners = new Set<() => void>();
  const onlineSource: OnlineEventSource = {
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
  };

  beforeAll(async () => {
    assertLocal();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signUp(credentials);
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    userId = data.user.id;
  });

  afterAll(() => stopSyncLoop());

  async function serverBlocks() {
    const { data, error } = await client.from("receipt_number_blocks").select("device_id, block_start, block_end").eq("shop_id", shopId).order("block_start");
    if (error) throw error;
    return data;
  }

  it("1. onboarding: deviceId persisted, copy_base_catalog stamped with it, first block reserved server-side, 482 products + the shop in Dexie, loop running", async () => {
    const deviceDb = new DeviceDB(deviceDbName);
    deviceId = await getOrCreateDeviceId(deviceDb);
    await setActiveUserId(deviceDb, userId); // what AuthProvider does on a live session
    const shop = await createShop(client, { ownerUserId: userId, name: "KB-315 e2e", phone: null, catalogMode: "base_imported" });
    shopId = shop.id;
    db = openShopDb(userId);

    const cached = await bootstrapAfterOnboarding(client, db, { shopId, deviceId, catalogChoice: "ready" });
    expect(cached?.id).toBe(shopId);

    const { data: products, error } = await client.from("shop_products").select("device_id").eq("shop_id", shopId);
    expect(error).toBeNull();
    expect(products).toHaveLength(482);
    expect(new Set(products!.map((p) => p.device_id))).toEqual(new Set([deviceId])); // the persistent id, not a throwaway

    expect(await serverBlocks()).toEqual([{ device_id: deviceId, block_start: 1, block_end: 50 }]);
    expect(await db.shopProducts.where("shopId").equals(shopId).count()).toBe(482);

    startSyncLoop({ client, localDb: db, shopId, deviceId }, onlineSource);
    expect(isSyncLoopRunning()).toBe(true);
    expect(listeners.size).toBe(1);
  });

  it("5. sign-out: the loop stops, its listener is removed, the active user is forgotten - and local data is still there for the same user", async () => {
    const deviceDb = new DeviceDB(deviceDbName);
    await signOutDevice(client, deviceDb);
    expect(isSyncLoopRunning()).toBe(false);
    expect(listeners.size).toBe(0);
    expect(await getActiveUserId(deviceDb)).toBeNull();
    db.close();

    const reopened = openShopDb(userId);
    expect(await reopened.shops.count()).toBe(1);
    expect(await reopened.shopProducts.count()).toBe(482);
    db = reopened;

    // Sign back in (the same user) - what the next session will do.
    const { error } = await client.auth.signInWithPassword(credentials);
    expect(error).toBeNull();
    await setActiveUserId(deviceDb, userId);
  });

  it("2. restart: new DeviceDB + KiranaBillDB instances on the same stores keep the SAME deviceId and reuse the block (no new reservation)", async () => {
    const restartedDevice = new DeviceDB(deviceDbName);
    expect(await getOrCreateDeviceId(restartedDevice)).toBe(deviceId);
    const restartedDb = openShopDb(userId);
    const shop = await bootstrapOnStart(client, restartedDb, { shopId, deviceId, online: true });
    expect(shop?.id).toBe(shopId);
    expect(await serverBlocks()).toHaveLength(1);
  });

  it("3. offline start: with no network the cached shop, products and this device's block are all usable", async () => {
    const offlineClient = createClient(UNREACHABLE, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const shop = await bootstrapOnStart(offlineClient, db, { shopId, deviceId, online: false });
    expect(shop?.id).toBe(shopId);
    expect(await db.shopProducts.where("shopId").equals(shopId).count()).toBe(482);
    const receipt = await consumeNextNumber(offlineClient, db, shopId, deviceId);
    expect(receipt).toEqual({ receiptNumber: "KB-000001", source: "block" });

    // Even told it's online, an unreachable network degrades, never throws.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = await bootstrapOnStart(offlineClient, db, { shopId, deviceId, online: true });
    warn.mockRestore();
    expect(again?.id).toBe(shopId);
  });

  it("4. offline identity, REAL auth-js: a stored but EXPIRED session with no network -> getSession() is null + a retryable error -> an offline session for the remembered user", async () => {
    const { data } = await client.auth.getSession();
    const expired = { ...data.session!, expires_at: Math.floor(Date.now() / 1000) - 3600, expires_in: -3600 };
    const offlineClient = clientWithStoredSession(UNREACHABLE, expired);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await offlineClient.auth.getSession();
    warn.mockRestore();
    expect(result.data.session).toBeNull();
    expect(isAuthRetryableFetchError(result.error)).toBe(true);
    expect(resolveAuthMode(result, await getActiveUserId(new DeviceDB(deviceDbName)))).toEqual({ kind: "offline", userId });
  });

  it("6. wiped device: a fresh device store -> a NEW deviceId -> a new block past max(block_end); the old install's block is never consumed", async () => {
    const wipedDevice = new DeviceDB(`e2e-device-wiped-${crypto.randomUUID()}`);
    const newDeviceId = await getOrCreateDeviceId(wipedDevice);
    expect(newDeviceId).not.toBe(deviceId);
    const wipedDb = new KiranaBillDB(`e2e-wiped-${crypto.randomUUID()}`);

    await bootstrapOnStart(client, wipedDb, { shopId, deviceId: newDeviceId, online: true });
    expect(await serverBlocks()).toEqual([
      { device_id: deviceId, block_start: 1, block_end: 50 },
      { device_id: newDeviceId, block_start: 51, block_end: 100 },
    ]);
    expect(await wipedDb.receiptNumberBlocks.count()).toBe(1); // only its own block was pulled
    expect(await consumeNextNumber(client, wipedDb, shopId, newDeviceId)).toEqual({ receiptNumber: "KB-000051", source: "block" });
    await wipedDb.delete();
  });

  it("7. never sync without a real session: offline session, then a reconnect whose refresh token is REJECTED -> nothing pushed, all pending, no conflict; sign in again -> it pushes", async () => {
    const billLocalId = crypto.randomUUID();
    const receipt = await consumeNextNumber(client, db, shopId, deviceId);
    const bill: LocalBill = {
      localId: billLocalId, shopId, status: "final", syncStatus: "pending",
      receiptNumber: receipt.receiptNumber, receiptNumberSource: receipt.source,
      customerName: "Cash", customerMobile: null, subtotalPaise: 2250, totalPaise: 2250, schemaVersion: 1, deviceId,
      createdAt: new Date().toISOString(), finalizedAt: new Date().toISOString(), syncedAt: null,
    };
    await db.bills.add(bill);
    await db.billItems.add({
      billLocalId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 500, unit: "gm",
      ratePaise: 4500, rateUnit: "kg", totalPaise: 2250, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false,
    });

    // a) offline session: no live session at all.
    const offlineClient = createClient(UNREACHABLE, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect(await syncNow({ client: offlineClient, localDb: db, shopId, deviceId })).toEqual({ anyTransientFailure: true, skippedNoSession: true });
    expect((await db.bills.get(billLocalId))?.syncStatus).toBe("pending");

    // b) network back, but the refresh token is REJECTED by the real Auth server.
    const { data } = await client.auth.getSession();
    const dead = { ...data.session!, refresh_token: "rejected-refresh-token", expires_at: Math.floor(Date.now() / 1000) - 3600, expires_in: -3600 };
    const rejectedClient = clientWithStoredSession(url!, dead);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejected = await rejectedClient.auth.getSession();
    expect(rejected.data.session).toBeNull();
    expect(isAuthRetryableFetchError(rejected.error)).toBe(false);
    expect(await syncNow({ client: rejectedClient, localDb: db, shopId, deviceId })).toEqual({ anyTransientFailure: true, skippedNoSession: true });
    warn.mockRestore();
    const still = await db.bills.get(billLocalId);
    expect(still?.syncStatus).toBe("pending"); // NOT conflict
    const { data: onServer } = await client.from("bills").select("id").eq("shop_id", shopId).eq("local_id", billLocalId);
    expect(onServer).toEqual([]);

    // c) signed in again (client has a live session since case 5) -> it pushes.
    const result = await syncNow({ client, localDb: db, shopId, deviceId });
    expect(result.skippedNoSession).toBeUndefined();
    expect((await db.bills.get(billLocalId))?.syncStatus).toBe("synced");
    const { data: pushed } = await client.from("bills").select("status, receipt_number_source, bill_items(rate_unit, total_paise)").eq("shop_id", shopId).eq("local_id", billLocalId);
    expect(pushed).toEqual([{ status: "final", receipt_number_source: "block", bill_items: [{ rate_unit: "kg", total_paise: 2250 }] }]);
  });
});
