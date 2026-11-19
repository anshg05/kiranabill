// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
const native = vi.hoisted(() => ({ value: false }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => native.value }));

import { BUNDLED_APP_ORIGIN, MIN_VERSION_KEY, gateApplies, isBelow, readStoredMin, refreshMin } from "@/data/versionGate";
import { ANDROID_APP_ORIGIN } from "../../netlify/functions/_shared/cors";
import type { MinVersion } from "@/data/minVersion";
import { resetUpdateGate, setGate } from "@/pwa/updateGate";
import { stubLocalStorage } from "./testStorage";
import { VersionGateProvider, useVersionGate } from "./VersionGate";

// D116 (owner, 19 Nov 2026): the bundled Android app compares its versionCode with app_min_version. It NEVER waits on the network:
// the decision uses the last value seen (stored on the phone); the server is asked in the background (5 s limit) at start and when the
// app comes back to the front. No network, a slow server or an error never blocks billing. A block that arrives mid-bill waits for
// the safe moment (the update gate). The website never checks.

const APP = 5;
const row = (min: number, url: string | null = null): MinVersion => ({ minVersionCode: min, updateUrl: url });
const store = (m: MinVersion) => localStorage.setItem(MIN_VERSION_KEY, JSON.stringify(m));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Probe() {
  const g = useVersionGate();
  return <p data-testid="gate">{g.blocked ? `blocked ${g.updateUrl ?? "-"}` : "open"}</p>;
}
const mount = (fetcher: (s: AbortSignal) => Promise<MinVersion>, applies = true) =>
  render(<VersionGateProvider applies={applies} appVersionCode={APP} fetcher={fetcher}><Probe /></VersionGateProvider>);
const state = () => screen.getByTestId("gate").textContent;
const offline = () => Promise.reject(new TypeError("fetch failed"));

beforeEach(() => {
  stubLocalStorage();
  setGate("billing", true); // an empty bill: a safe moment
});
afterEach(() => {
  cleanup();
  resetUpdateGate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("versionGate - the pure parts", () => {
  it("compares whole numbers: below the minimum only", () => {
    expect(isBelow(5, row(6))).toBe(true);
    expect(isBelow(5, row(5))).toBe(false);
    expect(isBelow(5, row(4))).toBe(false);
    expect(isBelow(5, null)).toBe(false);
  });

  it("only the bundled app checks: not the website, not a native shell that loads a website origin", () => {
    expect(BUNDLED_APP_ORIGIN).toBe(ANDROID_APP_ORIGIN); // the same origin the CORS front allows (capacitor.config.ts, pinned)
    expect(window.location.origin).not.toBe("https://localhost");
    expect(gateApplies()).toBe(false); // the website
    native.value = true;
    try {
      expect(gateApplies()).toBe(false); // the old shell: native, but on a website's origin
    } finally {
      native.value = false;
    }
  });

  it("a stored value that is broken counts as none", () => {
    localStorage.setItem(MIN_VERSION_KEY, "{not json");
    expect(readStoredMin()).toBeNull();
    localStorage.setItem(MIN_VERSION_KEY, JSON.stringify({ minVersionCode: "9" }));
    expect(readStoredMin()).toBeNull();
  });

  it("refreshMin: a good answer is stored; an error keeps the stored value; a hang ends at the limit with the stored value", async () => {
    expect(await refreshMin(() => Promise.resolve(row(3, "https://x.example/app")))).toEqual(row(3, "https://x.example/app"));
    expect(readStoredMin()).toEqual(row(3, "https://x.example/app"));
    expect(await refreshMin(offline)).toEqual(row(3, "https://x.example/app"));
    vi.useFakeTimers();
    const hang = refreshMin((signal) => new Promise((_r, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await hang).toEqual(row(3, "https://x.example/app"));
  });
});

describe("VersionGateProvider", () => {
  it("offline with nothing stored: the app opens", async () => {
    mount(offline);
    await flush();
    expect(state()).toBe("open");
  });

  it("offline with a stored minimum above this app: blocked at once - the block holds without a network", async () => {
    store(row(6, "https://x.example/app"));
    mount(offline);
    expect(state()).toBe("blocked https://x.example/app"); // before any network answer
    await flush();
    expect(state()).toBe("blocked https://x.example/app");
  });

  it("the server unreachable, a stored minimum this app meets: never blocked", async () => {
    store(row(5));
    mount(offline);
    await flush();
    expect(state()).toBe("open");
  });

  it("the server raises the minimum: blocked after the background answer, and the answer is stored", async () => {
    store(row(1));
    mount(() => Promise.resolve(row(6)));
    expect(state()).toBe("open");
    await flush();
    expect(state()).toBe("blocked -");
    expect(readStoredMin()).toEqual(row(6));
  });

  it("at the minimum exactly: open", async () => {
    mount(() => Promise.resolve(row(5)));
    await flush();
    expect(state()).toBe("open");
  });

  it("mid-bill (the gate not safe): the block waits for the safe moment, then applies", async () => {
    setGate("billing", false);
    mount(() => Promise.resolve(row(6)));
    await flush();
    expect(state()).toBe("open");
    act(() => setGate("billing", true));
    expect(state()).toBe("blocked -");
  });

  it("coming back to the front asks again", async () => {
    const fetcher = vi.fn(() => Promise.resolve(row(1)));
    mount(fetcher);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(() => Promise.resolve(row(6)));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state()).toBe("blocked -");
  });

  it("the website (not the bundled app): never asks, never blocks - even with a stored minimum above it", async () => {
    store(row(99));
    const fetcher = vi.fn(() => Promise.resolve(row(99)));
    mount(fetcher, false);
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(state()).toBe("open");
  });
});
