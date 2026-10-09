import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWorker, type SwConfig, type WorkerScope } from "./worker";

// KB-401 (D67): the worker driven against a stub scope - an in-memory CacheStorage, a scripted fetch and the three
// events. The real browser covers the rest (offline open, the update flow, ?nosw=1, kill, force).
const ORIGIN = "https://app.example";

class FakeCache {
  store = new Map<string, Response>();
  put(url: string, res: Response) {
    this.store.set(norm(url), res.clone());
    return Promise.resolve();
  }
  match(url: string) {
    const hit = this.store.get(norm(url));
    return Promise.resolve(hit ? hit.clone() : undefined);
  }
}
const norm = (u: string) => u.replace(ORIGIN, "");

class FakeCaches {
  caches = new Map<string, FakeCache>();
  open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return Promise.resolve(this.caches.get(name)!);
  }
  keys() {
    return Promise.resolve([...this.caches.keys()]);
  }
  delete(name: string) {
    return Promise.resolve(this.caches.delete(name));
  }
  match(url: string, opts?: { cacheName?: string }) {
    const c = opts?.cacheName ? this.caches.get(opts.cacheName) : undefined;
    return c ? c.match(url) : Promise.resolve(undefined);
  }
}

const js = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/javascript" } });
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

function setup(over: Partial<SwConfig> = {}, network: Record<string, () => Response> = {}) {
  const caches = new FakeCaches();
  const listeners = new Map<string, (e: unknown) => void>();
  const fetchCalls: { url: string; cache?: string }[] = [];
  const clientsList: { postMessage: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn>; url: string }[] = [
    { postMessage: vi.fn(), navigate: vi.fn(() => Promise.resolve()), url: `${ORIGIN}/` },
  ];
  let online = true;
  const scope: WorkerScope = {
    addEventListener: (type, fn) => void listeners.set(type, fn as (e: unknown) => void),
    caches: caches as unknown as WorkerScope["caches"],
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()), matchAll: vi.fn(() => Promise.resolve(clientsList)) } as unknown as WorkerScope["clients"],
    registration: { unregister: vi.fn(() => Promise.resolve(true)) },
    location: { origin: ORIGIN },
    fetch: ((input: string | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const full = url.replace(ORIGIN, "");
      const path = full.split("?")[0]!;
      fetchCalls.push({ url: path, cache: init?.cache });
      if (!online) return Promise.reject(new TypeError("Failed to fetch"));
      const make = network[path];
      return Promise.resolve(make ? make() : new Response("not found", { status: 404 }));
    }) as WorkerScope["fetch"],
  };
  const cfg: SwConfig = {
    cacheName: "kb-new",
    mode: "normal",
    entries: [
      { url: "/", rev: "h1" },
      { url: "/assets/a.js", rev: "a1" },
      { url: "/assets/b.js", rev: "b1" },
    ],
    ...over,
  };
  installWorker(scope, cfg);
  const emitWait = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...extra });
    await Promise.all(waits);
  };
  const doFetch = async (path: string, init: { mode?: string; method?: string } = {}) => {
    const request = { url: `${ORIGIN}${path}`, method: init.method ?? "GET", mode: init.mode ?? "cors" } as unknown as Request;
    const held: { responded: Promise<Response> | null } = { responded: null };
    const waits: Promise<unknown>[] = [];
    listeners.get("fetch")?.({ request, respondWith: (p: Promise<Response>) => (held.responded = p), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const res = held.responded ? await held.responded : null;
    await Promise.all(waits);
    return res;
  };
  const NETWORK: Record<string, () => Response> = {
    "/": () => html("<html>shell</html>"),
    "/assets/a.js": () => js("a"),
    "/assets/b.js": () => js("b"),
  };
  return { scope, caches, listeners, fetchCalls, clientsList, emitWait, doFetch, setOnline: (v: boolean) => (online = v), NETWORK, cfg };
}

const PRECACHE_NET = { "/": () => html("<html>shell</html>"), "/assets/a.js": () => js("a"), "/assets/b.js": () => js("b") };

describe("install", () => {
  it("precaches every entry (bypassing the HTTP cache) and records the precache list", async () => {
    const s = setup({}, PRECACHE_NET);
    await s.emitWait("install");
    expect(s.fetchCalls.map((c) => c.url).sort()).toEqual(["/", "/assets/a.js", "/assets/b.js"]);
    expect(s.fetchCalls.every((c) => c.cache === "reload")).toBe(true);
    const cache = s.caches.caches.get("kb-new")!;
    expect(await (await cache.match("/assets/a.js"))!.text()).toBe("a");
    expect(await (await cache.match("/"))!.text()).toBe("<html>shell</html>");
    expect(JSON.parse(await (await cache.match("/__kb-precache.json"))!.text())).toEqual(s.cfg.entries);
  });

  it("copies an unchanged file from the previous cache instead of downloading it again", async () => {
    const s = setup({}, PRECACHE_NET);
    const prev = await s.caches.open("kb-old");
    await prev.put("/", html("<html>old shell</html>"));
    await prev.put("/assets/a.js", js("a-cached"));
    await prev.put("/assets/b.js", js("b-old"));
    await prev.put(
      "/__kb-precache.json",
      new Response(JSON.stringify([{ url: "/", rev: "h0" }, { url: "/assets/a.js", rev: "a1" }, { url: "/assets/b.js", rev: "b0" }])),
    );
    await s.emitWait("install");
    expect(s.fetchCalls.map((c) => c.url).sort()).toEqual(["/", "/assets/b.js"]); // a.js (same rev) was copied
    const cache = s.caches.caches.get("kb-new")!;
    expect(await (await cache.match("/assets/a.js"))!.text()).toBe("a-cached");
    expect(await (await cache.match("/assets/b.js"))!.text()).toBe("b");
  });

  it("fails - and leaves no half-filled cache - when one file cannot be downloaded", async () => {
    const s = setup({}, { "/": () => html("shell"), "/assets/a.js": () => js("a") }); // b.js -> 404
    await expect(s.emitWait("install")).rejects.toThrow();
    expect(s.caches.caches.has("kb-new")).toBe(false);
  });

  it("fails when a script comes back as an HTML page (a captive portal, a proxy)", async () => {
    const s = setup({}, { ...PRECACHE_NET, "/assets/a.js": () => html("<html>Log in to Wi-Fi</html>") });
    await expect(s.emitWait("install")).rejects.toThrow();
    expect(s.caches.caches.has("kb-new")).toBe(false);
  });

  it("fails on a redirected response (a redirected page can't answer a navigation)", async () => {
    const redirected = () => {
      const r = html("shell");
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    };
    const s = setup({}, { ...PRECACHE_NET, "/": redirected });
    await expect(s.emitWait("install")).rejects.toThrow();
  });

  it("normal mode never skips waiting on its own; force and kill do", async () => {
    const normal = setup({}, PRECACHE_NET);
    await normal.emitWait("install");
    expect(normal.scope.skipWaiting).not.toHaveBeenCalled();

    const force = setup({ mode: "force" }, PRECACHE_NET);
    await force.emitWait("install");
    expect(force.scope.skipWaiting).toHaveBeenCalledTimes(1);

    const kill = setup({ mode: "kill", entries: [] });
    await kill.emitWait("install");
    expect(kill.scope.skipWaiting).toHaveBeenCalledTimes(1);
    expect(kill.fetchCalls).toEqual([]); // the tombstone downloads nothing
  });
});

describe("activate", () => {
  it("deletes old build caches only, then takes control", async () => {
    const s = setup({}, PRECACHE_NET);
    await s.caches.open("kb-old");
    await s.caches.open("kb-new");
    await s.caches.open("somebody-elses");
    await s.emitWait("activate");
    expect([...s.caches.caches.keys()].sort()).toEqual(["kb-new", "somebody-elses"]);
    expect(s.scope.clients.claim).toHaveBeenCalledTimes(1);
    expect(s.clientsList[0]!.postMessage).not.toHaveBeenCalled();
  });

  it("force mode tells the open pages to reload", async () => {
    const s = setup({ mode: "force" }, PRECACHE_NET);
    await s.emitWait("activate");
    expect(s.clientsList[0]!.postMessage).toHaveBeenCalledWith({ type: "kb-force", cache: "kb-new" });
  });

  it("kill mode deletes every cache, unregisters and reloads the open pages", async () => {
    const s = setup({ mode: "kill", entries: [] });
    await s.caches.open("kb-old");
    await s.caches.open("kb-other");
    await s.emitWait("activate");
    expect(s.caches.caches.size).toBe(0);
    expect(s.scope.registration.unregister).toHaveBeenCalledTimes(1);
    expect(s.clientsList[0]!.navigate).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});

describe("message", () => {
  it("kb-skip-waiting activates the waiting worker; anything else is ignored", async () => {
    const s = setup({}, PRECACHE_NET);
    await s.emitWait("message", { data: { type: "hello" } });
    await s.emitWait("message", { data: null });
    await s.emitWait("message", { data: "kb-skip-waiting" });
    expect(s.scope.skipWaiting).not.toHaveBeenCalled();
    await s.emitWait("message", { data: { type: "kb-skip-waiting" } });
    expect(s.scope.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe("fetch", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(async () => {
    s = setup({}, PRECACHE_NET);
    await s.emitWait("install");
    await s.emitWait("activate");
    s.fetchCalls.length = 0;
  });

  it("opens the app OFFLINE: the shell, including an auth return (?code=), comes from the cache", async () => {
    s.setOnline(false);
    const res = await s.doFetch("/", { mode: "navigate" });
    expect(await res!.text()).toBe("<html>shell</html>");
    const auth = await s.doFetch("/?code=abc&state=xyz", { mode: "navigate" });
    expect(await auth!.text()).toBe("<html>shell</html>");
    expect(s.fetchCalls).toEqual([]);
  });

  it("serves a precached file from the cache, offline", async () => {
    s.setOnline(false);
    expect(await (await s.doFetch("/assets/a.js"))!.text()).toBe("a");
  });

  it("does not touch /voice, the dev routes, the Supabase API or a POST - not even offline", async () => {
    s.setOnline(false);
    expect(await s.doFetch("/voice")).toBeNull();
    expect(await s.doFetch("/voice", { method: "POST" })).toBeNull();
    expect(await s.doFetch("/__dev/typeahead", { mode: "navigate" })).toBeNull();
    expect(await s.doFetch("/assets/not-precached.js")).toBeNull();
    const supabase = { url: "https://abc.supabase.co/rest/v1/shops", method: "GET", mode: "cors" } as unknown as Request;
    let handled = false;
    s.listeners.get("fetch")!({ request: supabase, respondWith: () => (handled = true), waitUntil: () => {} });
    expect(handled).toBe(false);
    expect(s.fetchCalls).toEqual([]);
  });

  it("a cache miss for a precached URL goes to the network", async () => {
    s.caches.caches.get("kb-new")!.store.delete("/assets/b.js");
    expect(await (await s.doFetch("/assets/b.js"))!.text()).toBe("b");
    expect(s.fetchCalls.map((c) => c.url)).toEqual(["/assets/b.js"]);
  });

  it("an exception inside the worker falls back to the network, never a blank screen", async () => {
    vi.spyOn(s.caches, "match").mockRejectedValue(new Error("cache storage broke"));
    expect(await (await s.doFetch("/", { mode: "navigate" }))!.text()).toBe("<html>shell</html>");
    expect(s.fetchCalls.map((c) => c.url)).toEqual(["/"]);
  });

  it("?nosw=1 loads from the NETWORK, then clears every cache and unregisters", async () => {
    // the cached shell is the broken one; the network has the fixed one
    s.caches.caches.get("kb-new")!.store.set("/", html("<html>BROKEN cached shell</html>"));
    const res = await s.doFetch("/?nosw=1", { mode: "navigate" });
    expect(await res!.text()).toBe("<html>shell</html>");
    expect(s.caches.caches.size).toBe(0);
    expect(s.scope.registration.unregister).toHaveBeenCalledTimes(1);
  });

  it("?nosw=1 while offline serves the cached shell and clears nothing", async () => {
    s.setOnline(false);
    const res = await s.doFetch("/?nosw=1", { mode: "navigate" });
    expect(await res!.text()).toBe("<html>shell</html>");
    expect(s.caches.caches.has("kb-new")).toBe(true);
    expect(s.scope.registration.unregister).not.toHaveBeenCalled();
  });
});

describe("kill mode", () => {
  it("handles no fetch at all", async () => {
    const s = setup({ mode: "kill", entries: [] });
    expect(s.listeners.has("fetch")).toBe(false);
  });
});
