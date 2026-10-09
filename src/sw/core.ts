// KB-401 (docs/07-DECISIONS.md D67): what the service worker will answer - and, above all, what it never touches.
// The worker answers ONLY a same-origin GET that is an exact precache match, or a same-origin navigation to "/".
// Everything else (the Supabase API, Google sign-in, /voice, the dev routes, every POST) is simply not handled:
// the browser sends it to the network exactly as if there were no worker. Offline DATA is Dexie's job, not ours.

export type SwMode = "normal" | "force" | "kill";

export interface PrecacheEntry {
  url: string;
  /** A content hash: an entry with the same url + rev is copied from the previous cache, not downloaded again. */
  rev: string;
}

/** What the build injects into the worker (scripts/pwa-build.ts). */
export interface SwConfig {
  /** "kb-" + a hash of every precached file's content: two different builds never share a cache. */
  cacheName: string;
  mode: SwMode;
  entries: PrecacheEntry[];
}

export const CACHE_PREFIX = "kb-";
export const SHELL_URL = "/";
/** Stored in each build's cache: the list it was built from (what a later install may copy). */
export const PRECACHE_LIST_KEY = "/__kb-precache.json";

export type Decision = { kind: "network" } | { kind: "shell" } | { kind: "asset"; path: string } | { kind: "reset" };

/** Defence in depth: refused here even if a build ever listed them (precache.ts refuses them too). */
const NEVER_HANDLED = ["/voice", "/.netlify", "/__dev"];
const NETWORK: Decision = { kind: "network" };

export function decideFetch(request: { url: string; method: string; mode: string }, origin: string, precached: ReadonlySet<string>): Decision {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return NETWORK;
  }
  if (request.method !== "GET" || url.origin !== origin) return NETWORK;
  if (NEVER_HANDLED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return NETWORK;
  if (request.mode === "navigate") {
    if (url.pathname !== SHELL_URL) return NETWORK;
    return url.searchParams.get("nosw") === "1" ? { kind: "reset" } : { kind: "shell" };
  }
  return precached.has(url.pathname) ? { kind: "asset", path: url.pathname } : NETWORK;
}
