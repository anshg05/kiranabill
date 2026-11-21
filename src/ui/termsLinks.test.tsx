// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";

// KB-435 (owner, 21 Nov 2026; D126): the Terms are linked from the sign-in screen (a plain link beside Privacy - no "I agree", sign-in
// unchanged), More (under Privacy) and Help & support. Inside the app the links go to the public page (the app's own /terms would be
// the app itself), as Privacy does.

const env = vi.hoisted(() => ({ native: true }));
vi.mock("@/data/nativeSignIn", async (orig) => ({ ...(await orig<typeof import("@/data/nativeSignIn")>()), isNativeApp: () => env.native }));
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve() }) }));

import { TERMS_PAGE_URL, termsHref } from "./privacyLink";
import { SignInScreen } from "./SignInScreen";
import { MoreScreen } from "./MoreScreen";
import { HelpPage } from "./HelpPage";

let db: KiranaBillDB | null = null;
afterEach(async () => {
  cleanup();
  db?.close();
  await db?.delete();
  db = null;
  env.native = true;
});

const terms = () => screen.getByRole("link", { name: /^Terms of Service/ });

describe("the Terms links", () => {
  it("the public page is the website's /terms; on the website the links stay /terms", () => {
    expect(TERMS_PAGE_URL).toBe("https://kiranabilling.netlify.app/terms");
    expect(termsHref()).toBe(TERMS_PAGE_URL);
    env.native = false;
    expect(termsHref()).toBe("/terms");
  });

  it("sign-in: 'Privacy policy · Terms of Service', two plain links - no checkbox, nothing to agree to", () => {
    render(<SignInScreen />);
    const privacy = screen.getByRole("link", { name: "Privacy policy" });
    expect(terms().getAttribute("href")).toBe(TERMS_PAGE_URL);
    expect(privacy.parentElement).toBe(terms().parentElement);
    expect(privacy.parentElement!.textContent).toBe("Privacy policy · Terms of Service");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.body.textContent).not.toMatch(/agree/i);
  });

  it("More: a Terms of Service row right under Privacy", async () => {
    db = new KiranaBillDB(`terms-app-${crypto.randomUUID()}`);
    await db.shops.put({ id: "s", syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-08T10:00:00.000Z" });
    render(<MoreScreen localDb={db} shopId="s" deviceId="d" sync={{ chip: null, unsynced: { pending: 0, conflict: 0 }, detail: { pending: 0, conflict: 0, lastAttemptAt: null } }} billInProgress={false} onSignOut={() => {}} onItems={() => {}} onClose={() => {}} />);
    const privacy = await screen.findByRole("link", { name: /^Privacy/ });
    expect(terms().getAttribute("href")).toBe(TERMS_PAGE_URL);
    expect(privacy.compareDocumentPosition(terms()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(privacy.closest("li")?.nextElementSibling ?? privacy.nextElementSibling).toBeTruthy();
  });

  it("Help & support: Terms next to Privacy", () => {
    render(<HelpPage onClose={() => {}} />);
    expect(terms().getAttribute("href")).toBe(TERMS_PAGE_URL);
  });
});
