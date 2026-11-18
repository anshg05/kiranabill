import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Option (b) step 3 (owner, 18 Nov 2026): /voice-run is now the FRONT - a normal function the phone calls, which answers CORS (a
// background function cannot: Netlify answers it with its own 202) and starts the worker, /voice-run-worker, on the same deploy. The
// Android app's origin (https://localhost) and the website's are the only cross-site callers; a same-origin call (the website and its
// drafts) and a call with no Origin (scripts) are not CORS at all. The login is checked here AND again by the worker.

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock("./jwt.js", () => ({ verifyAccessToken: verifyMock }));

import handler, { config } from "../voice-run.mts";
import { ALLOWED_ORIGINS, ANDROID_APP_ORIGIN, WEBSITE_ORIGIN } from "./cors";

const REC = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f";
const SITE = "https://fn-draft--kvb-api.netlify.app";
const worker = vi.fn(async (..._a: unknown[]) => new Response(null, { status: 202 }));

const call = (method: string, origin: string | null, opts: { auth?: string | null; body?: unknown } = {}) => {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.origin = origin;
  if (opts.auth !== null) headers.authorization = opts.auth ?? "Bearer jwt";
  if (method === "OPTIONS") Object.assign(headers, { "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" });
  else headers["content-type"] = "application/json";
  const body = method === "POST" ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? { recordingId: REC })) : undefined;
  return handler(new Request(`${SITE}/voice-run`, { method, headers, body }), {} as never);
};

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://x.supabase.co";
  verifyMock.mockResolvedValue({ userId: "u1" });
  vi.stubGlobal("fetch", worker);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("/voice-run - the front: CORS, the login, then the worker", () => {
  it("is a normal (not background) function at /voice-run; the allowed origins are exactly the app's and the website's", () => {
    expect(config).toEqual({ path: "/voice-run" });
    expect(ANDROID_APP_ORIGIN).toBe("https://localhost");
    expect(WEBSITE_ORIGIN).toBe("https://kiranabilling.netlify.app");
    expect([...ALLOWED_ORIGINS]).toEqual(["https://localhost", "https://kiranabilling.netlify.app"]);
  });

  it("1. a preflight from the Android app passes, with exactly these headers", async () => {
    const res = await call("OPTIONS", "https://localhost");
    expect(res.status).toBe(204);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "access-control-allow-origin": "https://localhost",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-max-age": "600",
      vary: "Origin",
    });
    expect(worker).not.toHaveBeenCalled();
  });

  it("2. a preflight from another site is refused: 403, no Allow-Origin", async () => {
    const res = await call("OPTIONS", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("3. a POST from another site is refused, even with a valid login - the worker never starts", async () => {
    const res = await call("POST", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(worker).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("4. near misses are other sites: http, another port, a longer host, null", async () => {
    for (const o of ["http://localhost", "https://localhost:8080", "https://localhost.evil.com", "https://kiranabilling.netlify.app.evil.com", "null"]) {
      expect((await call("OPTIONS", o)).status, o).toBe(403);
      expect((await call("POST", o)).status, o).toBe(403);
    }
    expect(worker).not.toHaveBeenCalled();
  });

  it("5. a same-origin call (the website or one of its drafts, calling its own site) passes", async () => {
    const res = await call("POST", SITE);
    expect(res.status).toBe(202);
    expect(worker).toHaveBeenCalledOnce();
  });

  it("6. no answer ever says *", async () => {
    const all = [await call("OPTIONS", "https://localhost"), await call("POST", "https://localhost"), await call("OPTIONS", "https://evil.example"), await call("POST", null), await call("POST", "https://localhost", { auth: null })];
    for (const r of all) expect(r.headers.get("access-control-allow-origin") ?? "").not.toContain("*");
  });

  it("7. no login or a bad login: 401, readable by the app (CORS headers on), the worker never starts", async () => {
    const none = await call("POST", "https://localhost", { auth: null });
    verifyMock.mockResolvedValue(null);
    const bad = await call("POST", "https://localhost");
    for (const r of [none, bad]) {
      expect(r.status).toBe(401);
      expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    }
    expect(worker).not.toHaveBeenCalled();
  });

  it("8. a recording id that is not a uuid, or a body that is not JSON: 400, the worker never starts", async () => {
    expect((await call("POST", "https://localhost", { body: { recordingId: "../../etc" } })).status).toBe(400);
    expect((await call("POST", "https://localhost", { body: {} })).status).toBe(400);
    expect((await call("POST", "https://localhost", { body: "not json" })).status).toBe(400);
    expect(worker).not.toHaveBeenCalled();
  });

  it("9. the worker does not start (an error answer, or no answer): 502", async () => {
    worker.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect((await call("POST", "https://localhost")).status).toBe(502);
    worker.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await call("POST", "https://localhost")).status).toBe(502);
  });

  it("10. a good call from the app starts the worker ONCE, on the same deploy, passing the caller's login and the id", async () => {
    const res = await call("POST", "https://localhost");
    expect(res.status).toBe(202);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(verifyMock).toHaveBeenCalledWith("Bearer jwt", "https://x.supabase.co");
    expect(worker).toHaveBeenCalledOnce();
    const [url, init] = worker.mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe(`${SITE}/voice-run-worker`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt");
    expect(JSON.parse(String(init.body))).toEqual({ recordingId: REC });
  });

  it("a call with no Origin (a script, draft:voice) is not CORS: the login decides", async () => {
    expect((await call("POST", null)).status).toBe(202);
    verifyMock.mockResolvedValue(null);
    expect((await call("POST", null)).status).toBe(401);
  });

  it("a server with no Supabase address: 500, nothing starts", async () => {
    delete process.env.VITE_SUPABASE_URL;
    expect((await call("POST", "https://localhost")).status).toBe(500);
    expect(worker).not.toHaveBeenCalled();
  });
});
