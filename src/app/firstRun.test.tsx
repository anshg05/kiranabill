// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { render as say, type Language, type MessageId } from "@/domain/messages";
import { setScreenLanguage } from "@/ui/screenLanguage";
import { stubLocalStorage } from "@/ui/testStorage";

// KB-415 (owner + reviewer, 18 Nov 2026; the approved plan, defaults 1-3 and 5-7, change 4): the first-time flow. A first install
// shows Splash (01) -> Onboarding 1-3 (02-04) -> Sign in (05) -> Shop setup (06, an account with no shop) -> Home; splash and
// onboarding once per install (remembered on the phone); a signed-out returning user goes straight to Sign in; a signed-in user never
// sees any of it. Setup's back arrow and Android Back sign out (a wrong Google account can be changed; nothing exists yet). The
// permission screen (07) is not part of it (default 1: the mic is asked on the first Record, Nearby devices on Choose printer).
//
// The WHOLE flow runs through the real App, AuthProvider, ShopProvider and gates on a fresh phone database (fake-indexeddb, empty
// storage). Only the network is faked: Supabase auth, the shop lookup / insert, the catalog download and the sync loop. The billing
// screen is a stand-in that shows the shop's name ("Home") - it has its own tests.

const env = vi.hoisted(() => ({ native: false }));
vi.mock("@/data/nativeSignIn", async (orig) => ({ ...(await orig<typeof import("@/data/nativeSignIn")>()), isNativeApp: () => env.native }));

const net = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void;
  const state = {
    online: true,
    session: null as unknown,
    listeners: [] as Listener[],
    shop: null as null | { id: string; ownerUserId: string; name: string; phone: string | null; catalogMode: "base_imported" | "custom_only" },
    created: [] as { name: string; phone: string | null; catalogMode: string }[],
    oauth: 0,
  };
  const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.com" };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.session }, error: null }),
      onAuthStateChange: (fn: Listener) => {
        state.listeners.push(fn);
        return { data: { subscription: { unsubscribe: () => (state.listeners = state.listeners.filter((l) => l !== fn)) } } };
      },
      signInWithOAuth: async () => {
        state.oauth++;
        if (!state.online) return { error: new Error("Failed to fetch") };
        // Google comes back signed in
        state.session = { user, access_token: "t", refresh_token: "r", expires_at: 9e9 };
        setTimeout(() => state.listeners.forEach((l) => l("SIGNED_IN", state.session)), 0);
        return { error: null };
      },
      signOut: async () => {
        state.session = null;
        state.listeners.forEach((l) => l("SIGNED_OUT", null));
        return { error: null };
      },
    },
  };
  return { state, client, user };
});
vi.mock("@/data/supabaseClient", () => ({ supabase: net.client }));
vi.mock("@/data/shops", async (orig) => ({
  ...(await orig<typeof import("@/data/shops")>()),
  findOwnShop: async () => {
    if (!net.state.online) throw new Error("Failed to fetch");
    return net.state.shop;
  },
  createShop: async (_c: unknown, p: { ownerUserId: string; name: string; phone: string | null; catalogMode: "base_imported" | "custom_only" }) => {
    if (!net.state.online) throw new Error("Failed to fetch");
    net.state.created.push({ name: p.name, phone: p.phone, catalogMode: p.catalogMode });
    net.state.shop = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerUserId: p.ownerUserId, name: p.name, phone: p.phone, catalogMode: p.catalogMode };
    return net.state.shop;
  },
}));
// the shop row lands on the phone as the real pull would put it (bootstrap's own tests cover the pull)
vi.mock("@/data/bootstrap", async (orig) => {
  const real = await orig<typeof import("@/data/bootstrap")>();
  const land = async (db: import("@/data/db").KiranaBillDB, shopId: string) => {
    const s = net.state.shop!;
    await db.shops.put({ id: shopId, syncStatus: "synced", name: s.name, phone: s.phone, address: null, logoUrl: null, catalogMode: s.catalogMode, billLanguage: "en", receiptPrefix: "KB", updatedAt: new Date().toISOString() });
    await db.meta.put({ key: "activeShopId", value: shopId });
    return (await db.shops.get(shopId)) ?? null;
  };
  return {
    ...real,
    bootstrapAfterOnboarding: async (_c: unknown, db: import("@/data/db").KiranaBillDB, p: { shopId: string }) => land(db, p.shopId),
    bootstrapOnStart: async (_c: unknown, db: import("@/data/db").KiranaBillDB, p: { shopId: string }) => land(db, p.shopId),
  };
});
vi.mock("@/data/sync", async (orig) => ({ ...(await orig<typeof import("@/data/sync")>()), startSyncLoop: () => {}, stopSyncLoop: () => {} }));
vi.mock("@/ui/BillingScreen", async () => {
  const { useShop } = await import("@/providers/ShopProvider");
  const { useAuth } = await import("@/providers/AuthProvider");
  return {
    BillingScreen: () => {
      const { shop } = useShop();
      const { signOut } = useAuth();
      return (
        <main aria-label="Home">
          <h1>{shop?.name}</h1>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </main>
      );
    },
  };
});

