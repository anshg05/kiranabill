// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalBaseProduct, type LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import { BillView } from "./BillingScreen";
import { CatalogScreen } from "./CatalogScreen";

// KB-311 (owner, 8 Oct 2026): S4 Catalog. Search (the Add item index), rows
// with name, unit, price and use count, filters, an inline price edit
// (parseMoneyInput), "Add from ready catalog", and the learning suggestions.
// Edits are ONLINE only (Q1) and go through the injected writers - in the app
// they write to Postgres and re-pull (data/catalogEdit.ts, its own e2e). The
// fakes here do what the re-pull does: they update Dexie. The screen itself
// never writes Dexie.

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;

function product(p: Partial<LocalShopProduct> & Pick<LocalShopProduct, "displayName">): LocalShopProduct {
  return {
    id: crypto.randomUUID(), shopId, baseProductId: null, category: null, unit: "kg", pricePaise: 4_000, aliases: [p.displayName],
    source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...p,
  };
}
function base(displayName: string, suggestedPricePaise: number, aliases: string[] = [displayName]): LocalBaseProduct {
  return { id: crypto.randomUUID(), catalogVersion: 1, displayName, sourceCategory: "grain", guardCategory: "grain", defaultUnit: "kg", suggestedPricePaise, aliases, isActive: true };
}

const sugar = product({ displayName: "Sugar", aliases: ["Sugar", "chini", "cheeni"], pricePaise: 4_800, useCount: 9, source: "base" });
const atta = product({ displayName: "Atta", pricePaise: 3_500, useCount: 9, source: "base" });
const pen = product({ displayName: "Pen", unit: "pc", pricePaise: 1_000, useCount: 2, source: "custom" });
const rusk = product({ displayName: "Rusk", unit: "pkt", pricePaise: 3_000, useCount: 0, source: "learned" });
const hidden = product({ displayName: "Old Soap", isActive: false });
const otherShop = product({ displayName: "Other Shop Dal", shopId: "99999999-9999-4999-8999-999999999999" });
const besan = base("Besan", 9_000, ["Besan", "gram flour"]);
const sugarBase = base("Sugar", 4_500);

let online = true;
beforeEach(async () => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  db = new KiranaBillDB(`ui-catalog-${crypto.randomUUID()}`);
  await db.shopProducts.bulkPut([sugar, atta, pen, rusk, hidden, otherShop]);
  await db.baseProducts.bulkPut([besan, sugarBase]);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

/** What saveProductPrice does in the app after the server accepts: the re-pull updates Dexie. */
function fakeWriters(result: CatalogWriteResult = { ok: true }) {
  const save = vi.fn(async (id: string, pricePaise: number) => {
    if (result.ok) await db.shopProducts.update(id, { pricePaise });
    return result;
  });
  const add = vi.fn(async (b: LocalBaseProduct) => {
    if (result.ok) await db.shopProducts.put(product({ displayName: b.displayName, baseProductId: b.id, source: "base", pricePaise: b.suggestedPricePaise }));
    return result;
  });
  return { save, add };
}

async function open(writers = fakeWriters(), onChanged = vi.fn(), onClose = vi.fn()) {
  render(<CatalogScreen localDb={db} shopId={shopId} save={writers.save} add={writers.add} onChanged={onChanged} onClose={onClose} />);
  await screen.findByRole("list", { name: "Products" });
  return { ...writers, onChanged, onClose };
}
const rows = () => within(screen.getByRole("list", { name: "Products" })).getAllByRole("listitem");
const names = () => rows().map((r) => within(r).getByTestId("name").textContent);
const row = (name: string) => rows().find((r) => within(r).getByTestId("name").textContent === name)!;
const search = (q: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: q } });

