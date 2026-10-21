// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import { decideFetch } from "@/sw/core";
import { selectPrecache } from "@/sw/precache";
import { setScreenLanguage } from "./screenLanguage";
import { SettingsScreen } from "./SettingsScreen";
import { stubLocalStorage } from "./testStorage";

// D91 (owner, 21 Oct 2026): a MINIMAL public privacy-policy page for Google's consent screen - not KB-347 (no consent flow, no
// acceptance records). /privacy is its own static page: not the app shell, not precached, linked from Settings.

const root = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
stubLocalStorage();

describe("public/privacy.html", () => {
  const page = read("public/privacy.html");
  const english = page.slice(page.indexOf('id="english"'), page.indexOf('id="hindi"'));
  const hindi = page.slice(page.indexOf('id="hindi"'));

  it("is a whole page of its own, in English with हिन्दी below, with a date", () => {
    expect(page).toMatch(/^<!doctype html>/i);
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('<section id="english" lang="en">');
    expect(page).toContain('<section id="hindi" lang="hi">');
    expect(page.indexOf('id="english"')).toBeLessThan(page.indexOf('id="hindi"'));
    expect(page).toMatch(/Last updated \d{1,2} October 2026/);
    expect((hindi.match(/[ऀ-ॿ]/g) ?? []).length).toBeGreaterThan(400); // a real translation, not a stub
    expect(hindi).toContain("21 अक्टूबर 2026");
  });

  it("says what the owner listed - in BOTH languages: what is collected, why, the processors, retention, deletion, the contact", () => {
    for (const [name, text] of [["English", english], ["हिन्दी", hindi]] as const) {
      for (const processor of ["Google", "Supabase", "Netlify", "Groq", "Gemini", "Drive"]) expect(text, `${name}: ${processor}`).toContain(processor);
      expect(text, name).toContain('href="mailto:anshgupta0404@gmail.com"');
      expect(text, name).toContain(">anshgupta0404@gmail.com<");
      expect(text, name).toContain("3");
    }
    for (const phrase of ["shop", "email address and name", "name and mobile number", "recording", "Why", "3 months", "delete"]) expect(english.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    for (const phrase of ["दुकान", "ईमेल", "मोबाइल", "रिकॉर्डिंग", "क्यों", "3 महीने", "हटवाने"]) expect(hindi, phrase).toContain(phrase);
  });

  it("links home ('/') and keeps no script, tracker or outside file (a privacy page must not track)", () => {
    expect(page).toContain('href="/"');
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/(src|href)="https?:\/\//i);
    expect(page).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(page).not.toMatch(/TODO|lorem|XXX/i);
  });
});

describe("/privacy is served as its own page", () => {
  it("Netlify rewrites /privacy to the static file (status 200, not a redirect, not the shell)", () => {
    expect(read("netlify.toml")).toMatch(/\[\[redirects\]\][^\[]*from\s*=\s*"\/privacy"[^\[]*to\s*=\s*"\/privacy\.html"[^\[]*status\s*=\s*200/s);
  });
  it("the service worker never answers /privacy with the app shell - a navigation goes to the network", () => {
    for (const path of ["/privacy", "/privacy.html"]) {
      expect(decideFetch({ url: `https://kiranabilling.netlify.app${path}`, method: "GET", mode: "navigate" }, "https://kiranabilling.netlify.app", new Set(["/"])), path).toEqual({ kind: "network" });
    }
  });
  it("and it is not precached (the cache holds app files only)", () => {
    expect(selectPrecache(["index.html", "privacy.html", "assets/x.js"])).toEqual(["/", "/assets/x.js"]);
  });
});

describe("Settings links to it", () => {
  let db: KiranaBillDB;
  beforeEach(async () => {
    db = new KiranaBillDB(`ui-privacy-${crypto.randomUUID()}`);
    await db.shops.put({ id: "s", syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-08T10:00:00.000Z" });
  });
  afterEach(async () => {
    cleanup();
    setScreenLanguage("en");
    db.close();
    await db.delete();
  });
  it("a 'Privacy policy' link to /privacy that opens in a new tab - and in हिन्दी", async () => {
    const { unmount } = render(<SettingsScreen localDb={db} shopId="s" deviceId="d" onClose={() => {}} />);
    const link = (await screen.findByRole("link", { name: "Privacy policy" })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    unmount();
    setScreenLanguage("hi");
    render(<SettingsScreen localDb={db} shopId="s" deviceId="d" onClose={() => {}} />);
    expect(await screen.findByRole("link", { name: "गोपनीयता नीति" })).toBeTruthy();
  });
});