import { App } from "./App";

let store: Map<string, string>;
beforeEach(() => {
  env.native = false;
  net.state.online = true;
  net.state.session = null;
  net.state.listeners = [];
  net.state.shop = null;
  net.state.created = [];
  net.state.oauth = 0;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => net.state.online);
  store = stubLocalStorage();
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  cleanup();
  act(() => setScreenLanguage("en"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // a fresh phone for the next test: every database goes
  for (const { name } of await indexedDB.databases()) if (name) indexedDB.deleteDatabase(name);
  await new Promise((r) => setTimeout(r, 40));
});

const T = (id: MessageId, l: Language = "en", p: Record<string, string | number> = {}) => say(id, p, l);
const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const androidBack = () =>
  act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 40));
  });
const setupName = () => screen.getByRole("textbox", { name: "Shop name" }) as HTMLInputElement;
const setupPhone = () => screen.getByRole("textbox", { name: /^Phone/ }) as HTMLInputElement;

/** splash -> 1 -> 2 -> 3 -> Get started -> Sign in */
async function throughWelcome() {
  await heading("KiranaBill");
  tap("Get started");
  await heading("Speak the whole order");
  tap("Next");
  await heading("Get a clear bill");
  tap("Next");
  await heading("It learns your prices");
  tap("Get started");
  await heading("Sign in to your shop");
}

describe("KB-415: the WHOLE first-time flow on a fresh phone", () => {
  it("splash -> onboarding 1-3 -> sign in -> shop setup -> Home; restart: Home; sign out: Sign in, no splash", async () => {
    const { unmount } = render(<App />);
    await throughWelcome();
    tap("Sign in with Google");
    await heading("Set up your shop");
    expect(screen.getByText("Almost done")).toBeTruthy();
    fireEvent.change(setupName(), { target: { value: "  Gupta Kirana Store " } });
    fireEvent.change(setupPhone(), { target: { value: "98765 43210" } });
    // the live receipt preview uses the typed name, Bill No. 1
    const preview = screen.getByRole("figure", { name: "Your bill will look like this" });
    expect(preview.textContent).toContain("Gupta Kirana Store");
    expect(preview.textContent).toContain("98765 43210");
    tap("Use ready catalog");
    await heading("Gupta Kirana Store"); // Home
    expect(net.state.created).toEqual([{ name: "Gupta Kirana Store", phone: "9876543210", catalogMode: "base_imported" }]);
    expect(store.get("kb.welcomed.v1")).toBe("1");

    // restart on the same phone: straight to Home - no splash, no onboarding, no setup
    unmount();
    render(<App />);
    await heading("Gupta Kirana Store");
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();

    // sign out: Sign in, never the splash again
    tap("Sign out");
    await heading("Sign in to your shop");
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
  });

  it("an account that already has a shop goes from Sign in straight to Home - setup is skipped", async () => {
    net.state.shop = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ownerUserId: net.user.id, name: "Sharma Kirana", phone: null, catalogMode: "custom_only" };
    render(<App />);
    await throughWelcome();
    tap("Sign in with Google");
    await heading("Sharma Kirana");
    expect(net.state.created).toEqual([]);
  });

  it("Start empty creates the shop with no ready catalog; the phone stays optional", async () => {
    render(<App />);
    await throughWelcome();
    tap("Sign in with Google");
    await heading("Set up your shop");
    fireEvent.change(setupName(), { target: { value: "Verma Store" } });
    tap("Start empty");
    await heading("Verma Store");
    expect(net.state.created).toEqual([{ name: "Verma Store", phone: null, catalogMode: "custom_only" }]);
  });

  it("someone already signed in on this phone (an update to this version) never sees the splash, even after signing out", async () => {
    net.state.session = { user: net.user, access_token: "t", refresh_token: "r", expires_at: 9e9 } as unknown as Session;
    net.state.shop = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ownerUserId: net.user.id, name: "Sharma Kirana", phone: null, catalogMode: "custom_only" };
    render(<App />);
    await heading("Sharma Kirana");
    tap("Sign out");
    await heading("Sign in to your shop");
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
  });
});

