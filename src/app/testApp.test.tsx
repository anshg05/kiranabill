// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { stubLocalStorage } from "@/ui/testStorage";

// Option (b) step 4 (owner, 19 Nov 2026; D115): the test app "KVB Test" (com.kiranavoicebill.app.test) is the same code built with
// VITE_APP_VARIANT=test. It shows a red TEST frame on every screen and a sign-in hint; the real app shows neither.

const auth = vi.hoisted(() => ({ value: { loading: false, userId: null as string | null, mode: "online", deviceDb: {}, signInWithGoogle: () => Promise.resolve(), signOut: vi.fn(() => Promise.resolve()) } }));
vi.mock("@/providers/AuthProvider", () => ({ AuthProvider: ({ children }: { children: unknown }) => children, useAuth: () => auth.value }));
const shopMounted = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/providers/ShopProvider", () => ({
  ShopProvider: ({ children }: { children: unknown }) => {
    shopMounted.count++;
    return children;
  },
  useShop: () => ({ loading: true, shop: null, loadError: false }),
}));

import { App } from "./App";
import { SignInScreen } from "@/ui/SignInScreen";
import { TEST_APP_USER_IDS, TEST_SIGN_IN_HINT, isTestApp } from "./testApp";

const TEST_USER = "77636ea8-8058-44ef-9762-76dfc47e5502";
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  auth.value = { ...auth.value, userId: null };
  shopMounted.count = 0;
});
const banner = () => screen.queryByTestId("test-app-banner");

describe("the test app's marks (D115)", () => {
  it("the build setting: only VITE_APP_VARIANT=test is the test app", () => {
    expect(isTestApp()).toBe(false);
    vi.stubEnv("VITE_APP_VARIANT", "test");
    expect(isTestApp()).toBe(true);
    vi.stubEnv("VITE_APP_VARIANT", "Test");
    expect(isTestApp()).toBe(false);
    expect(TEST_APP_USER_IDS).toEqual([TEST_USER]);
  });

  it("test app: the red TEST frame on the signed-out screens and on a signed-in screen; never takes a tap", () => {
    vi.stubEnv("VITE_APP_VARIANT", "test");
    stubLocalStorage();
    render(<App />);
    expect(banner()).toBeTruthy();
    expect(banner()!.textContent).toBe("TEST");
    expect(banner()!.className).toContain("pointer-events-none");
    cleanup();
    auth.value = { ...auth.value, userId: TEST_USER };
    render(<App />);
    expect(banner()).toBeTruthy();
  });

  it("real app: no TEST frame, signed out or in", () => {
    stubLocalStorage();
    render(<App />);
    expect(banner()).toBeNull();
    cleanup();
    auth.value = { ...auth.value, userId: TEST_USER };
    render(<App />);
    expect(banner()).toBeNull();
  });

  it("the sign-in hint: in the test app only", () => {
    expect(TEST_SIGN_IN_HINT).toBe("Use the TEST Google account (second Gmail)");
    render(<SignInScreen />);
    expect(screen.queryByText(TEST_SIGN_IN_HINT)).toBeNull();
    cleanup();
    vi.stubEnv("VITE_APP_VARIANT", "test");
    render(<SignInScreen />);
    expect(screen.getByText(TEST_SIGN_IN_HINT)).toBeTruthy();
  });
});

// Step 4 commit 2: the test app uses the PRODUCTION database, so it opens only for the test Google account. The check sits in AuthGate
// BEFORE <ShopProvider> renders: for any other account (the owner's real one - the only way to his real shop) no phone database is
// opened, no shop is read from the server, nothing is downloaded and no sync starts - ShopProvider never mounts.
describe("the test app opens only for the test account (D115)", () => {
  const REAL_OWNER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  it("test app + another account (the real shop's owner): refused before ShopProvider mounts - nothing opened, read, pulled or synced", async () => {
    vi.stubEnv("VITE_APP_VARIANT", "test");
    auth.value = { ...auth.value, userId: REAL_OWNER };
    render(<App />);
    expect(screen.getByRole("heading", { name: "This test app only opens the TEST account" })).toBeTruthy();
    expect(shopMounted.count).toBe(0);
    expect(await indexedDB.databases()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.value.signOut).toHaveBeenCalledOnce();
  });

  it("test app + the test account: the shop loads as usual", () => {
    vi.stubEnv("VITE_APP_VARIANT", "test");
    auth.value = { ...auth.value, userId: TEST_USER };
    render(<App />);
    expect(shopMounted.count).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "This test app only opens the TEST account" })).toBeNull();
  });

  it("real app: every account loads as today", () => {
    for (const userId of [REAL_OWNER, TEST_USER]) {
      auth.value = { ...auth.value, userId };
      render(<App />);
      expect(shopMounted.count).toBeGreaterThan(0);
      expect(screen.queryByRole("heading", { name: "This test app only opens the TEST account" })).toBeNull();
      cleanup();
      shopMounted.count = 0;
    }
  });
});
