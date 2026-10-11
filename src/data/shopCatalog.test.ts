import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { openShopDb, type LocalShopProduct } from "./db";
import { loadShopCatalog } from "./shopCatalog";
import { parseUtterance } from "@/domain/grammar";
import { buildCatalogSlice, prepareParserCatalog, searchCatalog } from "@/domain/catalogIndex";
import { buildVocabularyPrompt } from "@/domain/vocabulary";

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

// KB-330 (D71): an ARCHIVED product (is_active = false) leaves everything that reads the shop catalog - Layer 1, the
// Layer 2 slice, Add item / Catalog search and the Whisper vocabulary - even a heavily used one with distinctive aliases.
describe("an archived product is gone from every consumer of the billing catalog (KB-330)", () => {
  it("not matched by Layer 1, not in the slice, not found by search, not in the vocabulary", async () => {
    const db = openShopDb(crypto.randomUUID());
    await db.shopProducts.bulkPut([
      product({ id: "p-live", displayName: "Lux Soap", aliases: ["lux sabun"], useCount: 3 }),
      product({ id: "p-arch", displayName: "Purana Bhandar", aliases: ["purana sabun", "bhandar wala"], useCount: 50, isActive: false }),
    ]);
    const { entries, usageById } = await loadShopCatalog(db, "shop-A");
    expect(entries.map((e) => e.id)).toEqual(["p-live"]);
    expect(usageById["p-arch"]).toBeUndefined();

    const pc = prepareParserCatalog(entries);
    expect(parseUtterance("2 purana sabun", pc)?.some((i) => i.catalogId === "p-arch") ?? false).toBe(false);
    expect(parseUtterance("2 kilo lux sabun", pc)![0]).toMatchObject({ catalogId: "p-live" });
    expect(buildCatalogSlice(pc, "purana bhandar wala sabun").map((e) => e.id)).not.toContain("p-arch");
    expect(searchCatalog(pc, "purana", usageById, 8).map((r) => r.entry.id)).toEqual([]);
    expect(buildVocabularyPrompt(entries, usageById).names).not.toContain("Purana Bhandar");
    db.close();
  });
});
