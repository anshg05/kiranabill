// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import { ignorePriceSuggestionFor } from "@/data/learningAudit";
import { CatalogScreen } from "./CatalogScreen";

// KB-329 (D78): [Ignore] on a Catalog price suggestion. The screen only calls the injected `ignoreSuggestion` (in the app:
// an append-only learning event, data/learningAudit.ts, with its own tests); then it re-reads and the row is gone. It never
// changes a price, and it works offline (a local learning write - unlike "Use ₹X", which writes the catalog online).

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
let online = true;

const sugar: LocalShopProduct = {
  id: crypto.randomUUID(), shopId, baseProductId: null, displayName: "Sugar", category: null, unit: "kg", pricePaise: 4_800, aliases: [],
  source: "custom", useCount: 3, sku: null, barcode: null, isActive: true,
};
const atta: LocalShopProduct = { ...sugar, id: crypto.randomUUID(), displayName: "Atta", pricePaise: 3_500 };

beforeEach(async () => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  db = new KiranaBillDB(`ui-price-ignore-${crypto.randomUUID()}`);
  await db.shopProducts.bulkPut([sugar, atta]);
  const now = new Date().toISOString();
  for (const [p, price] of [[sugar, 5_500], [atta, 3_900]] as const) {
    for (let i = 0; i < 3; i++) {
      await db.priceObservations.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", shopProductId: p.id, observedPricePaise: price, occurredAt: now, updatedAt: now, deviceId: "d" });
    }
  }
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

function open(ignoreSuggestion?: (id: string) => Promise<void>) {
  const save = vi.fn(async () => ({ ok: true }) as const);
  render(<CatalogScreen localDb={db} shopId={shopId} save={save} add={vi.fn()} ignoreSuggestion={ignoreSuggestion} onChanged={() => {}} onClose={() => {}} />);
  return save;
}
const panel = () => screen.findByRole("region", { name: "Suggestions" });
const realIgnore = vi.fn((id: string) => ignorePriceSuggestionFor(db, shopId, id, "dev-a", Date.now()));

describe("KB-329 - Ignore on a price suggestion", () => {
  it("each suggestion has an Ignore button beside Use; with no handler there is none", async () => {
    open();
    const p = await panel();
    expect(within(p).queryByRole("button", { name: /Ignore/ })).toBeNull();
    cleanup();
    open(realIgnore);
    const p2 = await panel();
    expect(within(p2).getByRole("button", { name: "Ignore the suggestion for Sugar" }).textContent).toBe("Ignore");
    expect(within(p2).getByRole("button", { name: "Ignore the suggestion for Atta" })).toBeTruthy();
    expect(within(p2).getByRole("button", { name: "Use ₹55 for Sugar" })).toBeTruthy();
  });

  it("tapping it hides THAT suggestion, keeps the other, says so, and changes no price", async () => {
    realIgnore.mockClear();
    const save = open(realIgnore);
    const p = await panel();
    fireEvent.click(within(p).getByRole("button", { name: "Ignore the suggestion for Sugar" }));
    await waitFor(() => expect(realIgnore).toHaveBeenCalledExactlyOnceWith(sugar.id));
    await waitFor(() => expect(within(p).queryByText(/Sugar:/)).toBeNull());
    expect(within(p).getByText(/Atta:/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Suggestion for Sugar hidden for 90 days");
    expect(save).not.toHaveBeenCalled();
    expect((await db.shopProducts.get(sugar.id))!.pricePaise).toBe(4_800);
    expect(screen.getByText("₹48 / kg")).toBeTruthy(); // the row's price is untouched
  });

  it("works offline - it is a local learning write; 'Use' stays disabled offline", async () => {
    realIgnore.mockClear();
    open(realIgnore);
    const p = await panel();
    online = false;
    window.dispatchEvent(new Event("offline"));
    await screen.findByText("Needs internet to change the catalog");
    expect(within(p).getByRole("button", { name: "Use ₹55 for Sugar" }).getAttribute("aria-disabled")).toBe("true");
    const ignore = within(p).getByRole("button", { name: "Ignore the suggestion for Sugar" });
    expect(ignore.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(ignore);
    await waitFor(() => expect(realIgnore).toHaveBeenCalledOnce());
  });

  it("if saving the ignore fails the suggestion stays and the shopkeeper is told", async () => {
    open(() => Promise.reject(new Error("disk full")));
    const p = await panel();
    fireEvent.click(within(p).getByRole("button", { name: "Ignore the suggestion for Sugar" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Couldn't hide that suggestion — try again"));
    expect(within(p).getByText(/Sugar:/)).toBeTruthy();
  });

  it("the button is a 44 px touch target", async () => {
    open(realIgnore);
    const p = await panel();
    expect(within(p).getByRole("button", { name: "Ignore the suggestion for Sugar" }).className).toContain("min-h-11");
  });
});
