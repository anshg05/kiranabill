// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stubLocalStorage } from "@/ui/testStorage";

// KB-409 (D111): Google sign-in inside the Android app - a Chrome Custom Tab out, an app link back. The plugins are faked:
// what is tested is OUR rules (one PKCE key per sign-in, the button comes back, a link is acted on once).

type Listener = (event: never) => void;
const cap = vi.hoisted(() => {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const add = (name: string, cb: (e: unknown) => void) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(cb);
    return Promise.resolve({ remove: () => Promise.resolve(void listeners.get(name)!.delete(cb)) });
  };
  return {
    listeners,
    add,
    emit: (name: string, e?: unknown) => [...(listeners.get(name) ?? [])].forEach((cb) => cb(e)),
    count: (name: string) => listeners.get(name)?.size ?? 0,
    open: vi.fn((_o: { url: string }) => Promise.resolve()),
    launchUrl: undefined as { url: string } | undefined,
    native: true,
  };
});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => cap.native } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: (n: string, cb: Listener) => cap.add(n, cb as (e: unknown) => void), getLaunchUrl: () => Promise.resolve(cap.launchUrl) } }));
vi.mock("@capacitor/browser", () => ({ Browser: { addListener: (n: string, cb: Listener) => cap.add(n, cb as (e: unknown) => void), open: cap.open } }));

import { SIGN_IN_WAIT_MS, isNativeApp, resetNativeSignIn, startNativeSignIn, watchNativeReturn } from "./nativeSignIn";

const GOOGLE = "https://project.supabase.co/auth/v1/authorize?provider=google&code_challenge=abc";
function fakeClient(result: unknown = { data: { url: GOOGLE }, error: null }) {
  const signInWithOAuth = vi.fn().mockResolvedValue(result);
  return { client: { auth: { signInWithOAuth } } as unknown as SupabaseClient, signInWithOAuth };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  cap.listeners.clear();
  cap.open.mockClear();
  cap.open.mockImplementation(() => Promise.resolve());
  cap.launchUrl = undefined;
  cap.native = true;
  stubLocalStorage();
  resetNativeSignIn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isNativeApp", () => {
  it("follows Capacitor: false in a browser or the PWA", () => {
    expect(isNativeApp()).toBe(true);
    cap.native = false;
    expect(isNativeApp()).toBe(false);
  });
});

