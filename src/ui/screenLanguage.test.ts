// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorage } from "./testStorage";

// KB-332 (D84): the Screen language - per device, local, never synced, default English. A bad stored value or a storage that
// throws is English, never an error.

const KEY = "kb.screenLanguage";
const fresh = async () => {
  vi.resetModules();
  return import("./screenLanguage");
};
let store: Map<string, string>;
beforeEach(() => {
  store = stubLocalStorage();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the screen language", () => {
  it("is English until chosen", async () => {
    expect((await fresh()).getScreenLanguage()).toBe("en");
  });
  it("is remembered on this device and read back at the next start", async () => {
    const a = await fresh();
    a.setScreenLanguage("hi");
    expect(store.get(KEY)).toBe("hi");
    expect((await fresh()).getScreenLanguage()).toBe("hi");
    a.setScreenLanguage("hl");
    expect((await fresh()).getScreenLanguage()).toBe("hl");
  });
  it("tells every listener at once, and a removed listener hears nothing", async () => {
    const m = await fresh();
    const one = vi.fn();
    const two = vi.fn();
    const off = m.subscribeScreenLanguage(one);
    m.subscribeScreenLanguage(two);
    m.setScreenLanguage("hi");
    expect([one.mock.calls.length, two.mock.calls.length]).toEqual([1, 1]);
    off();
    m.setScreenLanguage("hl");
    expect([one.mock.calls.length, two.mock.calls.length]).toEqual([1, 2]);
  });
  it("setting the language it already has tells nobody", async () => {
    const m = await fresh();
    const cb = vi.fn();
    m.subscribeScreenLanguage(cb);
    m.setScreenLanguage("en");
    expect(cb).not.toHaveBeenCalled();
  });
  it("a stored value that is not one of the three is English", async () => {
    store.set(KEY, "klingon");
    expect((await fresh()).getScreenLanguage()).toBe("en");
  });
  it("a storage that throws is English, and choosing still works for this session", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const m = await fresh();
    expect(m.getScreenLanguage()).toBe("en");
    expect(() => m.setScreenLanguage("hi")).not.toThrow();
    expect(m.getScreenLanguage()).toBe("hi");
  });
});
