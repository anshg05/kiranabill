// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import { MESSAGES } from "@/domain/messages";
import { APP_NAME } from "./appName";
import { HomeScreen } from "./HomeScreen";
import { SignedOutFlow } from "./WelcomeScreens";
import { setScreenLanguage } from "./screenLanguage";

// Owner, 18 Nov 2026 (D111): the app's name a person sees is "Kirana Voice Bill" - the Android app's label, the splash, Sign in, the logo,
// Home with no shop name, the browser tab, the installed web app, the privacy page. Internal names (the IndexedDB "kiranabill-device",
// storage keys, KiranaBillDB, Supabase, com.kiranavoicebill.app) are NOT renamed: a storage rename would lose every phone's local data.

vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve() }) }));

const ROOT = join(__dirname, "..", "..");
const file = (p: string) => readFileSync(join(ROOT, p), "utf8");
afterEach(() => {
  cleanup();
  act(() => setScreenLanguage("en"));
});

describe("the visible name is 'Kirana Voice Bill'", () => {
  it("one constant", () => expect(APP_NAME).toBe("Kirana Voice Bill"));

  it("the splash (01): the title and the logo's name", () => {
    render(<SignedOutFlow start={0} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Kirana Voice Bill");
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Kirana Voice Bill logo");
  });

  it("Sign in (05): the hero's name and the logo's name, in every language", () => {
    for (const l of ["en", "hi", "hl"] as const) {
      act(() => setScreenLanguage(l));
      const { unmount } = render(<SignedOutFlow start={4} />);
      expect(screen.getByText("Kirana Voice Bill")).toBeTruthy();
      expect(screen.getByRole("img").getAttribute("alt")).toBe("Kirana Voice Bill logo");
      unmount();
    }
  });

  it("Home with no shop name shows the app's name", async () => {
    const db = new KiranaBillDB(`ui-appname-${crypto.randomUUID()}`);
    render(<HomeScreen localDb={db} shopId="s" onRecord={() => {}} onType={() => {}} onOpenBill={() => {}} onSeeAll={() => {}} onProfile={() => {}} />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Kirana Voice Bill");
    db.close();
    await db.delete();
  });

  it("the browser tab, the installed web app (name; the home-screen label), the Android app's label", () => {
    expect(file("index.html")).toContain("<title>Kirana Voice Bill</title>");
    const manifest = JSON.parse(file("public/manifest.webmanifest")) as { name: string; short_name: string };
    expect(manifest.name).toBe("Kirana Voice Bill");
    expect(manifest.short_name).toBe("Kirana Voice Bill");
    expect(file("android/app/src/main/res/values/strings.xml")).toContain('<string name="app_name">Kirana Voice Bill</string>');
  });

  it("the privacy page (English and Hindi) names the app 'Kirana Voice Bill'", () => {
    const page = file("public/privacy.html");
    expect(page).toContain("<title>Kirana Voice Bill — Privacy policy</title>");
    expect(page).toContain("<h1>Kirana Voice Bill — Privacy policy</h1>");
    expect(page).toContain("Kirana Voice Bill छोटी दुकानों");
  });

  it("no screen, message or public page shows the old name 'KiranaBill' any more", () => {
    expect(Object.values(MESSAGES).flatMap((m) => Object.values(m)).filter((t) => /KiranaBill/.test(t))).toEqual([]);
    for (const p of ["index.html", "public/manifest.webmanifest", "public/privacy.html"]) expect(file(p), p).not.toMatch(/KiranaBill/);
    for (const f of ["WelcomeScreens.tsx", "SignInScreen.tsx", "HomeScreen.tsx"]) expect(file(`src/ui/${f}`).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/KiranaBill(?!DB)/); // the type KiranaBillDB is internal
  });

  it("what must NOT change: the phone's storage names (a rename would lose every phone's local data)", () => {
    expect(file("src/data/device.ts")).toMatch(/"kiranabill-device"/);
    expect(file("src/data/db.ts")).toContain("return `kiranabill-${userId}`;");
    expect(file("capacitor.config.ts")).toContain('appId: "com.kiranavoicebill.app"');
  });
});
