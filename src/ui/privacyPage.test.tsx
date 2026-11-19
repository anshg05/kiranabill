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
import { MoreScreen } from "./MoreScreen";
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
    for (const phrase of ["7 days after its bill is made", "7 days after it was recorded", "never copied into our backups", "deleted automatically", "within 7 days"]) expect(english, phrase).toContain(phrase);
    for (const phrase of ["बिल बनने के 7 दिन बाद", "रिकॉर्ड होने के 7 दिन बाद", "बैकअप में कभी नहीं", "अपने आप हट", "7 दिन के अंदर"]) expect(hindi, phrase).toContain(phrase);
    // Gemini API Additional Terms (aistudio.google.com/docs/terms, effective 23 Mar 2026), Paid Services: prompts and responses are not
    // used to improve Google's products; logged for a limited time to detect misuse and for legal reasons; may be processed in any country
    expect(english).toContain("Google does not use what we send to improve its products; it keeps it for a limited time only to detect misuse and for legal reasons, and may process it in any country where Google has facilities");
    expect(hindi).toContain("Google हमारा भेजा हुआ अपने प्रोडक्ट सुधारने में इस्तेमाल नहीं करता");
    // the old promise is gone (recordings ARE kept now), and Sarvam is not listed before KB-384b ships it
    expect(english).not.toContain("does not keep the recordings");
    expect(hindi).not.toContain("रिकॉर्डिंग अपने पास नहीं रखता");
    expect(page).not.toContain("Sarvam");
  });

  it("D120 (owner, 20 Nov 2026): the processors and where they are - Groq gone (removed 18 Nov), no text path for Gemini; the support address", () => {
    for (const [name, text] of [["English", english], ["हिन्दी", hindi]] as const) {
      for (const processor of ["Google", "Supabase", "Netlify", "Gemini", "Drive"]) expect(text, `${name}: ${processor}`).toContain(processor);
      expect(text, `${name}: Groq`).not.toContain("Groq");
      expect(text, name).toContain('href="mailto:kiranavoicebill@gmail.com"');
      expect(text, name).toContain(">kiranavoicebill@gmail.com<");
      expect(text, name).not.toContain("anshgupta0404");
    }
    expect(english).toContain("Its servers are in Mumbai, India.");
    expect(english).toContain("It runs in the USA.");
    expect(hindi).toContain("मुंबई, भारत");
    expect(hindi).toContain("अमेरिका (USA)");
    expect(english).not.toMatch(/read an order's text/); // the text path was deleted with the old voice path (18 Nov 2026)
    expect(hindi).not.toContain("लिखा हुआ रूप खुद नहीं पढ़ पाता");
  });

  it("D120: every kind of data the code collects is named - in BOTH languages", () => {
    for (const phrase of ["your email address, your name, a link to your profile picture and your Google account id", "name and phone number", "bill language", "customer's name and mobile number", "names you use for your products", "prices you charged", "A device id", "Usage numbers for each bill", "Diagnostics", "the app version", "On your phone only", "printer choice"]) expect(english, phrase).toContain(phrase);
    for (const phrase of ["ईमेल पता, आपका नाम, आपकी प्रोफ़ाइल फ़ोटो का लिंक और आपके Google खाते की आईडी", "नाम और फ़ोन नंबर", "बिल की भाषा", "नाम और मोबाइल नंबर", "आपके लगाए भाव", "फ़ोन की आईडी", "इस्तेमाल के आँकड़े", "डायग्नोस्टिक्स", "ऐप का वर्ज़न", "सिर्फ़ आपके फ़ोन पर", "प्रिंटर का चुनाव"]) expect(hindi, phrase).toContain(phrase);
    // not collected: the shop's address and logo exist in the schema but no screen sets them - the page must not claim them
    expect(english).not.toMatch(/address of your shop|shop's address|your logo/i);
  });

  it("D120: the permissions and why; IP addresses in the providers' logs only; no ads; children; retention and deletion", () => {
    for (const phrase of ["Microphone", "Nearby devices (Bluetooth)", "Location (Android 11 and older only)", "never reads your location", "Internet and network state"]) expect(english, phrase).toContain(phrase);
    for (const phrase of ["माइक्रोफ़ोन", "ब्लूटूथ", "Android 11 और पुराने", "लोकेशन कभी नहीं पढ़ता", "नेटवर्क की हालत"]) expect(hindi, phrase).toContain(phrase);
    expect(english).toContain("Supabase and Netlify keep standard server logs, including your IP address, for a limited time");
    expect(english).toContain("Our own code does not store IP addresses.");
    expect(hindi).toContain("हमारा अपना कोड IP पते नहीं रखता");
    expect(english).toContain("no advertising or tracking tools");
    expect(english).toContain("We do not sell your data");
    expect(hindi).toContain("डेटा नहीं बेचते");
    expect(english).toContain("not for children");
    expect(hindi).toContain("बच्चों के लिए नहीं");
    for (const phrase of ["as long as your account exists", "about 4 months", "More → Account → Delete account"]) expect(english, phrase).toContain(phrase);
    for (const phrase of ["जब तक आपका खाता है", "लगभग 4 महीने", "More → खाता → खाता हटाएँ"]) expect(hindi, phrase).toContain(phrase);
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

describe("More links to it (KB-414 step 4: 17's Privacy row; was Settings' link)", () => {
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
  it("a 'Privacy' row linking to /privacy that opens in a new tab - and in हिन्दी", async () => {
    const { unmount } = render(<MoreScreen localDb={db} shopId="s" deviceId="d" sync={{ chip: null, unsynced: { pending: 0, conflict: 0 }, detail: { pending: 0, conflict: 0, lastAttemptAt: null } }} billInProgress={false} onSignOut={() => {}} onItems={() => {}} onClose={() => {}} />);
    const link = (await screen.findByRole("link", { name: "Privacy" })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    unmount();
    setScreenLanguage("hi");
    render(<MoreScreen localDb={db} shopId="s" deviceId="d" sync={{ chip: null, unsynced: { pending: 0, conflict: 0 }, detail: { pending: 0, conflict: 0, lastAttemptAt: null } }} billInProgress={false} onSignOut={() => {}} onItems={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole("link", { name: "गोपनीयता" })).toBeTruthy();
  });
});
