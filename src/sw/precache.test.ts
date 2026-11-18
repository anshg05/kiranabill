import { describe, expect, it } from "vitest";
import { assertSafePrecache, selectPrecache } from "./precache";

// KB-401 (D67): what the service worker precaches - the app shell, JS/CSS, Mukta (woff2, all subsets), and ONLY the
// IBM Plex Mono latin + latin-ext 400/600 woff2 (KB-308 note) - and what it must never be told to hold.
const DIST = [
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg",
  "assets/index-4kpVDihe.js",
  "assets/index-4kpVDihe.js.map",
  "assets/index-DnLQ1OBX.css",
  ...["devanagari", "latin", "latin-ext"].flatMap((s) => [400, 500, 600, 700].flatMap((w) => [`assets/mukta-${s}-${w}-normal-AbCd1234.woff2`, `assets/mukta-${s}-${w}-normal-AbCd1234.woff`])),
  ...["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"].flatMap((s) => [400, 600, 700].flatMap((w) => [`assets/ibm-plex-mono-${s}-${w}-normal-ZyXw9876.woff2`, `assets/ibm-plex-mono-${s}-${w}-normal-ZyXw9876.woff`])),
  // KB-411: the new look's variable fonts - every subset the packages ship (no .woff in the variable packages)
  ...["cyrillic", "cyrillic-ext", "greek", "greek-ext", "latin", "latin-ext", "vietnamese"].map((s) => `assets/inter-${s}-wght-normal-Qq11Ww22.woff2`),
  ...["devanagari", "latin", "latin-ext"].map((s) => `assets/noto-sans-devanagari-${s}-wght-normal-Ee33Rr44.woff2`),
];

describe("selectPrecache", () => {
  const urls = selectPrecache(DIST);

  it("maps index.html to / and keeps the app files", () => {
    expect(urls).toContain("/");
    expect(urls).not.toContain("/index.html");
    expect(urls).toContain("/assets/index-4kpVDihe.js");
    expect(urls).toContain("/assets/index-DnLQ1OBX.css");
    expect(urls).toContain("/manifest.webmanifest");
    expect(urls).toContain("/icons/icon-192.png");
    expect(urls).toContain("/icons/icon-512.png");
    expect(urls).toContain("/icons/icon-maskable-512.png");
  });

  // KB-429 (owner + reviewer, 18 Nov 2026, option A): Mukta is gone - not even a stray built file is ever precached
  it("never precaches Mukta (KB-429) - Devanagari is Noto Sans Devanagari now", () => {
    expect(urls.filter((u) => u.includes("/mukta-"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/noto-sans-devanagari-devanagari-"))).toHaveLength(1);
  });

  it("keeps only IBM Plex Mono latin + latin-ext, 400, 600 and 700 (the printed bill's bold, KB-408), woff2 (6 files)", () => {
    const plex = urls.filter((u) => u.includes("/ibm-plex-mono-")).sort();
    expect(plex).toEqual([
      "/assets/ibm-plex-mono-latin-400-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-600-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-700-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-ext-400-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-ext-600-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-ext-700-normal-ZyXw9876.woff2",
    ]);
  });

  // KB-411 (owner-approved plan, 14 Nov 2026): the new look must work offline - Inter latin + latin-ext (latin-ext holds the
  // rupee sign) and ONLY the Devanagari part of Noto Sans Devanagari (Inter draws every Latin letter). About 248 KB.
  it("keeps only Inter latin + latin-ext and Noto Sans Devanagari's Devanagari, variable woff2 (3 files)", () => {
    expect(urls.filter((u) => u.includes("/inter-") || u.includes("/noto-sans-devanagari-")).sort()).toEqual([
      "/assets/inter-latin-ext-wght-normal-Qq11Ww22.woff2",
      "/assets/inter-latin-wght-normal-Qq11Ww22.woff2",
      "/assets/noto-sans-devanagari-devanagari-wght-normal-Ee33Rr44.woff2",
    ]);
  });

  it("drops source maps and every .woff fallback", () => {
    expect(urls.some((u) => u.endsWith(".map"))).toBe(false);
    expect(urls.some((u) => u.endsWith(".woff"))).toBe(false);
  });

  it("is sorted and has no duplicates", () => {
    expect(urls).toEqual([...new Set(urls)].sort());
  });

  it("keeps a non-font file under assets/ (an image the app imports must work offline)", () => {
    expect(selectPrecache(["index.html", "assets/logo-AAA.svg"])).toContain("/assets/logo-AAA.svg");
  });

  it("never lists the worker itself", () => {
    expect(selectPrecache(["index.html", "sw.js"])).toEqual(["/"]);
  });
});

describe("assertSafePrecache", () => {
  const good = ["/", "/assets/index-A.js", "/assets/index-A.css", "/manifest.webmanifest", "/icons/icon-192.png"];

  it("accepts a normal list", () => {
    expect(() => assertSafePrecache(good)).not.toThrow();
  });

  it.each(["/voice", "/.netlify/functions/voice", "/__dev/typeahead", "/sw.js", "/index.html", "https://abc.supabase.co/rest/v1/x", "/assets/../secret", "//evil.example/x.js", "/rest/v1/shops"])(
    "refuses %s",
    (bad) => {
      expect(() => assertSafePrecache([...good, bad])).toThrow();
    },
  );

  it("refuses a list without the shell, or without any script", () => {
    expect(() => assertSafePrecache(good.filter((u) => u !== "/"))).toThrow(/shell/i);
    expect(() => assertSafePrecache(["/", "/manifest.webmanifest"])).toThrow(/script/i);
  });
});
