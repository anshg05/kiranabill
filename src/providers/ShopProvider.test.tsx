// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ShopProvider, useShop } from "./ShopProvider";
import { ShopGate } from "@/app/App";
import { openShopDb } from "@/data/db";
import { DeviceDB } from "@/data/device";
import { isSyncLoopRunning, stopSyncLoop, type OnlineEventSource } from "@/data/sync";

// KB-301: ShopProvider (KB-315, D38) had no tests. These go through the real
// provider - its effect, its Dexie reads, its sync-loop wiring - with only
// the Supabase client and the "online" event source injected.

afterEach(() => {
  cleanup();
  stopSyncLoop(); // module-level loop state must never leak between tests
});

interface ClientScript {
  /** What findOwnShop's query resolves to - or a network-style error. */
  shops: () => { data: unknown; error: unknown };
}

/** Only what ShopProvider touches before its sync loop starts: the shops
 * lookup (findOwnShop) and getSession. getSession always answers "no
 * session", so the loop runs but every cycle skips (D38) - no fake sync
 * traffic is needed to prove the loop started. */
function makeClient(script: ClientScript): { client: SupabaseClient; shopQueries: () => number } {
  let queries = 0;
  const from = (table: string) => {
    if (table !== "shops") throw new Error(`unexpected table "${table}"`);
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => {
        queries++;
        return Promise.resolve(script.shops());
      },
    };
    return builder;
  };
  const auth = { getSession: async () => ({ data: { session: null }, error: null }) };
  return { client: { from, auth } as unknown as SupabaseClient, shopQueries: () => queries };
}

const networkDown = () => ({ data: null, error: { message: "TypeError: Failed to fetch" } });

const noEvents: OnlineEventSource = { addEventListener() {}, removeEventListener() {} };

async function seedCachedShop(userId: string, shopId: string, name: string): Promise<void> {
  const db = openShopDb(userId);
  await db.shops.put({
    id: shopId,
    syncStatus: "synced",
    name,
    phone: null,
    address: null,
    logoUrl: null,
    catalogMode: "base_imported",
    billLanguage: "hi",
    receiptPrefix: null,
    updatedAt: new Date(0).toISOString(),
  });
  await db.meta.put({ key: "activeShopId", value: shopId });
  db.close();
}

function Probe() {
  const { shop, loading, loadError } = useShop();
  return (
    <p data-testid="probe">
      {JSON.stringify({ shopName: shop?.name ?? null, loading, loadError })}
    </p>
  );
}

function probe(): { shopName: string | null; loading: boolean; loadError: boolean } {
  return JSON.parse(screen.getByTestId("probe").textContent ?? "{}");
}

const newUser = () => crypto.randomUUID();
const newDeviceDb = () => new DeviceDB("dev-" + crypto.randomUUID());

describe("ShopProvider", () => {
  it("offline: uses the cached shop and never touches the network", async () => {
    const userId = newUser();
    await seedCachedShop(userId, crypto.randomUUID(), "Gupta Kirana");
    const { client, shopQueries } = makeClient({ shops: networkDown });

    render(
      <ShopProvider userId={userId} online={false} deviceDb={newDeviceDb()} client={client} eventSource={noEvents}>
        <Probe />
      </ShopProvider>,
    );

    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe()).toEqual({ shopName: "Gupta Kirana", loading: false, loadError: false });
    expect(shopQueries()).toBe(0);
  });

  it("online, network error, cached shop: keeps the cached shop", async () => {
    const userId = newUser();
    await seedCachedShop(userId, crypto.randomUUID(), "Gupta Kirana");
    const { client, shopQueries } = makeClient({ shops: networkDown });

    render(
      <ShopProvider userId={userId} online={true} deviceDb={newDeviceDb()} client={client} eventSource={noEvents}>
        <Probe />
      </ShopProvider>,
    );

    await waitFor(() => expect(shopQueries()).toBe(1));
    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe()).toEqual({ shopName: "Gupta Kirana", loading: false, loadError: false });
  });

  it("online, network error, NO cached shop: shows the retry screen, never onboarding", async () => {
    // shops.owner_user_id has no unique constraint (12-PARKED.md KI-42): sending
    // this user to onboarding could create a second shop once the network is back.
    const userId = newUser();
    const { client } = makeClient({ shops: networkDown });

    render(
      <ShopProvider userId={userId} online={true} deviceDb={newDeviceDb()} client={client} eventSource={noEvents}>
        <ShopGate />
      </ShopProvider>,
    );

    expect(await screen.findByText("Server se connect nahi ho paaya")).toBeTruthy();
    expect(screen.queryByText("Set up your shop")).toBeNull();
    expect(isSyncLoopRunning()).toBe(false);
  });

  it("retry re-runs the lookup; a user with no shop anywhere then gets onboarding", async () => {
    const userId = newUser();
    let down = true;
    const { client, shopQueries } = makeClient({
      shops: () => (down ? networkDown() : { data: null, error: null }),
    });

    render(
      <ShopProvider userId={userId} online={true} deviceDb={newDeviceDb()} client={client} eventSource={noEvents}>
        <ShopGate />
      </ShopProvider>,
    );

    const retry = await screen.findByRole("button", { name: "Retry" });
    down = false;
    act(() => retry.click());

    expect(await screen.findByText("Set up your shop")).toBeTruthy();
    expect(shopQueries()).toBe(2);
  });

  it("StrictMode's double mount doesn't log a false 'bootstrap failed'", async () => {
    // Found in the owner's KB-301 browser check: React StrictMode (dev) mounts
    // twice; the first mount's cleanup closes its database while that run is
    // still reading, which threw DatabaseClosedError and logged "[shop]
    // bootstrap failed" for a run that had already been cancelled.
    const userId = newUser();
    await seedCachedShop(userId, crypto.randomUUID(), "Gupta Kirana");
    const { client } = makeClient({ shops: networkDown });
    const warn = vi.spyOn(console, "warn");

    render(
      <StrictMode>
        <ShopProvider userId={userId} online={false} deviceDb={newDeviceDb()} client={client} eventSource={noEvents}>
          <Probe />
        </ShopProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(probe().shopName).toBe("Gupta Kirana"));
    await new Promise((r) => setTimeout(r, 50)); // let the cancelled run settle
    const bootstrapWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("bootstrap failed"));
    warn.mockRestore();
    expect(bootstrapWarnings).toEqual([]);
  });

  it("starts the sync loop when a shop is active and stops it on sign-out", async () => {
    const userId = newUser();
    await seedCachedShop(userId, crypto.randomUUID(), "Gupta Kirana");
    const { client } = makeClient({ shops: networkDown });
    const deviceDb = newDeviceDb();

    const tree = (uid: string | null) => (
      <ShopProvider userId={uid} online={false} deviceDb={deviceDb} client={client} eventSource={noEvents}>
        <Probe />
      </ShopProvider>
    );
    const { rerender, unmount } = render(tree(userId));

    await waitFor(() => expect(probe().shopName).toBe("Gupta Kirana"));
    expect(isSyncLoopRunning()).toBe(true);

    // Sign-out: AuthProvider's userId goes null (AuthGate then unmounts the
    // provider - covered below). Either way the loop must stop.
    rerender(tree(null));
    await waitFor(() => expect(probe().shopName).toBe(null));
    expect(isSyncLoopRunning()).toBe(false);

    rerender(tree(userId));
    await waitFor(() => expect(isSyncLoopRunning()).toBe(true));
    unmount();
    expect(isSyncLoopRunning()).toBe(false);
  });
});
