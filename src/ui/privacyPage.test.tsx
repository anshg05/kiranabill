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
    expect((hindi.match(/[ऀ-ॿ]/g) ?? []).length).toBeGreaterThan(400); // a real translation, not a stub
    // KB-384a: "Last updated" becomes the real release date when V3 ships (docs/23 §8) - both languages always show the SAME date
    const [, day, month, year] = /Last updated (\d{1,2}) (\w+) (\d{4})/.exec(english)!;
    const HINDI_MONTH: Record<string, string> = { January: "जनवरी", February: "फ़रवरी", March: "मार्च", April: "अप्रैल", May: "मई", June: "जून", July: "जुलाई", August: "अगस्त", September: "सितंबर", October: "अक्टूबर", November: "नवंबर", December: "दिसंबर" };
    expect(hindi).toContain(`आखिरी बार बदला गया: ${day} ${HINDI_MONTH[month!]} ${year}`);
  });

  it("KB-384a (owner, 9 Nov 2026): voice recordings - kept 7 days after the bill (unbilled: 7 days after upload), never in backups, Gemini's paid terms - in BOTH languages", () => {
    for (const phrase of ["7 days after its bill is made", "7 days after it was recorded", "never copied into our backups", "deleted automatically", "your voice recordings", "within 7 days"]) expect(english, phrase).toContain(phrase);
    for (const phrase of ["बिल बनने के 7 दिन बाद", "रिकॉर्ड होने के 7 दिन बाद", "बैकअप में कभी नहीं", "अपने आप हट", "आवाज़ की रिकॉर्डिंग समेत", "7 दिन के अंदर"]) expect(hindi, phrase).toContain(phrase);
    // Gemini API Additional Terms (effective 23 Mar 2026), Paid Services: prompts and responses are not used to improve Google's products;
    // logged for a limited time only to detect misuse
    expect(english).toContain("under its paid API terms: it does not use it to improve its products, and keeps it only for a limited time to detect misuse");
    expect(hindi).toContain("अपनी पेड API शर्तों के तहत प्रोसेस करता है: वह इसका इस्तेमाल अपने प्रोडक्ट सुधारने में नहीं करता");
    // the old promise is gone (recordings ARE kept now), and Sarvam is not listed before KB-384b ships it
    expect(english).not.toContain("does not keep the recordings");
    expect(hindi).not.toContain("रिकॉर्डिंग अपने पास नहीं रखता");
    expect(page).not.toContain("Sarvam");
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
