// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import type { MinVersion } from "@/data/minVersion";
import { MIN_VERSION_KEY } from "@/data/versionGate";
import { resetUpdateGate, setGate } from "@/pwa/updateGate";
import { stubLocalStorage } from "./testStorage";
import { VersionGateProvider, useVersionGate } from "./VersionGate";
import { PleaseUpdate } from "./PleaseUpdate";

// D116 (owner, 19 Nov 2026): "Please update" - a hard block. Its Update button goes to app_min_version.update_url (none yet: "Ask for
// the new version"); it shows the bills not yet uploaded (the sync loop keeps running behind it - App.tsx mounts it INSIDE the shop
// loader); no Sign out (a sign-out could lose them). "Check again" asks the server now and opens the app without a restart.

const APP = 5;
const row = (min: number, url: string | null = null): MinVersion => ({ minVersionCode: min, updateUrl: url });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let db: KiranaBillDB | null = null;

function Screen({ localDb = null }: { localDb?: KiranaBillDB | null }) {
  const { blocked } = useVersionGate();
  return blocked ? <PleaseUpdate localDb={localDb} /> : <p>the app</p>;
}
const mount = (fetcher: (s: AbortSignal) => Promise<MinVersion>, localDb: KiranaBillDB | null = null) =>
  render(<VersionGateProvider applies appVersionCode={APP} fetcher={fetcher}><Screen localDb={localDb} /></VersionGateProvider>);
const blockWith = (m: MinVersion) => localStorage.setItem(MIN_VERSION_KEY, JSON.stringify(m));
const offline = () => Promise.reject(new TypeError("fetch failed"));

beforeEach(() => {
  stubLocalStorage();
  setGate("billing", true);
});
afterEach(async () => {
  cleanup();
  resetUpdateGate();
  db?.close();
  await db?.delete();
  db = null;
});

async function billsWaiting(n: number) {
  db = new KiranaBillDB(`update-${crypto.randomUUID()}`);
  for (let i = 0; i < n; i++)
    await db.bills.put({ localId: crypto.randomUUID(), shopId: "s", status: "final", syncStatus: "pending", createdAt: "2026-11-19T10:00:00.000Z", customerName: "Cash", totalPaise: 100 } as never);
  return db;
}

describe("Please update", () => {
  it("the Update button goes to the address in app_min_version, in the phone's browser", async () => {
    blockWith(row(6, "https://play.google.com/store/apps/details?id=com.kiranavoicebill.app"));
    mount(offline);
    expect(screen.getByRole("heading", { name: "Please update" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Update" });
    expect(link.getAttribute("href")).toBe("https://play.google.com/store/apps/details?id=com.kiranavoicebill.app");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("no address yet: 'Ask for the new version', no Update link", () => {
    blockWith(row(6));
    mount(offline);
    expect(screen.getByText("Ask for the new version.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Update" })).toBeNull();
  });

  it("shows the bills not yet uploaded, and never offers Sign out", async () => {
    blockWith(row(6));
    mount(offline, await billsWaiting(3));
    expect(await screen.findByText("3 bills haven't reached the server yet.")).toBeTruthy();
    expect(screen.getByText("Keep the app open with internet so they upload.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("nothing waiting: says every bill has reached the server", async () => {
    blockWith(row(6));
    mount(offline, await billsWaiting(0));
    expect(await screen.findByText("All bills have reached the server.")).toBeTruthy();
  });

  it("Check again: the minimum came down - the app opens at once, no restart", async () => {
    blockWith(row(6));
    const fetcher = vi.fn<(s: AbortSignal) => Promise<MinVersion>>(() => Promise.resolve(row(6)));
    mount(fetcher);
    await flush();
    expect(screen.getByRole("heading", { name: "Please update" })).toBeTruthy();
    fetcher.mockImplementation(() => Promise.resolve(row(5)));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("the app")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("Check again offline: stays on the screen, nothing breaks", async () => {
    blockWith(row(6));
    mount(offline);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Please update" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" }).getAttribute("aria-disabled")).not.toBe("true");
  });
});
