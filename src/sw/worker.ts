import { CACHE_PREFIX, PRECACHE_LIST_KEY, SHELL_URL, decideFetch, type PrecacheEntry, type SwConfig } from "./core";

// KB-401 (docs/07-DECISIONS.md D67): the service worker, written against a minimal scope so a test can drive it
// with stubs (worker.test.ts). Three modes, fixed at build time (src/sw/mode.txt):
//   normal - a new version installs and WAITS; the page tells it to take over at a safe moment (kb-skip-waiting).
//   force  - skipWaiting + claim + tell the open pages to reload. An emergency fix; a bill on screen reloads (the
//            half-built bill is restored from its draft - D65).
//   kill   - a tombstone: deletes every cache, unregisters itself, reloads the open pages. Handles no fetch.
// Any exception while answering falls back to the network - a worker bug must never be a blank screen.

export type { SwConfig };

interface ClientLike {
  readonly url: string;
  postMessage(message: unknown): void;
  navigate?(url: string): Promise<unknown>;
}
interface ExtendableLike {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchLike extends ExtendableLike {
  readonly request: Request;
  respondWith(p: Promise<Response>): void;
}
interface MessageLike extends ExtendableLike {
  readonly data: unknown;
}

export interface WorkerScope {
  addEventListener(type: string, fn: (e: never) => void): void;
  caches: CacheStorage;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(opts?: { type?: "window"; includeUncontrolled?: boolean }): Promise<readonly ClientLike[]> };
  registration: { unregister(): Promise<boolean> };
  location: { origin: string };
  fetch: typeof fetch;
}

export function installWorker(scope: WorkerScope, cfg: SwConfig): void {
  const { cacheName, mode } = cfg;
  const precached = new Set(cfg.entries.map((e) => e.url));
  const buildCaches = async () => (await scope.caches.keys()).filter((k) => k.startsWith(CACHE_PREFIX));
  const deleteAllCaches = async () => void (await Promise.all((await scope.caches.keys()).map((k) => scope.caches.delete(k))));
  const pages = () => scope.clients.matchAll({ type: "window", includeUncontrolled: true });

  /** url@rev -> the older cache holding exactly that file. */
  async function earlierFiles(): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const name of await buildCaches()) {
      if (name === cacheName) continue;
      try {
        const list = (await (await scope.caches.match(PRECACHE_LIST_KEY, { cacheName: name }))?.json()) as PrecacheEntry[] | undefined;
        for (const e of list ?? []) if (!found.has(`${e.url}@${e.rev}`)) found.set(`${e.url}@${e.rev}`, name);
      } catch {
        // an unreadable old cache just means more downloading
      }
    }
    return found;
  }

  async function install(): Promise<void> {
    if (mode === "kill") return scope.skipWaiting();
    try {
      const earlier = await earlierFiles();
      const cache = await scope.caches.open(cacheName);
      await Promise.all(
        cfg.entries.map(async (e) => {
          const from = earlier.get(`${e.url}@${e.rev}`);
          const kept = from ? await scope.caches.match(e.url, { cacheName: from }) : undefined;
          if (kept) return cache.put(e.url, kept);
          const res = await scope.fetch(e.url, { cache: "reload" });
          // A redirected page can't answer a navigation; an HTML page where a script should be is a captive portal.
          const wrongKind = e.url !== SHELL_URL && (res.headers.get("content-type") ?? "").includes("text/html");
          if (!res.ok || res.redirected || wrongKind) throw new Error(`precache: ${e.url} -> ${res.status}`);
          return cache.put(e.url, res);
        }),
      );
      await cache.put(PRECACHE_LIST_KEY, new Response(JSON.stringify(cfg.entries)));
    } catch (err) {
      await scope.caches.delete(cacheName); // no half-filled cache; the old worker carries on, the browser retries
      throw err;
    }
    if (mode === "force") await scope.skipWaiting();
  }

  async function activate(): Promise<void> {
    if (mode === "kill") {
      await deleteAllCaches();
      await scope.registration.unregister();
      await Promise.all((await pages()).map((c) => c.navigate?.(c.url)?.catch(() => undefined)));
      return;
    }
    await Promise.all((await buildCaches()).filter((k) => k !== cacheName).map((k) => scope.caches.delete(k)));
    await scope.clients.claim();
    if (mode === "force") for (const c of await pages()) c.postMessage({ type: "kb-force", cache: cacheName });
  }

  const cached = (path: string) => scope.caches.match(path, { cacheName });

  /** ?nosw=1 - the page comes from the NETWORK (a broken cached shell can't be served), then everything is dropped. */
  async function reset(request: Request): Promise<Response> {
    const fresh = await scope.fetch(request).catch(() => null);
    if (!fresh) return (await cached(SHELL_URL)) ?? Response.error(); // offline: nothing to fix with, nothing cleared
    await deleteAllCaches();
    await scope.registration.unregister();
    return fresh;
  }

  async function answer(request: Request, kind: "shell" | "asset" | "reset", path: string): Promise<Response> {
    try {
      if (kind === "reset") return await reset(request);
      const hit = await cached(kind === "shell" ? SHELL_URL : path);
      if (hit) return hit;
    } catch {
      // fall through to the network
    }
    return scope.fetch(request);
  }

  scope.addEventListener("install", (e: ExtendableLike) => e.waitUntil(install()));
  scope.addEventListener("activate", (e: ExtendableLike) => e.waitUntil(activate()));
  if (mode === "kill") return;

  scope.addEventListener("message", (e: MessageLike) => {
    const data = e.data as { type?: unknown } | null;
    if (typeof data === "object" && data !== null && data.type === "kb-skip-waiting") e.waitUntil(scope.skipWaiting());
  });
  scope.addEventListener("fetch", (e: FetchLike) => {
    const d = decideFetch(e.request, scope.location.origin, precached);
    if (d.kind === "network") return; // not ours: the browser goes to the network as if there were no worker
    e.respondWith(answer(e.request, d.kind, d.kind === "asset" ? d.path : SHELL_URL));
  });
}
