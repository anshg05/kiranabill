import { describe, expect, it } from "vitest";
import { decideFetch } from "./core";

// KB-401 (docs/07-DECISIONS.md D67): the service worker's routing decision. The worker answers ONLY a same-origin
// exact precache match and a same-origin navigation to "/"; everything else is the network's, untouched.
const ORIGIN = "https://app.example";
const URLS = new Set(["/", "/assets/index-AAA.js", "/assets/index-AAA.css", "/manifest.webmanifest"]);
const req = (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => ({
  url: `${init.origin ?? ORIGIN}${path}`,
  method: init.method ?? "GET",
  mode: init.mode ?? "cors",
});

describe("decideFetch", () => {
  it("serves the cached shell for a navigation to /, whatever the query (auth returns to /?code=...)", () => {
    expect(decideFetch(req("/", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "shell" });
    expect(decideFetch(req("/?code=abc&state=xyz", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "shell" });
    expect(decideFetch(req("/?try=1|2", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "shell" });
  });

  it("?nosw=1 on a navigation to / is the reset path (network first, then caches cleared)", () => {
    expect(decideFetch(req("/?nosw=1", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "reset" });
    expect(decideFetch(req("/?a=1&nosw=1", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "reset" });
    expect(decideFetch(req("/?nosw=0", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "shell" });
  });

  it("serves an exact precache match from the cache", () => {
    expect(decideFetch(req("/assets/index-AAA.js"), ORIGIN, URLS)).toEqual({ kind: "asset", path: "/assets/index-AAA.js" });
    expect(decideFetch(req("/manifest.webmanifest"), ORIGIN, URLS)).toEqual({ kind: "asset", path: "/manifest.webmanifest" });
  });

  it("leaves everything not precached to the network", () => {
    expect(decideFetch(req("/assets/index-BBB.js"), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/assets/index-AAA.js.map"), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/index.html", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/other", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "network" });
  });

  it("never handles /voice, the Netlify functions, or the dev-only routes - not even if listed", () => {
    const listed = new Set([...URLS, "/voice", "/.netlify/functions/voice", "/__dev/typeahead", "/__dev/save-recording"]);
    for (const path of ["/voice", "/.netlify/functions/voice", "/__dev/typeahead", "/__dev/save-recording"]) {
      expect(decideFetch(req(path), ORIGIN, listed)).toEqual({ kind: "network" });
      expect(decideFetch(req(path, { method: "POST" }), ORIGIN, listed)).toEqual({ kind: "network" });
      expect(decideFetch(req(path, { mode: "navigate" }), ORIGIN, listed)).toEqual({ kind: "network" });
    }
  });

  it("never handles another origin: the Supabase API, Google sign-in, anything", () => {
    const listed = new Set([...URLS, "/rest/v1/shops"]);
    expect(decideFetch(req("/rest/v1/shops", { origin: "https://abc.supabase.co" }), ORIGIN, listed)).toEqual({ kind: "network" });
    expect(decideFetch(req("/auth/v1/token", { origin: "https://abc.supabase.co" }), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/o/oauth2/v2/auth", { mode: "navigate", origin: "https://accounts.google.com" }), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/", { mode: "navigate", origin: "https://other.example" }), ORIGIN, URLS)).toEqual({ kind: "network" });
  });

  it("never handles anything but GET", () => {
    expect(decideFetch(req("/", { method: "POST", mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/assets/index-AAA.js", { method: "POST" }), ORIGIN, URLS)).toEqual({ kind: "network" });
    expect(decideFetch(req("/assets/index-AAA.js", { method: "HEAD" }), ORIGIN, URLS)).toEqual({ kind: "network" });
  });

  it("a navigation to a precached asset is not served from the cache", () => {
    expect(decideFetch(req("/assets/index-AAA.js", { mode: "navigate" }), ORIGIN, URLS)).toEqual({ kind: "network" });
  });

  it("an unparseable URL is the network's", () => {
    expect(decideFetch({ url: "not a url", method: "GET", mode: "navigate" }, ORIGIN, URLS)).toEqual({ kind: "network" });
  });
});
