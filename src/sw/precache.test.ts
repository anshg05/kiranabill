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
  ...["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"].flatMap((s) => [400, 600].flatMap((w) => [`assets/ibm-plex-mono-${s}-${w}-normal-ZyXw9876.woff2`, `assets/ibm-plex-mono-${s}-${w}-normal-ZyXw9876.woff`])),
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

  it("keeps every Mukta woff2 (12 files) and no woff", () => {
    const mukta = urls.filter((u) => u.includes("/mukta-"));
    expect(mukta).toHaveLength(12);
    expect(mukta.every((u) => u.endsWith(".woff2"))).toBe(true);
  });

  it("keeps only IBM Plex Mono latin + latin-ext, 400 and 600, woff2 (4 files)", () => {
    const plex = urls.filter((u) => u.includes("/ibm-plex-mono-")).sort();
    expect(plex).toEqual([
      "/assets/ibm-plex-mono-latin-400-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-600-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-ext-400-normal-ZyXw9876.woff2",
      "/assets/ibm-plex-mono-latin-ext-600-normal-ZyXw9876.woff2",
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
