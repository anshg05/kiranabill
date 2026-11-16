// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalBill } from "@/data/db";
import { render as say } from "@/domain/messages";
import { HomeScreen } from "./HomeScreen";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";

// KB-414 step 1 (owner + reviewer, 16 Nov 2026; plan defaults): 08-Home in the new look - the greeting and the shop's name, the
// profile button (opens More), the record card (the mic records, Type items opens Add item), Recent bills (the 2 newest, See all ->
// Bills). NOT built (new features, 26 §9): Reprint last (KB-418) and the two stat cards (KB-417) - the space closes up (Q5).

const SHOP = "shop-1";
let db: KiranaBillDB;
beforeEach(() => {
  stubLocalStorage();
  db = new KiranaBillDB(`home-${crypto.randomUUID()}`);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 50));
  db.close();
  vi.unstubAllGlobals();
});

function bill(n: number, at: string, over: Partial<LocalBill> = {}): LocalBill {
  return {
    localId: crypto.randomUUID(), shopId: SHOP, status: "final", syncStatus: "synced", receiptNumber: String(n), receiptNumberSource: "block",
    customerName: "Cash", customerMobile: null, subtotalPaise: 0, totalPaise: 0, schemaVersion: 1, deviceId: "d", createdAt: at, finalizedAt: at, syncedAt: null, ...over,
  };
}
async function items(b: LocalBill, count: number) {
  for (let i = 0; i < count; i++)
    await db.billItems.add({ billLocalId: b.localId, shopId: SHOP, lineNo: i + 1, shopProductId: null, displayName: `x${i}` } as never);
}
const at = (h: number, m: number) => new Date(2026, 10, 16, h, m).toISOString();

function home(over: Partial<Parameters<typeof HomeScreen>[0]> = {}) {
  const props = {
    localDb: db, shopId: SHOP, shopName: "Gupta Kirana Store", now: () => new Date(2026, 10, 16, 9, 30),
    onRecord: vi.fn(), onType: vi.fn(), onOpenBill: vi.fn(), onSeeAll: vi.fn(), onProfile: vi.fn(), ...over,
  };
  render(<HomeScreen {...props} />);
  return props;
}

describe("08 Home", () => {
  it("as drawn: the logo, the greeting over the shop's name (19 / 800), the profile button", () => {
    const p = home();
    expect(screen.getByText("Good morning").className).toContain("text-kb-13");
    expect(screen.getByText("Gupta Kirana Store").className).toContain("text-kb-19");
    expect(screen.getByText("Gupta Kirana Store").className).toContain("font-extrabold");
    expect(document.querySelector("img")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Shop profile" }));
    expect(p.onProfile).toHaveBeenCalledOnce(); // Q4: it opens More
  });

  it("the greeting follows the phone's clock (morning before 12, afternoon before 5 pm, then evening)", () => {
    home({ now: () => new Date(2026, 10, 16, 13, 0) });
    expect(screen.getByText("Good afternoon")).toBeTruthy();
    cleanup();
    home({ now: () => new Date(2026, 10, 16, 19, 0) });
    expect(screen.getByText("Good evening")).toBeTruthy();
  });

  it("the record card: 'Ready for the next order', the mic records, 'Tap to record · pause any time', Type items opens Add item", () => {
    const p = home();
    expect(screen.getByRole("heading", { name: "Ready for the next order" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record order" }));
    expect(p.onRecord).toHaveBeenCalledOnce();
    expect(screen.getByText("Tap to record · pause any time")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Type items" }));
    expect(p.onType).toHaveBeenCalledOnce();
  });

  it("NOT built here (26 §9 new features): no Reprint last, no Today's bills / Today's sales cards", () => {
    home();
    expect(screen.queryByText("Reprint last")).toBeNull();
    expect(screen.queryByText(/Today.s bills/)).toBeNull();
    expect(screen.queryByText(/Today.s sales/)).toBeNull();
  });

  it("Recent bills: the 2 newest saved bills (a cancelled one too) - 'Bill 514', 'N items · 1:02 pm', the amount; a row opens that bill", async () => {
    const old = bill(512, at(11, 0), { totalPaise: 64000 });
    const b513 = bill(513, at(12, 40), { totalPaise: 121500, status: "cancelled" });
    const b514 = bill(514, at(13, 2), { totalPaise: 221600 });
    await db.bills.bulkAdd([old, b513, b514, bill(0, at(14, 0), { status: "draft" }), bill(9, at(15, 0), { shopId: "other" })]);
    await items(b514, 38);
    await items(b513, 1);
    const p = home();
    const card = await screen.findByRole("list", { name: "Recent bills" });
    const rows = within(card).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["Bill 51438 items · 1:02 pm₹2,216", "Bill 5131 item · 12:40 pm₹1,215"]);
    expect(within(rows[1]!).getByText("₹1,215").className).toContain("line-through"); // cancelled: struck through, as Bills draws it
    expect(within(rows[0]!).getByText("₹2,216").className).not.toContain("line-through");
    fireEvent.click(rows[0]!);
    expect(p.onOpenBill).toHaveBeenCalledWith(b514.localId);
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(p.onSeeAll).toHaveBeenCalledOnce();
  });

  it("'38 items' and '1:02 pm' never break inside (360 + 130%: owner, 16 Nov 2026) - the line wraps only between them, in every language", async () => {
    for (const id of ["home.metaOne", "home.metaMany"] as const) for (const l of ["en", "hi", "hl"] as const) expect(say(id, { n: 3, time: "x" }, l)).toContain(" · ");
    const b = bill(514, at(13, 2), { totalPaise: 221600 });
    await db.bills.add(b);
    await items(b, 38);
    home();
    const meta = await waitFor(() => {
      const m = document.querySelector("[data-meta]");
      if (!m) throw new Error("not yet");
      return m;
    });
    expect(meta.textContent).toBe("38 items · 1:02 pm");
    const parts = [...meta.children];
    expect(parts.map((p) => p.textContent)).toEqual(["38 items", "1:02 pm"]);
    for (const p of parts) expect(p.className).toContain("whitespace-nowrap");
  });

  it("no saved bills yet: no Recent bills section (the record card is the one action)", async () => {
    home();
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(screen.queryByText("Recent bills")).toBeNull();
  });

  it("a cold start reads the bills from the phone: a fresh connection shows the same Recent bills", async () => {
    const name = db.name;
    const b = bill(700, at(10, 5), { totalPaise: 5000 });
    await db.bills.add(b);
    db.close();
    db = new KiranaBillDB(name);
    home();
    await waitFor(() => expect(screen.getByRole("list", { name: "Recent bills" }).textContent).toContain("Bill 700"));
  });

  it("Hindi: every word on Home from the catalog", async () => {
    setScreenLanguage("hi");
    await db.bills.add(bill(514, at(13, 2), { totalPaise: 221600 }));
    home();
    for (const id of ["home.morning", "home.ready", "home.tapToRecord", "home.typeItems"] as const) expect(screen.getByText(say(id, {}, "hi"))).toBeTruthy();
    await screen.findByText(say("home.recent", {}, "hi"));
    expect(screen.getByRole("button", { name: say("home.seeAll", {}, "hi") })).toBeTruthy();
    expect(screen.getByRole("button", { name: say("order.record", {}, "hi") })).toBeTruthy();
    expect(screen.getByRole("button", { name: say("home.profile", {}, "hi") })).toBeTruthy();
  });
});
