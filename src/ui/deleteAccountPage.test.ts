import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideFetch } from "@/sw/core";
import { selectPrecache } from "@/sw/precache";

// KB-430 (owner, 20 Nov 2026; D119): the web page Google Play requires for account deletion - it must name the app, show the
// deletion path prominently, and let a user ask for deletion WITHOUT the app (a request e-mail is acceptable; Play Console Help
// 13327111). Like /privacy: its own static page, no script, never the app shell, never precached. Live with the next website release.

const root = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const page = read("public/delete-account.html");
const english = page.slice(page.indexOf('id="english"'), page.indexOf('id="hindi"'));
const hindi = page.slice(page.indexOf('id="hindi"'));

describe("public/delete-account.html", () => {
  it("names the app, in English with हिन्दी below", () => {
    expect(page).toMatch(/^<!doctype html>/i);
    expect(page).toContain("<title>Kirana Voice Bill — Delete your account</title>");
    expect(english).toContain("<h1>Kirana Voice Bill — Delete your account</h1>");
    expect(hindi).toContain("<h1>Kirana Voice Bill — अपना खाता हटाएँ</h1>");
    expect((hindi.match(/[ऀ-ॿ]/g) ?? []).length).toBeGreaterThan(400); // a real translation
  });

  it("the in-app path, as the app labels it (More -> Account -> Delete account; the typed name; Delete everything)", () => {
    expect(english).toContain("More → Account → Delete account");
    expect(english).toContain("Delete everything");
    expect(hindi).toContain("More → खाता → खाता हटाएँ");
    expect(hindi).toContain("सब कुछ हटाएँ");
  });

  it("a request WITHOUT the app: the support e-mail, from the sign-in Google account, done within 7 days - in both languages", () => {
    for (const text of [english, hindi]) {
      expect(text).toContain('href="mailto:kiranavoicebill@gmail.com"');
      expect(text).toContain(">kiranavoicebill@gmail.com<");
      expect(text).toContain("7");
    }
    expect(english).toContain("within 7 days");
  });

  it("says what is deleted and what stays in the backups, and for how long (at most about 4 months)", () => {
    for (const phrase of ["Your login", "bills (including cancelled bills)", "customers' names and mobile numbers", "voice recordings", "other members", "at most about 4 months", "never to bring back a deleted account"]) expect(english, phrase).toContain(phrase);
    for (const phrase of ["लॉगिन", "रद्द किए गए बिल", "मोबाइल नंबर", "रिकॉर्डिंग", "और लोग", "लगभग 4 महीने"]) expect(hindi, phrase).toContain(phrase);
  });

  it("no script, tracker or outside file; links home and to /privacy", () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/(src|href)="https?:\/\//i);
    expect(page).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(page).toContain('href="/"');
    expect(page).toContain('href="/privacy"');
  });

  it("Netlify serves /delete-account as this page (a rewrite, status 200); the worker never answers it, nor precaches it", () => {
    expect(read("netlify.toml")).toMatch(/\[\[redirects\]\][^\[]*from\s*=\s*"\/delete-account"[^\[]*to\s*=\s*"\/delete-account\.html"[^\[]*status\s*=\s*200/s);
    expect(decideFetch({ url: "https://kiranabilling.netlify.app/delete-account", method: "GET", mode: "navigate" }, "https://kiranabilling.netlify.app", new Set(["/"]))).toEqual({ kind: "network" });
    expect(selectPrecache(["index.html", "delete-account.html", "assets/x.js"])).toEqual(["/", "/assets/x.js"]);
  });
});

describe("public/privacy.html - the deletion section (KB-430)", () => {
  const privacy = read("public/privacy.html");
  const en = privacy.slice(privacy.indexOf('id="english"'), privacy.indexOf('id="hindi"'));
  const hi = privacy.slice(privacy.indexOf('id="hindi"'));
  it("points to the in-app deletion and the /delete-account page, and states the backup period (about 4 months) - both languages", () => {
    for (const text of [en, hi]) {
      expect(text).toContain('href="/delete-account"');
      expect(text).toContain("4");
    }
    expect(en).toContain("More → Account → Delete account");
    expect(en).toContain("about 4 months");
    expect(hi).toContain("लगभग 4 महीने");
  });
});