describe("startNativeSignIn", () => {
  it("asks Supabase for the Google address WITHOUT navigating the app, returning to the app link, and opens it in a Custom Tab", async () => {
    const { client, signInWithOAuth } = fakeClient();
    void startNativeSignIn(client);
    await settle();
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "com.kiranavoicebill.app://auth-callback", skipBrowserRedirect: true } });
    expect(cap.open).toHaveBeenCalledWith({ url: GOOGLE });
  });

  it.each([
    ["the Custom Tab reports it closed", () => cap.emit("browserFinished")],
    ["the app comes back to the foreground (MIUI may never report the tab closing)", () => cap.emit("appStateChange", { isActive: true })],
    ["60 seconds pass with no word at all", () => vi.advanceTimersByTime(SIGN_IN_WAIT_MS)],
  ])("is over - the button comes back - when %s", async (_name, trigger) => {
    const done = vi.fn();
    void startNativeSignIn(fakeClient().client).then(done);
    await settle();
    expect(done).not.toHaveBeenCalled();
    trigger();
    await settle();
    expect(done).toHaveBeenCalledWith("returned");
  });

  it("the wait is 60 seconds (owner, 13 Nov 2026)", () => {
    expect(SIGN_IN_WAIT_MS).toBe(60_000);
  });

  it("the app going to the BACKGROUND (the tab opening) does not end it; 59 s is not 60", async () => {
    const done = vi.fn();
    void startNativeSignIn(fakeClient().client).then(done);
    await settle();
    cap.emit("appStateChange", { isActive: false });
    vi.advanceTimersByTime(SIGN_IN_WAIT_MS - 1);
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("leaves no listener or timer behind", async () => {
    void startNativeSignIn(fakeClient().client);
    await settle();
    expect(cap.count("appStateChange")).toBe(1);
    expect(cap.count("browserFinished")).toBe(1);
    cap.emit("browserFinished");
    await settle();
    expect(cap.count("appStateChange")).toBe(0);
    expect(cap.count("browserFinished")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a second tap after the button came back REUSES the same sign-in: one PKCE key, so a late return from the first tab still works (KB-342)", async () => {
    const { client, signInWithOAuth } = fakeClient();
    void startNativeSignIn(client);
    await settle();
    cap.emit("appStateChange", { isActive: true });
    await settle();
    void startNativeSignIn(client);
    await settle();
    expect(signInWithOAuth).toHaveBeenCalledTimes(1); // a second call would store a new key and orphan the first tab's code
    expect(cap.open).toHaveBeenCalledTimes(2);
    expect(cap.open).toHaveBeenLastCalledWith({ url: GOOGLE });
  });

  it("an error from Supabase, or no address, is thrown - nothing is opened and the next tap starts again", async () => {
    await expect(startNativeSignIn(fakeClient({ data: { url: null }, error: new Error("oauth boom") }).client)).rejects.toThrow("oauth boom");
    await expect(startNativeSignIn(fakeClient({ data: { url: null }, error: null }).client)).rejects.toThrow();
    expect(cap.open).not.toHaveBeenCalled();
    const ok = fakeClient();
    void startNativeSignIn(ok.client);
    await settle();
    expect(ok.signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("if the Custom Tab cannot open, it throws and cleans up", async () => {
    cap.open.mockImplementationOnce(() => Promise.reject(new Error("no browser")));
    await expect(startNativeSignIn(fakeClient().client)).rejects.toThrow("no browser");
    expect(cap.count("appStateChange")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("watchNativeReturn", () => {
  const LINK = "com.kiranavoicebill.app://auth-callback?code=abc-123";

  it("a return link while the app is open goes to the web return path", async () => {
    const go = vi.fn();
    watchNativeReturn(go);
    await settle();
    cap.emit("appUrlOpen", { url: LINK });
    expect(go).toHaveBeenCalledExactlyOnceWith("/?code=abc-123");
  });

  it("cold start: the link that LAUNCHED the app is handled too", async () => {
    cap.launchUrl = { url: LINK };
    const go = vi.fn();
    watchNativeReturn(go);
    await settle();
    expect(go).toHaveBeenCalledExactlyOnceWith("/?code=abc-123");
  });

  it("the same link is acted on ONCE - across reloads too (the launch link is still there after the page reloads: no loop)", async () => {
    cap.launchUrl = { url: LINK };
    const go = vi.fn();
    watchNativeReturn(go);
    await settle();
    cap.emit("appUrlOpen", { url: LINK }); // Capacitor can also deliver the launch link as an event
    const afterReload = vi.fn();
    watchNativeReturn(afterReload); // the page reloaded onto /?code=...; getLaunchUrl still answers the same link
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(afterReload).not.toHaveBeenCalled();
  });

  it("a NEW link (a later sign-in) is handled", async () => {
    const go = vi.fn();
    watchNativeReturn(go);
    await settle();
    cap.emit("appUrlOpen", { url: LINK });
    cap.emit("appUrlOpen", { url: "com.kiranavoicebill.app://auth-callback?code=second" });
    expect(go).toHaveBeenLastCalledWith("/?code=second");
    expect(go).toHaveBeenCalledTimes(2);
  });

  it("a link that is not ours, or holds nothing, does nothing", async () => {
    const go = vi.fn();
    watchNativeReturn(go);
    await settle();
    cap.emit("appUrlOpen", { url: "https://evil.example/?code=abc" });
    cap.emit("appUrlOpen", { url: "com.kiranavoicebill.app://auth-callback" });
    cap.emit("appUrlOpen", {});
    expect(go).not.toHaveBeenCalled();
  });

  it("if the phone cannot remember the link, it is NOT acted on (a reload loop is worse than one failed sign-in)", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage full");
      },
    });
    const go = vi.fn();
    watchNativeReturn(go);
    await settle();
    cap.emit("appUrlOpen", { url: LINK });
    expect(go).not.toHaveBeenCalled();
  });

  it("after it is stopped, nothing is handled and the listener is gone", async () => {
    cap.launchUrl = { url: LINK };
    const go = vi.fn();
    const stop = watchNativeReturn(go);
    stop(); // before the launch link even answered
    await settle();
    cap.emit("appUrlOpen", { url: "com.kiranavoicebill.app://auth-callback?code=later" });
    expect(go).not.toHaveBeenCalled();
    expect(cap.count("appUrlOpen")).toBe(0);
  });
});
