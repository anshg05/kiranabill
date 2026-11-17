// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalBaseProduct, type LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
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
  // KB-414 step 3: a card opens Edit item (needs the details writer) - the price is edited there
  const saveDetails = async () => ({ ok: true }) as const;
  render(<CatalogScreen localDb={db} shopId={shopId} save={writers.save} add={writers.add} saveDetails={saveDetails} onChanged={onChanged} onClose={onClose} />);
  await screen.findByRole("list", { name: "Products" });
  return { ...writers, onChanged, onClose };
}
// hidden: true - the list under an open Edit item / From your bills page is still there (inert), as on the phone
const rows = () => within(screen.getByRole("list", { name: "Products", hidden: true })).getAllByRole("listitem", { hidden: true });
const names = () => rows().map((r) => within(r).getByTestId("name").textContent);
const row = (name: string) => rows().find((r) => within(r).getByTestId("name").textContent === name)!;
const search = (q: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: q } });

describe("KB-311 - S4 Catalog (KB-414 step 3: Items 16 - the price is edited in Edit item, the extras behind '+ Add' and the banner)", () => {
  const filter = (name: string) => fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name }));
  /** Edit item for a product (the card's tap); the price field is "Price per <unit>". */
  async function edit(name: string) {
    fireEvent.click(screen.getByRole("button", { name: `Edit ${name}` }));
    return within(await screen.findByRole("region", { name: "Edit item" }));
  }
  async function readyCatalog() {
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Add items" })).getByRole("button", { name: /Add from ready catalog/ }));
    return screen.findByRole("region", { name: "Ready catalog" });
  }

  it("cards: this shop's active products, most used first, then by name - name, price per unit; the use count in Edit item", async () => {
    await open();
    expect(names()).toEqual(["Atta", "Sugar", "Pen", "Rusk"]);
    expect(row("Sugar").textContent).toContain("₹48");
    expect(row("Sugar").textContent).toContain("per kg");
    expect((await edit("Sugar")).getByText("Used 9 times")).toBeTruthy();
  });

  it("filters (16's chips): Custom, Learned, From base catalog, All", async () => {
    await open();
    filter("Custom");
    expect(names()).toEqual(["Pen"]);
    filter("Learned");
    expect(names()).toEqual(["Rusk"]);
    filter("From base catalog");
    expect(names()).toEqual(["Atta", "Sugar"]);
    filter("All 4");
    expect(names()).toHaveLength(4);
  });

  it("a filter with nothing in it says so - never a blank list", async () => {
    await db.shopProducts.delete(pen.id);
    await open();
    filter("Custom");
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

  it("price edit (Edit item): the typed rupees are saved as paise, the card shows the re-pulled price, billing is told to reload", async () => {
    const { save, onChanged } = await open();
    const page = await edit("Sugar");
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "52.50" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(row("Sugar").textContent).toContain("₹52.50"));
    expect(save).toHaveBeenCalledExactlyOnceWith(sugar.id, 5_250);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("a price that isn't money is refused with the reason - nothing is saved", async () => {
    const { save } = await open();
    const page = await edit("Sugar");
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "0" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    expect(page.getByRole("alert").textContent).toBe("Must be more than ₹0");
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed save says so and the price stays as it was - the screen never writes the price itself", async () => {
    const writers = fakeWriters({ ok: false, reason: "failed" });
    const { onChanged } = await open(writers);
    const page = await edit("Sugar");
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "60" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    expect((await page.findByRole("alert")).textContent).toBe("Couldn't save — check the internet and try again");
    expect(row("Sugar").textContent).toContain("₹48");
    expect((await db.shopProducts.get(sugar.id))?.pricePaise).toBe(4_800);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offline: 'Needs internet to change the catalog' - the ready catalog waits; nothing can be saved", async () => {
    online = false;
    const { save } = await open();
    expect(screen.getByText("Needs internet to change the catalog")).toBeTruthy();
    expect(within(row("Sugar")).queryByRole("textbox")).toBeNull();
    expect(row("Sugar").textContent).toContain("₹48");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const option = within(await screen.findByRole("dialog", { name: "Add items" })).getByRole("button", { name: /Add from ready catalog/ });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(option);
    expect(screen.queryByRole("region", { name: "Ready catalog" })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("going offline while Edit item is open stops the save at once", async () => {
    await open();
    const page = await edit("Sugar");
    expect(page.getByRole("button", { name: "Save item" }).hasAttribute("disabled")).toBe(true); // nothing changed yet
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "50" } });
    expect(page.getByRole("button", { name: "Save item" }).hasAttribute("disabled")).toBe(false);
    online = false;
    fireEvent(window, new Event("offline"));
    await waitFor(() => expect(page.getByText("Needs internet to change the catalog")).toBeTruthy());
    expect(page.getByRole("button", { name: "Save item" }).hasAttribute("disabled")).toBe(true);
  });

  it("Add from ready catalog: only base products not yet in the shop; Add copies one in and it leaves the list", async () => {
    const { add, onChanged } = await open();
    const ready = await readyCatalog();
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

  it("a duplicate name is a plain message, and the product (re-pulled) leaves the ready list", async () => {
    // What the data layer's re-pull does on a duplicate: the server's row arrives in Dexie.
    const writers = fakeWriters({ ok: false, reason: "duplicate" });
    writers.add.mockImplementation(async (b: LocalBaseProduct) => {
      await db.shopProducts.put(product({ displayName: b.displayName, baseProductId: null, source: "custom", pricePaise: 1_000 }));
      return { ok: false, reason: "duplicate" } as const;
    });
    await open(writers);
    const ready = await readyCatalog();
    fireEvent.click(await within(ready).findByRole("button", { name: "Add Besan" }));
    expect((await within(ready).findByRole("alert")).textContent).toBe("Besan is already in your catalog");
    await waitFor(() => expect(within(ready).queryByRole("button", { name: "Add Besan" })).toBeNull());
  });

  it("ready catalog empty because the shop has every ready product: says so", async () => {
    await db.shopProducts.put(product({ displayName: "Besan" }));
    await open();
    const ready = await readyCatalog();
    expect((await within(ready).findByText("Your shop already has every product in the ready catalog.")).textContent).toBeTruthy();
  });

  it("a ready-catalog search with no match says so and points to Add item", async () => {
    await open();
    const ready = await readyCatalog();
    await within(ready).findByTestId("ready-name");
    fireEvent.change(within(ready).getByRole("searchbox", { name: "Search ready catalog" }), { target: { value: "shahi <b>jeera" } });
    expect(within(ready).getByText("No ready product matches “shahi <b>jeera”. Add it from a bill: Add item → + Add “shahi <b>jeera” as a new product.")).toBeTruthy();
    expect(ready.querySelector("b")).toBeNull(); // the query is plain text
  });

  it("a search that only matches products the shop already has says they're already in the catalog", async () => {
    await open();
    const ready = await readyCatalog();
    await within(ready).findByTestId("ready-name");
    fireEvent.change(within(ready).getByRole("searchbox", { name: "Search ready catalog" }), { target: { value: "sugar" } });
    expect(within(ready).getByText("“sugar” is already in your catalog.")).toBeTruthy();
  });

  it("suggestions ('From your bills'): a price paid 3 times shows 'Use ₹X' - applied only on the tap, through the same save", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await db.priceObservations.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", shopProductId: sugar.id, observedPricePaise: 5_500, occurredAt: now, updatedAt: now, deviceId: "d" });
    }
    await db.provisionalProducts.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", spokenName: "kurkure", seenCount: 2, suggestedUnit: null, suggestedPricePaise: 1_000, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId: "d" });
    const { save } = await open();
    fireEvent.click(await screen.findByRole("button", { name: /From your bills/ }));
    const page = await screen.findByRole("region", { name: "From your bills" });
    const panel = within(page).getByRole("region", { name: "Prices you charged" });
    expect(panel.textContent).toContain("Sugar: ₹55 / kg on 3 bills (now ₹48)");
    const said = within(page).getByRole("region", { name: "Said, not in your items" });
    expect(said.textContent).toContain("“kurkure” — said 2 times, not in the catalog");
    expect(within(said).queryAllByRole("button")).toHaveLength(0); // provisional products are read-only (KB-320)
    expect(within(panel).getAllByRole("button")).toHaveLength(1); // Use (no Ignore writer given)
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Use ₹55 for Sugar" }));
    await waitFor(() => expect(row("Sugar").textContent).toContain("₹55"));
    expect(save).toHaveBeenCalledExactlyOnceWith(sugar.id, 5_500);
    await waitFor(() => expect(within(page).queryByRole("region", { name: "Prices you charged" })).toBeNull()); // the shop's price now matches
  });

  it("Android Back closes the Items tab (no back arrow on a tab)", async () => {
    const { onClose } = await open();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
