// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { KiranaBillDB } from "@/data/db";
import { enqueueRecording } from "@/data/voiceQueue";
import { saveRecordingDraft } from "@/data/recordingDraft";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { parseUtterance } from "@/domain/grammar";
import { BillBack, TabFrame, useStartTab, type Tab } from "./AppTabs";
import { draftRow, saveDraft } from "./billDraftStore";
import { EMPTY_BILL, useBillLines } from "./useBillLines";

// KB-414 step 1 (owner + reviewer, 16 Nov 2026; plan defaults): the bottom nav (Home, Bills, Items, More) replaces the ≡ menu; Android
// Back on Bills / Items / More / the bill (12) goes to Home, Home's Back leaves the app (as the main screen did); offline, the ink strip
// "No internet · billing still works" sits on top of the tab screens (Q3). WHERE THE APP OPENS (Q1): Home - except when a bill holds
// lines, a customer, a not-added order, a recording not yet in the bill or 10's saved take: then that bill, as today, so 10 / 11 / 23 / 24
// still come back after a full close (KB-413 bug 2).

const SHOP = "shop-1";
let name = "";
let db: KiranaBillDB;
let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  name = `tabs-${crypto.randomUUID()}`;
  db = new KiranaBillDB(name);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 100));
  db.close();
});

function Frame({ start = "home" as Tab, offline = false }) {
  const [tab, setTab] = useState<Tab>(start);
  return (
    <TabFrame tab={tab} onTab={setTab} offline={offline}>
      <p data-testid="tab">{tab}</p>
    </TabFrame>
  );
}
const navButton = (n: string) => screen.getByRole("button", { name: n });

describe("the bottom nav", () => {
  it("four tabs as drawn - Home, Bills, Items, More; the active one is marked; a tap switches", () => {
    render(<Frame />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Home", "Bills", "Items", "More"]);
    expect(navButton("Home").getAttribute("aria-current")).toBe("page");
    fireEvent.click(navButton("Items"));
    expect(screen.getByTestId("tab").textContent).toBe("items");
    expect(navButton("Items").getAttribute("aria-current")).toBe("page");
    expect(navButton("Home").getAttribute("aria-current")).toBeNull();
  });

  it("sits above the tab screens (z 25 over their z 20) and below their inner screens and sheets (z 30 / 40)", () => {
    render(<Frame />);
    expect(screen.getByRole("navigation").parentElement!.className).toMatch(/z-\[25\]/);
  });

  it("offline: the ink strip on top of the tab screens; online: none", () => {
    const { rerender } = render(<Frame offline />);
    expect(screen.getByText("No internet · billing still works")).toBeTruthy();
    rerender(<Frame offline={false} />);
    expect(screen.queryByText("No internet · billing still works")).toBeNull();
  });
});

describe("Android Back", () => {
  it("on the bill (12) goes to Home, the bill untouched", async () => {
    const onBack = vi.fn();
    render(<BillBack onBack={onBack} />);
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(onBack).toHaveBeenCalledOnce();
  });
});

/** The app's own start: the bill hook (its draft from the phone) and the tab it opens on. */
function useApp() {
  const bill = useBillLines(SEED_PARSER_CATALOG.entries, { db, shopId: SHOP });
  const [tab] = useStartTab(bill.ready, bill.resumed);
  return { bill, tab };
}
async function coldStart() {
  db.close();
  db = new KiranaBillDB(name);
  const view = renderHook(useApp);
  await waitFor(() => expect(view.result.current.tab).not.toBeNull());
  return view.result.current;
}
const empty = () => ({ ...EMPTY_BILL, localId: crypto.randomUUID(), startedAt: new Date().toISOString() });

describe("where the app opens (Q1) - a real cold start: a fresh connection reading only the phone's database", () => {
  it("nothing on the phone: Home", async () => {
    expect((await coldStart()).tab).toBe("home");
  });

  it("a bill with lines: that bill (12), as today", async () => {
    const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
    const state = { ...empty(), rows: items.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: "चीनी", source: "fastpath" as const })), nextId: 2 };
    await saveDraft(db, SHOP, state);
    const app = await coldStart();
    expect(app.tab).toBe("bill");
    expect(app.bill.localId).toBe(state.localId);
    expect(app.bill.rows).toHaveLength(1);
  });

  it("an EMPTY bill holding a failed recording (23) / a queued one (11, 24): that bill", async () => {
    for (const state of ["failed", "queued"] as const) {
      const bill = empty();
      await enqueueRecording(db, { recordingId: crypto.randomUUID(), shopId: SHOP, billLocalId: bill.localId, audio: new Blob(["a"]), recordedMs: 1000, billEmpty: true, draft: draftRow(SHOP, bill) });
      if (state === "failed") await db.voiceQueue.toCollection().modify({ state: "failed", reason: "upload" });
      const app = await coldStart();
      expect(app.tab, state).toBe("bill");
      expect(app.bill.localId).toBe(bill.localId);
      cleanup();
      await db.voiceQueue.clear();
      await db.meta.clear();
    }
  });

  it("10's saved take: that bill (10 comes back on it)", async () => {
    const bill = empty();
    await saveRecordingDraft(db, { shopId: SHOP, audio: new Blob(["a"]), recordedMs: 1000, draft: draftRow(SHOP, bill) });
    expect((await coldStart()).tab).toBe("bill");
  });

  it("10's saved take with NO draft (kept before KB-413's fix wrote one with it): the bill, so 10 comes back", async () => {
    await saveRecordingDraft(db, { shopId: SHOP, audio: new Blob(["a"]), recordedMs: 1000 });
    expect(await db.meta.count()).toBe(0);
    expect((await coldStart()).tab).toBe("bill");
  });

  it("a draft left empty (its recording removed, nothing else on it): Home, not an empty bill", async () => {
    const bill = empty();
    await db.meta.put(draftRow(SHOP, bill));
    expect((await coldStart()).tab).toBe("home");
  });

  it("a recording already added to its bill (appended) does not count: Home", async () => {
    const bill = empty();
    await enqueueRecording(db, { recordingId: "r", shopId: SHOP, billLocalId: bill.localId, audio: new Blob(["a"]), recordedMs: 1000, draft: draftRow(SHOP, bill) });
    await db.voiceQueue.update("r", { state: "appended" });
    expect((await coldStart()).tab).toBe("home");
  });

  it("the tab is chosen ONCE: going Home later never jumps back to the bill by itself", async () => {
    const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
    await saveDraft(db, SHOP, { ...empty(), rows: items.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: "चीनी", source: "fastpath" as const })), nextId: 2 });
    const view = renderHook(() => {
      const bill = useBillLines(SEED_PARSER_CATALOG.entries, { db, shopId: SHOP });
      return useStartTab(bill.ready, bill.resumed);
    });
    await waitFor(() => expect(view.result.current[0]).toBe("bill"));
    act(() => view.result.current[1]("home"));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(view.result.current[0]).toBe("home");
  });
});