describe("onboarding: Skip, Back, once per install", () => {
  it("Skip on any onboarding page goes to Sign in, and the splash is not shown again", async () => {
    const { unmount } = render(<App />);
    await heading("KiranaBill");
    tap("Get started");
    await heading("Speak the whole order");
    expect(screen.getByText("1 of 3")).toBeTruthy();
    tap("Skip");
    await heading("Sign in to your shop");
    unmount();
    render(<App />);
    await heading("Sign in to your shop");
  });

  it("closing the app in the middle of onboarding shows it again next time (only finishing or Skip remembers it)", async () => {
    const { unmount } = render(<App />);
    await heading("KiranaBill");
    tap("Get started");
    await heading("Speak the whole order");
    unmount();
    render(<App />);
    await heading("KiranaBill");
  });

  it("Android Back: 3 -> 2 -> 1 -> splash; Sign in (reached through onboarding) -> 3", async () => {
    render(<App />);
    await throughWelcome();
    await androidBack();
    await heading("It learns your prices");
    await androidBack();
    await heading("Get a clear bill");
    await androidBack();
    await heading("Speak the whole order");
    await androidBack();
    await heading("KiranaBill");
  });

  it("the dots and the step count follow the page", async () => {
    render(<App />);
    await heading("KiranaBill");
    tap("Get started");
    await heading("Speak the whole order");
    tap("Next");
    expect(await screen.findByText("2 of 3")).toBeTruthy();
    tap("Next");
    expect(await screen.findByText("3 of 3")).toBeTruthy();
  });
});

