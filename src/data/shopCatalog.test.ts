import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { openShopDb, type LocalShopProduct } from "./db";
import { loadShopCatalog } from "./shopCatalog";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog } from "@/domain/catalogIndex";

function product(over: Partial<LocalShopProduct>): LocalShopProduct {
  return {
    id: crypto.randomUUID(), shopId: "shop-A", baseProductId: null, displayName: "X", category: null,
    unit: "kg", pricePaise: 1000, aliases: [], source: "custom", useCount: 0, sku: null, barcode: null, isActive: true,
    ...over,
  };
}

describe("loadShopCatalog", () => {
  it("this shop's active products at the SHOP's price, guard category from the base product; other shops excluded", async () => {
    const db = openShopDb(crypto.randomUUID());
    await db.baseProducts.put({
      id: "27", catalogVersion: 1, displayName: "Chini", sourceCategory: "SUGAR", guardCategory: "sweet",
      defaultUnit: "kg", suggestedPricePaise: 4500, aliases: ["chini"], isActive: true,
    });
    await db.shopProducts.bulkPut([
      product({ id: "p-chini", baseProductId: "27", displayName: "Chini", aliases: ["chini", "cheeni"], pricePaise: 5200, source: "base", useCount: 7 }),
      product({ id: "p-custom", displayName: "Ganesh Poha", unit: "packet", pricePaise: 3500 }),
      product({ id: "p-off", displayName: "Old Item", isActive: false }),
      product({ id: "p-other-shop", shopId: "shop-B", displayName: "Chini", pricePaise: 1 }),
    ]);

    const { entries, usageById } = await loadShopCatalog(db, "shop-A");
    expect(entries.map((e) => e.id).sort()).toEqual(["p-chini", "p-custom"]);
    expect(entries.find((e) => e.id === "p-chini")).toMatchObject({ suggestedPricePaise: 5200, guardCategory: "sweet", unit: "kg" });
    expect(entries.find((e) => e.id === "p-custom")?.guardCategory).toBe("other");
    expect(usageById["p-chini"]).toEqual({ useCount: 7 });

    // End to end with Layer 1: the shop's price and the shop's product id reach the line.
    const [line] = parseUtterance("2 kilo chini", prepareParserCatalog(entries))!;
    expect(line).toMatchObject({ catalogId: "p-chini", rate: 5200, total: 10400 });
    db.close();
  });
});
