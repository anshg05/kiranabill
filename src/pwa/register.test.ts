import { describe, expect, it, vi } from "vitest";
import { resetServiceWorker, swPlan, wantsReset } from "./register";

// KB-401 (D67): the per-phone recovery path. /?nosw=1 removes every registration and every cache this origin holds,
// then loads the plain page - which registers a fresh worker.
describe("wantsReset", () => {
  it("is true only for nosw=1", () => {
    expect(wantsReset("?nosw=1")).toBe(true);
    expect(wantsReset("?a=1&nosw=1")).toBe(true);
    expect(wantsReset("?nosw=0")).toBe(false);
    expect(wantsReset("")).toBe(false);
    expect(wantsReset("?code=abc")).toBe(false);
  });
});

describe("resetServiceWorker", () => {
  it("unregisters every registration, deletes every cache, then goes to the plain page", async () => {
    const unregisterA = vi.fn(() => Promise.resolve(true));
    const unregisterB = vi.fn(() => Promise.resolve(true));
    const del = vi.fn(() => Promise.resolve(true));
    const replace = vi.fn();
    await resetServiceWorker({
      serviceWorker: { getRegistrations: () => Promise.resolve([{ unregister: unregisterA }, { unregister: unregisterB }]) },
      caches: { keys: () => Promise.resolve(["kb-1", "kb-2", "other"]), delete: del },
      location: { pathname: "/", search: "?a=1&nosw=1", hash: "#x", replace },
    });
    expect(unregisterA).toHaveBeenCalled();
    expect(unregisterB).toHaveBeenCalled();
    expect(del.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(["kb-1", "kb-2", "other"]);
    expect(replace).toHaveBeenCalledWith("/?a=1#x");
  });

  it("still goes to the plain page when the browser has no service-worker support", async () => {
    const replace = vi.fn();
    await resetServiceWorker({ serviceWorker: undefined, caches: undefined, location: { pathname: "/", search: "?nosw=1", hash: "", replace } });
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("goes to the plain page even if cleaning up throws", async () => {
    const replace = vi.fn();
    await resetServiceWorker({
      serviceWorker: { getRegistrations: () => Promise.reject(new Error("boom")) },
      caches: { keys: () => Promise.reject(new Error("boom")), delete: () => Promise.resolve(true) },
      location: { pathname: "/", search: "?nosw=1", hash: "", replace },
    });
    expect(replace).toHaveBeenCalledWith("/");
  });
});

// KB-401 (D67): what the page does about the worker. A KILL build (src/sw/mode.txt = kill) must never register one -
// the tombstone worker reloads its pages, and a page that registered it again would loop forever.
describe("swPlan", () => {
  const on = { production: true, supported: true, search: "", killBuild: false };
  it("registers in a normal production build", () => {
    expect(swPlan(on)).toBe("register");
  });
  it("does nothing in dev or without browser support", () => {
    expect(swPlan({ ...on, production: false })).toBe("off");
    expect(swPlan({ ...on, supported: false })).toBe("off");
  });
  it("?nosw=1 is a reset, in any build", () => {
    expect(swPlan({ ...on, search: "?nosw=1" })).toBe("reset");
    expect(swPlan({ ...on, search: "?nosw=1", killBuild: true })).toBe("reset");
  });
  it("a kill build clears whatever is there and never registers", () => {
    expect(swPlan({ ...on, killBuild: true })).toBe("clear");
  });
});
