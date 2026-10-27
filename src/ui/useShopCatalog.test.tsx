// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import { noteCatalogPulled } from "@/data/catalogPullStatus";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import { useShopCatalog } from "./useShopCatalog";

// KB-350 (BLOCKS THE RELEASE): phone A changed Chini to ₹60; phone B's Catalog showed ₹60 but a NEW Chini line on B's bill
// still used ₹45 - the billing catalog was loaded once and only refreshed after THIS phone's own edits. A sync pull that
// moved shop_products / shops / learning now reloads it. Lines already on the bill keep their price.

const SHOP = "shop-1";
let n = 0;
const open = () => new KiranaBillDB(`kb350-${n++}-${crypto.randomUUID()}`);
afterEach(cleanup);

async function seedChini(db: KiranaBillDB, pricePaise: number) {
  await db.shopProducts.put({
    id: "p-chini", shopId: SHOP, baseProductId: null, displayName: "Chini", category: null, unit: "kg", pricePaise,
    aliases: ["sugar"], source: "custom", useCount: 0, sku: null, barcode: null, isActive: true,
  });
}
const priceOf = (hook: { current: { catalog: { entries: { id: string; suggestedPricePaise: number }[] } | null } }) =>
  hook.current.catalog?.entries.find((e) => e.id === "p-chini")?.suggestedPricePaise;

describe("useShopCatalog", () => {
  it("loads once, then reloads at once when a sync pull moved the catalog: the next voice line and the next Add item line use the new price, the line already billed keeps the old one", async () => {
    const db = open();
    await seedChini(db, 4500);
    const { result } = renderHook(() => useShopCatalog(db, SHOP));
    await waitFor(() => expect(priceOf(result)).toBe(4500));

    // a line already on the bill (what the parser read at ₹45)
    const before = parseUtterance("2 kilo chini", prepareParserCatalog(result.current.catalog!.entries))!;
    expect(before[0]!.rate).toBe(4500);

    // phone A's change arrives by a pull (it writes Dexie, then tells the screen)
    await db.shopProducts.update("p-chini", { pricePaise: 6000 });
    await act(async () => noteCatalogPulled(db.name));
    await waitFor(() => expect(priceOf(result)).toBe(6000));

    const after = parseUtterance("2 kilo chini", prepareParserCatalog(result.current.catalog!.entries))!;
    expect(after[0]!.rate).toBe(6000); // the next voice line
    expect(before[0]!.rate).toBe(4500); // the line already on the bill is its own copy
  });

  it("an archived or renamed product on another phone is gone / renamed here after the pull", async () => {
    const db = open();
    await seedChini(db, 4500);
    const { result } = renderHook(() => useShopCatalog(db, SHOP));
    await waitFor(() => expect(priceOf(result)).toBe(4500));
    await db.shopProducts.update("p-chini", { displayName: "Sugar loose" });
    await act(async () => noteCatalogPulled(db.name));
    await waitFor(() => expect(result.current.catalog?.entries.find((e) => e.id === "p-chini")?.displayName).toBe("Sugar loose"));
    await db.shopProducts.update("p-chini", { isActive: false });
    await act(async () => noteCatalogPulled(db.name));
    await waitFor(() => expect(priceOf(result)).toBeUndefined());
  });

  it("a pull that changed nothing keeps the very same catalog object (no parser rebuild, nothing re-rendered under a line being edited)", async () => {
    const db = open();
    await seedChini(db, 4500);
    const { result } = renderHook(() => useShopCatalog(db, SHOP));
    await waitFor(() => expect(priceOf(result)).toBe(4500));
    const first = result.current.catalog;
    await act(async () => noteCatalogPulled(db.name));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(result.current.catalog).toBe(first);
  });

  it("this phone's own edit (reload()) still reloads", async () => {
    const db = open();
    await seedChini(db, 4500);
    const { result } = renderHook(() => useShopCatalog(db, SHOP));
    await waitFor(() => expect(priceOf(result)).toBe(4500));
    await db.shopProducts.update("p-chini", { pricePaise: 5000 });
    await act(async () => result.current.reload());
    await waitFor(() => expect(priceOf(result)).toBe(5000));
  });

  it("another shop database's pull does not touch this one", async () => {
    const db = open();
    await seedChini(db, 4500);
    const { result } = renderHook(() => useShopCatalog(db, SHOP));
    await waitFor(() => expect(priceOf(result)).toBe(4500));
    await db.shopProducts.update("p-chini", { pricePaise: 6000 });
    await act(async () => noteCatalogPulled("some-other-db"));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(priceOf(result)).toBe(4500);
  });
});