describe("the words are true (defaults 2, 6, 7)", () => {
  it("onboarding 3 uses the owner's learning sentence - never 'Say a price once' or 'remembered'", async () => {
    render(<App />);
    await heading("KiranaBill");
    tap("Get started");
    tap("Next");
    tap("Next");
    await heading("It learns your prices");
    expect(screen.getByText(T("gen.tip"))).toBeTruthy();
    expect(screen.getByText("Approve once")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Say a price once|remembered/);
  });

  it("Sign in: the privacy link alone (no 'you agree'), to /privacy in a new tab", async () => {
    store.set("kb.welcomed.v1", "1");
    render(<App />);
    await heading("Sign in to your shop");
    const link = screen.getByRole("link", { name: "Privacy policy" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(link.target).toBe("_blank");
    expect(document.body.textContent).not.toMatch(/agree/i);
    for (const row of ["Bills saved safely to your shop", "Bill from more than one phone", "We never post to your Google account"]) expect(screen.getByText(row)).toBeTruthy();
  });

  it("printing is shown only in the Android app: the splash's '58 / 80 mm', onboarding 2's Print, Sign in's Print", async () => {
    for (const native of [false, true]) {
      env.native = native;
      store.clear();
      const { unmount } = render(<App />);
      await heading("KiranaBill");
      expect(!!screen.queryByText("58 / 80 mm")).toBe(native);
      tap("Get started");
      tap("Next");
      await heading("Get a clear bill");
      expect(!!screen.queryByText("Print")).toBe(native);
      expect(screen.getByText(native ? T("onb2.text") : T("onb2.textWeb"))).toBeTruthy();
      tap("Skip");
      await heading("Sign in to your shop");
      expect(!!screen.queryByText("Print")).toBe(native);
      unmount();
    }
  });
});

describe("Sign in", () => {
  it("offline: the tap says to check the internet; the button comes back", async () => {
    store.set("kb.welcomed.v1", "1");
    net.state.online = false;
    render(<App />);
    await heading("Sign in to your shop");
    tap("Sign in with Google");
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't start sign-in — check the internet and try again");
    expect(screen.getByRole("button", { name: "Sign in with Google" }).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("a returning user (onboarding done): Android Back from Sign in does not open the onboarding", async () => {
    store.set("kb.welcomed.v1", "1");
    render(<App />);
    await heading("Sign in to your shop");
    await androidBack();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to your shop" })).toBeTruthy();
  });
});

describe("Shop setup (06)", () => {
  async function toSetup() {
    store.set("kb.welcomed.v1", "1");
    render(<App />);
    await heading("Sign in to your shop");
    tap("Sign in with Google");
    await heading("Set up your shop");
  }

  it("change 4: the back arrow signs out and returns to Sign in - nothing is created", async () => {
    await toSetup();
    tap("Back");
    await heading("Sign in to your shop");
    expect(net.state.session).toBeNull();
    expect(net.state.created).toEqual([]);
  });

  it("change 4: Android Back signs out too", async () => {
    await toSetup();
    await androidBack();
    await heading("Sign in to your shop");
    expect(net.state.session).toBeNull();
    expect(net.state.created).toEqual([]);
  });

  it("a name is required", async () => {
    await toSetup();
    tap("Use ready catalog");
    expect((await screen.findByRole("alert")).textContent).toBe("Shop name is required.");
    expect(net.state.created).toEqual([]);
  });

  it("default 5: the phone is optional, but when given it is a 10-digit mobile (as in Edit shop details)", async () => {
    await toSetup();
    fireEvent.change(setupName(), { target: { value: "Gupta Store" } });
    fireEvent.change(setupPhone(), { target: { value: "12345" } });
    tap("Use ready catalog");
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a 10-digit mobile number");
    expect(net.state.created).toEqual([]);
    fireEvent.change(setupPhone(), { target: { value: "98765 43210" } });
    tap("Use ready catalog");
    await heading("Gupta Store");
    expect(net.state.created[0]!.phone).toBe("9876543210");
  });

  it("offline: today's sentence, nothing is created, the buttons come back", async () => {
    await toSetup();
    net.state.online = false;
    await act(async () => void window.dispatchEvent(new Event("offline")));
    fireEvent.change(setupName(), { target: { value: "Gupta Store" } });
    tap("Use ready catalog");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/internet/);
    expect(net.state.created).toEqual([]);
    expect(screen.getByRole("button", { name: "Use ready catalog" })).toBeTruthy();
  });

  it("the catalog question replaces Continue (default 3): Use ready catalog (primary), Start empty", async () => {
    await toSetup();
    expect(screen.getByText("Ready catalog, or start empty?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
    const ready = screen.getByRole("button", { name: "Use ready catalog" });
    const empty = screen.getByRole("button", { name: "Start empty" });
    expect(ready.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("3 languages", () => {
  for (const l of ["hi", "hl"] as const)
    it(`${l}: splash, onboarding, sign in and setup in that language; the language names never translated`, async () => {
      act(() => setScreenLanguage(l));
      render(<App />);
      await heading("KiranaBill");
      expect(screen.getByText(T("welcome.tagline1", l), { exact: false }).textContent).toBe(T("welcome.tagline1", l) + T("welcome.tagline2", l));
      tap(T("welcome.start", l));
      await heading(T("onb1.title", l));
      expect(screen.getByText("“2 किलो चीनी 45 रुपये किलो,")).toBeTruthy(); // the order as said, in every language
      tap(T("welcome.next", l));
      await heading(T("onb2.title", l));
      tap(T("welcome.next", l));
      await heading(T("onb3.title", l));
      tap(T("welcome.start", l));
      await heading(T("signin.title", l));
      tap(T("signin.google", l));
      await heading(T("onboard.title", l));
      expect(screen.getByRole("button", { name: T("onboard.ready", l) })).toBeTruthy();
      expect(within(screen.getByRole("figure")).getByText("Bill No.", { exact: false })).toBeTruthy();
    });
});
