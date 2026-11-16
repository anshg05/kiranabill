// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import { finaliseBill } from "@/data/testNumbers";
import { TabFrame, useHidesNav } from "./AppTabs";
import { HistoryScreen } from "./HistoryScreen";
import { CatalogScreen } from "./CatalogScreen";
import { SignOutButton } from "./OfflineUi";
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-414 step 2 phone check (owner, 17 Nov 2026; the approved plan, A): on the phone the nav covered 15's bottom - "Cancel bill" under it,
// the tiles cut - because 15 is drawn INSIDE 14's fixed layer (z 20), which sits under the nav (z 25) whatever 15's own z says. The same
// held for the cancel sheet (25), the Items tab's Add / Edit / Import / Ready catalog pages and the Sign out warning. The fix: an inner
// page or sheet over a tab screen hides the nav while it is open (26 §6: inner pages have Back, no nav), and starts below the offline
// strip. 15's footer (Reprint, the tiles, Cancel bill) stays at the bottom; on a screen too short for it the whole page scrolls.

const nav = () => screen.queryByRole("navigation", { name: "Main" });
const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
let online = true;

beforeEach(async () => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  db = new KiranaBillDB(`inner-nav-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-11-16T00:00:00.000Z" });
  await db.syncState.put({ tableName: `bills:${shopId}`, lastSyncedAt: null, cursor: JSON.stringify({ phase: "done", before: null }), pendingCount: 0 });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30));
});

function Inner() {
  useHidesNav();
  return <p>inner</p>;
}
function Frame({ children, offline = false }: { children: ReactNode; offline?: boolean }) {
  return (
    <TabFrame tab="bills" onTab={() => {}} offline={offline}>
      {children}
    </TabFrame>
  );
}
const tabVar = (name: "--kb-tab-top" | "--kb-tab-bottom") => (screen.getByTestId("probe").closest("[style]") as HTMLElement).style.getPropertyValue(name);

describe("the tab frame and useHidesNav", () => {
  it("an inner page open: no nav; closed: the nav is back", () => {
    function Toggle() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
          {open && <Inner />}
        </>
      );
    }
    render(<Frame><Toggle /></Frame>);
    expect(nav()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(nav()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(nav()).toBeTruthy();
  });

  it("two open (15 and its cancel sheet): the nav comes back only when both have closed", () => {
    function Two() {
      const [n, setN] = useState(2);
      return (
        <>
          <button type="button" onClick={() => setN((x) => x - 1)}>close one</button>
          {n >= 1 && <Inner />}
          {n >= 2 && <Inner />}
        </>
      );
    }
    render(<Frame><Two /></Frame>);
    expect(nav()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close one" }));
    expect(nav()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close one" }));
    expect(nav()).toBeTruthy();
  });

  it("the nav is gone in the SAME commit the inner page appears (a layout effect - never one painted frame of the nav over it)", () => {
    // flushSync outside act: the commit and its layout effects (and their updates) run; passive effects wait for after the paint
    const host = document.createElement("div");
    document.body.appendChild(host);
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
    const root = createRoot(host);
    const frame = (open: boolean) => <Frame>{open && <Inner />}</Frame>;
    try {
      flushSync(() => root.render(frame(false)));
      expect(host.querySelector("nav")).toBeTruthy();
      flushSync(() => root.render(frame(true)));
      expect(host.querySelector("nav")).toBeNull();
    } finally {
      flushSync(() => root.unmount());
      host.remove();
      g.IS_REACT_ACT_ENVIRONMENT = before;
    }
  });

  it("with the nav hidden, the tab screens' bottom inset is 0 (nothing keeps a gap for a nav that is not there); back: the nav's height", () => {
    // jsdom lays nothing out: the nav's box is given the phone's measured 69 px (USB, 17 Nov 2026)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.querySelector("nav") ? 69 : 0;
    });
    function Toggle() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
          {open && <Inner />}
          <i data-testid="probe" />
        </>
      );
    }
    render(<Frame><Toggle /></Frame>);
    expect(tabVar("--kb-tab-bottom")).toBe("69px");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(tabVar("--kb-tab-bottom")).toBe("0px");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(tabVar("--kb-tab-bottom")).toBe("69px");
  });

  it("outside a tab frame (the bill, 12) useHidesNav does nothing and never throws", () => {
    render(<Inner />);
    expect(screen.getByText("inner")).toBeTruthy();
  });
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"]), pdf: new Blob(["pdf"]) });

describe("15 Bill detail and 25 Cancel, inside the real tab frame", () => {
  async function openBill() {
    const localId = crypto.randomUUID();
    await finaliseBill(db, { localId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: new Date() });
    const number = (await db.bills.get(localId))!.receiptNumber;
    render(
      <Frame>
        <HistoryScreen localDb={db} shopId={shopId} render={renderFiles} deviceId={deviceId} onClose={() => {}} />
      </Frame>,
    );
    const list = await screen.findByRole("list", { name: "Bills" });
    expect(nav()).toBeTruthy(); // 14 is a tab screen: the nav is there
    fireEvent.click(within(list).getAllByRole("button").find((b) => b.textContent?.includes(`Bill ${number}`))!);
    return screen.findByRole("region", { name: "Bill" });
  }

  it("15 open: no nav (its Back, Reprint, the tiles and Cancel bill are never under it); Back: the nav is back on 14", async () => {
    const detail = await openBill();
    expect(nav()).toBeNull();
    await screen.findByRole("button", { name: "Cancel bill" });
    fireEvent.click(within(detail).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("region", { name: "Bill" })).toBeNull();
    expect(nav()).toBeTruthy();
  });

  it("25 over 15: no nav; Keep closes the sheet - still 15, still no nav", async () => {
    await openBill();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel bill" }));
    const sheet = await screen.findByRole("dialog");
    expect(nav()).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: /^Keep Bill/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Bill" })).toBeTruthy();
    expect(nav()).toBeNull();
  });

  it("15 starts below the offline strip (the strip never covers its Back and title) and fills to the bottom", async () => {
    const detail = await openBill();
    const cls = detail.getAttribute("class") ?? "";
    expect(cls).toContain("top-[var(--kb-tab-top,0px)]");
    expect(cls).toContain("bottom-0");
    expect(cls).not.toContain("inset-0");
  });

  it("15's footer stays at the bottom with the receipt scrolling above it; on a screen too short for both the WHOLE page scrolls", async () => {
    const detail = await openBill();
    await screen.findByRole("button", { name: "Cancel bill" });
    const page = detail.firstElementChild as HTMLElement;
    const list = detail.querySelector("[data-scroll-list]") as HTMLElement;
    const footer = detail.querySelector("[data-detail-footer]") as HTMLElement;
    expect(page.getAttribute("class")).toContain("overflow-y-auto"); // the page itself scrolls when it must
    expect(list.getAttribute("class")).toContain("overflow-y-auto"); // the receipt scrolls above the footer
    expect(list.getAttribute("class")).toMatch(/min-h-\[/); // ...but never shrinks to nothing: then the page scrolls instead
    expect(footer.getAttribute("class")).toContain("flex-none");
    expect(within(footer).getByRole("button", { name: "Cancel bill" })).toBeTruthy();
    // the drawn 22 px under the footer, or the phone's home-bar inset when larger (never the 12 px of .safe-bottom)
    expect(footer.getAttribute("class")).toContain("pb-[max(22px,env(safe-area-inset-bottom))]");
    expect(footer.getAttribute("class")).not.toContain("safe-bottom");
  });
});

function shopProduct(displayName: string): LocalShopProduct {
  return { id: crypto.randomUUID(), shopId, baseProductId: null, category: null, unit: "kg", pricePaise: 4_000, aliases: [displayName], source: "custom", useCount: 1, sku: null, barcode: null, isActive: true, displayName };
}

describe("the Items tab's inner pages and the Sign out warning, inside the real tab frame", () => {
  async function openItems() {
    await db.shopProducts.put(shopProduct("Sugar"));
    const ok = vi.fn(async () => ({ ok: true }) as const);
    render(
      <Frame>
        <CatalogScreen localDb={db} shopId={shopId} save={ok} add={ok} importRows={vi.fn()} saveDetails={ok} setActive={ok} create={ok} onChanged={() => {}} onClose={() => {}} />
      </Frame>,
    );
    await screen.findByRole("list", { name: "Products" });
    expect(nav()).toBeTruthy();
  }
  const page = (name: string) => screen.findByRole("region", { name });

  for (const [what, open, name] of [
    ["Add product", () => fireEvent.click(screen.getByRole("button", { name: "Add product" })), "Add product"],
    ["Edit product", () => fireEvent.click(screen.getByRole("button", { name: "Edit Sugar" })), "Edit product"],
    ["Import", () => fireEvent.click(screen.getByRole("button", { name: "Import from file" })), "Import products"],
    ["Ready catalog", () => fireEvent.click(screen.getByRole("button", { name: "Add from ready catalog" })), "Ready catalog"],
  ] as const) {
    it(`${what}: no nav while it is open (its Save never under the nav), and it starts below the offline strip`, async () => {
      await openItems();
      await act(async () => open());
      const el = await page(name);
      expect(nav()).toBeNull();
      expect(el.getAttribute("class")).toContain("top-[var(--kb-tab-top,0px)]");
      expect(el.getAttribute("class")).not.toContain("inset-0");
    });
  }

  it("the Sign out warning: no nav over its dim background (the nav cannot be tapped behind a modal); Cancel: the nav is back", () => {
    render(
      <Frame>
        <SignOutButton unsynced={{ pending: 2, conflict: 0 }} billInProgress={false} onSignOut={() => {}} />
      </Frame>,
    );
    expect(nav()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(nav()).toBeNull();
    fireEvent.click(within(screen.getByRole("alertdialog")).getAllByRole("button")[0]!);
    expect(nav()).toBeTruthy();
  });

  it("a bottom sheet (the kit's) over a tab: below the offline strip too", () => {
    const src = readFileSync(join(__dirname, "kit", "BottomSheet.tsx"), "utf8");
    expect(src).toContain("useHidesNav()");
    expect(src).toContain("top-[var(--kb-tab-top,0px)]");
  });
});
