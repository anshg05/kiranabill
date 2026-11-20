// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// KB-425 (owner, 20 Nov 2026; D123): the splash's "ready" and the permission cards' rules (src/data/appShell.ts).

const env = vi.hoisted(() => ({ native: true, state: { granted: false, canAsk: false } as { granted: boolean; canAsk: boolean } | Error, ready: 0, settings: 0 }));
vi.mock("./nativeSignIn", () => ({ isNativeApp: () => env.native }));
vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    ready: async () => void env.ready++,
    permissionState: async () => {
      if (env.state instanceof Error) throw env.state;
      return env.state;
    },
    openSettings: async () => void env.settings++,
  }),
}));
import { afterRefused, beforeAsking, HOLDING_ATTR, openAppSettings, setPermissionHost, watchFirstScreen } from "./appShell";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  env.native = true;
  env.state = { granted: false, canAsk: false };
  env.ready = 0;
  env.settings = 0;
});
afterEach(() => vi.unstubAllGlobals());

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the splash waits for the first real screen", () => {
  it("empty, then a holding screen: not ready; then a real screen: ready ONCE", async () => {
    const root = document.createElement("div");
    const onReady = vi.fn();
    watchFirstScreen(root, onReady, (cb) => cb());
    await tick();
    expect(onReady).not.toHaveBeenCalled();
    const holding = document.createElement("div");
    holding.setAttribute(HOLDING_ATTR, "");
    root.append(holding);
    await tick();
    expect(onReady).not.toHaveBeenCalled();
    root.replaceChildren(Object.assign(document.createElement("main"), { textContent: "Home" }));
    await tick();
    expect(onReady).toHaveBeenCalledTimes(1);
    root.replaceChildren(holding); // a later holding screen never brings the splash back
    root.replaceChildren(document.createElement("main"));
    await tick();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("a holding screen nested inside the page also holds", async () => {
    const root = document.createElement("div");
    const onReady = vi.fn();
    const wrap = document.createElement("div");
    const holding = document.createElement("div");
    holding.setAttribute(HOLDING_ATTR, "");
    wrap.append(holding);
    root.append(wrap);
    watchFirstScreen(root, onReady, (cb) => cb());
    await tick();
    expect(onReady).not.toHaveBeenCalled();
    holding.remove();
    wrap.append(document.createElement("p"));
    await tick();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe("the permission card, once, just before Android's prompt", () => {
  const host = (answer: "allow" | "close") => {
    const calls: string[] = [];
    const unset = setPermissionHost(async (kind, sheet) => {
      calls.push(`${kind}:${sheet}`);
      return answer;
    });
    return { calls, unset };
  };

  it("already granted: straight on, no card", async () => {
    env.state = { granted: true, canAsk: false };
    const h = host("allow");
    expect(await beforeAsking("microphone")).toBe(true);
    expect(h.calls).toEqual([]);
    h.unset();
  });

  it("first time: the card; Allow -> Android may ask; the next time no card (once per install)", async () => {
    const h = host("allow");
    expect(await beforeAsking("microphone")).toBe(true);
    expect(h.calls).toEqual(["microphone:explain"]);
    env.state = { granted: false, canAsk: true }; // refused once: Android will ask again
    expect(await beforeAsking("microphone")).toBe(true);
    expect(h.calls).toEqual(["microphone:explain"]);
    h.unset();
  });

  it("Not now: nothing is asked, and the card is not shown again", async () => {
    const h = host("close");
    expect(await beforeAsking("nearby")).toBe(false);
    expect(await beforeAsking("nearby")).toBe(true); // the second tap goes to Android's own prompt
    expect(h.calls).toEqual(["nearby:explain"]);
    h.unset();
  });

  it("each permission has its own card", async () => {
    const h = host("allow");
    await beforeAsking("microphone");
    await beforeAsking("nearby");
    expect(h.calls).toEqual(["microphone:explain", "nearby:explain"]);
    h.unset();
  });

  it("asked before and Android will not ask again: Open Settings, and the action stops", async () => {
    const h = host("allow");
    await beforeAsking("microphone"); // asked once
    env.state = { granted: false, canAsk: false };
    expect(await beforeAsking("microphone")).toBe(false);
    expect(h.calls).toEqual(["microphone:explain", "microphone:settings"]);
    h.unset();
  });

  it("after Android refused: Open Settings only when it will not ask again", async () => {
    const h = host("close");
    env.state = { granted: false, canAsk: true };
    await afterRefused("nearby");
    expect(h.calls).toEqual([]);
    env.state = { granted: false, canAsk: false };
    await afterRefused("nearby");
    expect(h.calls).toEqual(["nearby:settings"]);
    h.unset();
  });

  it("outside the app, or an app without the plugin: today's behaviour (no card)", async () => {
    const h = host("close");
    env.native = false;
    expect(await beforeAsking("microphone")).toBe(true);
    env.native = true;
    env.state = new Error("not implemented");
    expect(await beforeAsking("microphone")).toBe(true);
    expect(h.calls).toEqual([]);
    h.unset();
  });

  it("Open Settings opens this app's settings page", async () => {
    openAppSettings();
    await tick();
    expect(env.settings).toBe(1);
  });
});
