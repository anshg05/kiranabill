// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";

// Option (b) step 3 (owner, 18 Nov 2026): the bundled app's own address is https://localhost, where "/privacy" would open the app
// itself (the /privacy rewrite exists only on Netlify). Inside the app both Privacy links go to the public page, which Capacitor opens
// in the phone's browser (another site); on the website they stay "/privacy", as before.

const env = vi.hoisted(() => ({ native: true }));
vi.mock("@/data/nativeSignIn", async (orig) => ({ ...(await orig<typeof import("@/data/nativeSignIn")>()), isNativeApp: () => env.native }));
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve() }) }));

import { PRIVACY_PAGE_URL, privacyHref } from "./privacyLink";
import { SignInScreen } from "./SignInScreen";
import { MoreScreen } from "./MoreScreen";

let db: KiranaBillDB | null = null;
afterEach(async () => {
  cleanup();
  db?.close();
  await db?.delete();
  db = null;
  env.native = true;
});

const more = async () => {
  db = new KiranaBillDB(`privacy-app-${crypto.randomUUID()}`);
  await db.shops.put({ id: "s", syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-08T10:00:00.000Z" });
  render(<MoreScreen localDb={db} shopId="s" deviceId="d" sync={{ chip: null, unsynced: { pending: 0, conflict: 0 }, detail: { pending: 0, conflict: 0, lastAttemptAt: null } }} billInProgress={false} onSignOut={() => {}} onItems={() => {}} onClose={() => {}} />);
  return (await screen.findByRole("link", { name: /^Privacy/ })).getAttribute("href");
};

describe("the Privacy links in the bundled app", () => {
  it("the public page is the website's /privacy", () => {
    expect(PRIVACY_PAGE_URL).toBe("https://kiranabilling.netlify.app/privacy");
  });

  it("in the app: More and the sign-in screen link to the public page", async () => {
    expect(privacyHref()).toBe(PRIVACY_PAGE_URL);
    expect(await more()).toBe(PRIVACY_PAGE_URL);
    cleanup();
    render(<SignInScreen />);
    expect(screen.getByRole("link", { name: /privacy/i }).getAttribute("href")).toBe(PRIVACY_PAGE_URL);
  });

  it("on the website: /privacy on its own site, as before", async () => {
    env.native = false;
    expect(privacyHref()).toBe("/privacy");
    expect(await more()).toBe("/privacy");
    cleanup();
    render(<SignInScreen />);
    expect(screen.getByRole("link", { name: /privacy/i }).getAttribute("href")).toBe("/privacy");
  });
});