describe("KB-311 - S4 Catalog", () => {
  it("the ≡ menu has Catalog", () => {
    const onOpenCatalog = vi.fn();
    render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onOpenCatalog={onOpenCatalog} />);
    fireEvent.click(screen.getByRole("button", { name: "Catalog" }));
    expect(onOpenCatalog).toHaveBeenCalledOnce();
  });

  it("rows: this shop's active products, most used first, then by name - name, unit, price, use count", async () => {
    await open();
    expect(names()).toEqual(["Atta", "Sugar", "Pen", "Rusk"]);
    expect(row("Sugar").textContent).toContain("₹48 / kg");
    expect(row("Sugar").textContent).toContain("Used 9 times");
    expect(row("Rusk").textContent).toContain("Not used yet");
  });

  it("filters: Custom, Learned, From base catalog", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(names()).toEqual(["Pen"]);
    fireEvent.click(screen.getByRole("radio", { name: "Learned" }));
    expect(names()).toEqual(["Rusk"]);
    fireEvent.click(screen.getByRole("radio", { name: "From base catalog" }));
    expect(names()).toEqual(["Atta", "Sugar"]);
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(names()).toHaveLength(4);
  });

  it("a filter with nothing in it says so - never a blank list", async () => {
    await db.shopProducts.delete(pen.id);
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(screen.getByText("No products of this kind.")).toBeTruthy();
    expect(screen.queryByText("No products found.")).toBeNull();
  });

  it("search uses the Add item index - an alias finds the product", async () => {
    await open();
    search("chini");
    expect(names()).toEqual(["Sugar"]);
    search("zzzz");
    expect(screen.getByText("No products found.")).toBeTruthy();
  });

  it("price edit: the typed rupees are saved as paise, the screen shows the re-pulled price, billing is told to reload", async () => {
    const { save, onChanged } = await open();
    fireEvent.click(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" }));
    const input = within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" });
    fireEvent.change(input, { target: { value: "52.50" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(row("Sugar").textContent).toContain("₹52.50 / kg"));
    expect(save).toHaveBeenCalledExactlyOnceWith(sugar.id, 5_250);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("a price that isn't money is refused with the reason - nothing is saved", async () => {
    const { save } = await open();
    fireEvent.click(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" }));
    const input = within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" });
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(row("Sugar")).getByRole("alert").textContent).toBe("Must be more than ₹0");
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed save says so and the price stays as it was - the screen never writes the price itself", async () => {
    const writers = fakeWriters({ ok: false, reason: "failed" });
    const { onChanged } = await open(writers);
    fireEvent.click(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" }));
    const input = within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" });
    fireEvent.change(input, { target: { value: "60" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await within(row("Sugar")).findByRole("alert")).textContent).toBe("Couldn't save — check the internet and try again");
    expect(row("Sugar").textContent).toContain("₹48 / kg");
    expect((await db.shopProducts.get(sugar.id))?.pricePaise).toBe(4_800);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offline: 'Needs internet to change the catalog' - prices are plain text and Add is disabled; nothing can be saved", async () => {
    online = false;
    const { save } = await open();
    expect(screen.getByText("Needs internet to change the catalog")).toBeTruthy();
    expect(within(row("Sugar")).queryByRole("button", { name: "Price of Sugar" })).toBeNull();
    expect(row("Sugar").textContent).toContain("₹48 / kg");
    expect(screen.getByRole("button", { name: "Add from ready catalog" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add from ready catalog" }));
    expect(screen.queryByRole("region", { name: "Ready catalog" })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("going offline while the screen is open disables editing at once", async () => {
    await open();
    expect(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" })).toBeTruthy();
    online = false;
    fireEvent(window, new Event("offline"));
    await waitFor(() => expect(screen.getByText("Needs internet to change the catalog")).toBeTruthy());
    expect(within(row("Sugar")).queryByRole("button", { name: "Price of Sugar" })).toBeNull();
  });

  it("Add from ready catalog: only base products not yet in the shop; Add copies one in and it leaves the list", async () => {
    const { add, onChanged } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Add from ready catalog" }));
    const ready = await screen.findByRole("region", { name: "Ready catalog" });
    const readyNames = () => within(ready).queryAllByTestId("ready-name").map((n) => n.textContent);
    await within(ready).findByTestId("ready-name"); // the base products load from Dexie
    expect(readyNames()).toEqual(["Besan"]); // Sugar is already in the shop
    fireEvent.change(within(ready).getByRole("searchbox", { name: "Search ready catalog" }), { target: { value: "gram" } });
    expect(readyNames()).toEqual(["Besan"]);
    fireEvent.click(within(ready).getByRole("button", { name: "Add Besan" }));
    await waitFor(() => expect(readyNames()).toEqual([]));
    expect(add).toHaveBeenCalledExactlyOnceWith(besan);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(within(ready).getByText("Besan added — ₹90 / kg")).toBeTruthy();
  });

  it("a duplicate name is a plain message", async () => {
    await open(fakeWriters({ ok: false, reason: "duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Add from ready catalog" }));
    const ready = await screen.findByRole("region", { name: "Ready catalog" });
    fireEvent.click(await within(ready).findByRole("button", { name: "Add Besan" }));
    expect((await within(ready).findByRole("alert")).textContent).toBe("Besan is already in your catalog");
  });

  it("suggestions: a price paid 3 times shows 'Use ₹X' - applied only on the tap, through the same save", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await db.priceObservations.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", shopProductId: sugar.id, observedPricePaise: 5_500, occurredAt: now, updatedAt: now, deviceId: "d" });
    }
    await db.provisionalProducts.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", spokenName: "kurkure", seenCount: 2, suggestedUnit: null, suggestedPricePaise: 1_000, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId: "d" });
    const { save } = await open();
    const panel = await screen.findByRole("region", { name: "Suggestions" });
    await within(panel).findByText(/Sugar/);
    expect(panel.textContent).toContain("Sugar: ₹55 / kg on 3 bills (now ₹48)");
    expect(panel.textContent).toContain("“kurkure” — said 2 times, not in the catalog");
    expect(within(panel).getAllByRole("button")).toHaveLength(1); // provisional products are read-only (KB-320)
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Use ₹55 for Sugar" }));
    await waitFor(() => expect(row("Sugar").textContent).toContain("₹55 / kg"));
    expect(save).toHaveBeenCalledExactlyOnceWith(sugar.id, 5_500);
    await waitFor(() => expect(within(panel).queryByText(/Sugar/)).toBeNull()); // the shop's price now matches
  });

  it("Back closes the Catalog", async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
