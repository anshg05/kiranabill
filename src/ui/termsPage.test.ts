import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideFetch } from "@/sw/core";
import { selectPrecache } from "@/sw/precache";

// KB-435 (owner, 21 Nov 2026; D126): the Terms of Service - a short plain page next to /privacy, English with हिन्दी below, the owner's
// wording. Like /privacy: its own static page, no script, never the app shell, never precached. Live with the website release.

const root = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const page = read("public/terms.html");
const english = page.slice(page.indexOf('id="english"'), page.indexOf('id="hindi"'));
const hindi = page.slice(page.indexOf('id="hindi"'));
const h2 = (text: string) => [...text.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);

describe("public/terms.html", () => {
  it("names the app, in English with हिन्दी below, the same sections in both", () => {
    expect(page).toMatch(/^<!doctype html>/i);
    expect(page).toContain("<title>Kirana Voice Bill — Terms of Service</title>");
    expect(english).toContain("<h1>Kirana Voice Bill — Terms of Service</h1>");
    expect(hindi).toContain("<h1>Kirana Voice Bill — सेवा की शर्तें</h1>");
    expect(h2(english)).toEqual(["The service", "Your account", "Your data is yours", "Check every bill", "Fair use", "Availability", "Charges", "Limits of our responsibility", "Changes to these terms", "Law", "Contact"]);
    expect(h2(hindi)).toHaveLength(11);
    expect((hindi.match(/[ऀ-ॿ]/g) ?? []).length).toBeGreaterThan(800); // a real translation
    for (const text of [english, hindi]) expect(text).toMatch(/class="meta">(Last updated|अंतिम बदलाव) \d{1,2} (November|नवंबर) 2026</);
  });

  it("the owner's lines (21 Nov 2026), in both languages", () => {
    for (const line of [
      "Before we ever charge for anything, we will tell you in advance.",
      "These terms are governed by the laws of India.",
      "Bills made with the app are not GST tax invoices.",
      "We may suspend an account that misuses the service.",
      "Check each line before Bill Banao.",
      "The app never makes up a price",
      "One Google account has one shop.",
      "18",
    ])
      expect(english, line).toContain(line);
    for (const line of ["किसी भी चीज़ के लिए पैसे लेने से पहले हम आपको पहले से बताएँगे।", "ये शर्तें भारत के कानूनों के अधीन हैं।", "GST टैक्स इनवॉइस नहीं", "खाता हम रोक सकते हैं", "Bill Banao"]) expect(hindi, line).toContain(line);
  });

  it("says nothing the owner left out: no free, pilot, price, city or courts", () => {
    for (const text of [english, hindi]) expect(text).not.toMatch(/\bfree\b|\bpilot\b|₹|\bcourts?\b|Nagpur|मुफ़्त|पायलट|अदालत|न्यायालय/i);
  });

  it("contact, privacy, deletion and home links; no script, tracker or outside file", () => {
    for (const text of [english, hindi]) {
      expect(text).toContain('href="mailto:kiranavoicebill@gmail.com"');
      expect(text).toContain('href="/privacy"');
      expect(text).toContain('href="/delete-account"');
    }
    expect(page).toContain('href="/"');
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/(src|href)="https?:\/\//i);
  });

  it("Netlify serves /terms as this page (a rewrite, status 200); the worker never answers it, nor precaches it", () => {
    expect(read("netlify.toml")).toMatch(/\[\[redirects\]\][^\[]*from\s*=\s*"\/terms"[^\[]*to\s*=\s*"\/terms\.html"[^\[]*status\s*=\s*200/s);
    expect(decideFetch({ url: "https://kiranabilling.netlify.app/terms", method: "GET", mode: "navigate" }, "https://kiranabilling.netlify.app", new Set(["/"]))).toEqual({ kind: "network" });
    expect(selectPrecache(["index.html", "terms.html", "assets/x.js"])).toEqual(["/", "/assets/x.js"]);
  });

  it("/privacy and /delete-account link to it", () => {
    for (const f of ["public/privacy.html", "public/delete-account.html"]) expect(read(f), f).toContain('href="/terms"');
  });
});
