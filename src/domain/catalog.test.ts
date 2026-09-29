import { describe, it, expect } from "vitest";
import { catalog, getCatalogEntryById, type GuardCategory } from "./catalog";

const VALID_GUARD_CATEGORIES: readonly GuardCategory[] = [
  "dal",
  "oil",
  "masala",
  "tea",
  "grain",
  "soap",
  "hygiene",
  "dairy",
  "snack",
  "sweet",
  "beverage",
  "condiment",
  "dryfruit",
  "household",
  "medicine",
  "other",
];

// Deliberately structural, not value-based: 04-VOICE-PIPELINE.md section 8
// documents the exact bug that comes from hardcoding a catalog value in a
// test fixture ("VC001 expects chini at ₹43, catalog says ₹45") - the
// fixture went stale and nobody noticed. These tests assert invariants that
// stay true regardless of what any individual product's name or price is.

describe("catalog seed", () => {
  it("loads all 482 products (docs/14-LEGACY-REFERENCE.md section 9)", () => {
    expect(catalog.length).toBe(482);
  });

  it("has a unique id for every product", () => {
    const ids = catalog.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices every product as a POSITIVE integer number of paise", () => {
    // Not >= 0: a zero-price product would silently produce a free line item -
    // exactly the invisible-money-bug class this product exists to prevent.
    for (const product of catalog) {
      expect(Number.isInteger(product.suggestedPricePaise)).toBe(true);
      expect(product.suggestedPricePaise).toBeGreaterThan(0);
    }
  });

  it("assigns a non-empty sourceCategory to every product", () => {
    for (const product of catalog) {
      expect(product.sourceCategory.trim().length).toBeGreaterThan(0);
    }
  });

  it("assigns one of the sixteen valid guardCategory values to every product", () => {
    for (const product of catalog) {
      expect(VALID_GUARD_CATEGORIES).toContain(product.guardCategory);
    }
  });

  it("has at least one product in each of the fifteen real guard buckets (not everything fell into 'other')", () => {
    const seen = new Set(catalog.map((product) => product.guardCategory));
    for (const bucket of VALID_GUARD_CATEGORIES) {
      if (bucket === "other") continue;
      expect(seen.has(bucket)).toBe(true);
    }
  });

  it("keeps 'other' under 10% of the catalog (docs/07-DECISIONS.md D12) - a mishearing of two 'other' products has no guard to reject it", () => {
    const otherCount = catalog.filter((product) => product.guardCategory === "other").length;
    expect(otherCount / catalog.length).toBeLessThan(0.1);
  });

  it("gives every product at least one non-empty alias", () => {
    for (const product of catalog) {
      expect(product.aliases.length).toBeGreaterThan(0);
      for (const alias of product.aliases) {
        expect(alias.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every product a non-empty display name and unit", () => {
    for (const product of catalog) {
      expect(product.displayName.trim().length).toBeGreaterThan(0);
      expect(product.unit.trim().length).toBeGreaterThan(0);
    }
  });

  // KB-317 (owner): Arhar Daal is deactivated - toor = arhar, Toor Daal only.
  it("marks every seeded product active, except the ones KB-317 deactivated", () => {
    for (const product of catalog) {
      expect(product.isActive, product.displayName).toBe(product.id !== "17");
    }
  });

  it("has no duplicate alias within a single product's alias list", () => {
    for (const product of catalog) {
      expect(new Set(product.aliases).size).toBe(product.aliases.length);
    }
  });

  it("looks up a product by id", () => {
    const first = catalog[0]!;
    expect(getCatalogEntryById(first.id)).toEqual(first);
  });

  it("returns undefined for an id that doesn't exist", () => {
    expect(getCatalogEntryById("does-not-exist")).toBeUndefined();
  });
});

// KB-317 commit 2 - the owner's alias rulings (29 Sep 2026), asserted on the
// seed itself. The same moves reach base_products and every existing shop's
// shop_products through a migration (catalogAliases.e2e.test.ts).
describe("KB-317 alias rulings - each spoken word lands on ONE product", () => {
  const aliasesOf = (id: string) => (getCatalogEntryById(id)?.aliases ?? []).map((a) => a.toLowerCase());
  const holders = (alias: string) =>
    catalog.filter((e) => [e.displayName, ...e.aliases].some((a) => a.toLowerCase() === alias.toLowerCase())).map((e) => e.id);

  it.each([
    ["आटा", "2"], // Chakki Aata, never गेहूं (1)
    ["साबुन", "614"], // generic Sabun, never Bath Sabun (160)
    ["sabun", "614"],
    ["शक्कर", "27"], // Chini; Desi Shakkar (32) only as "देशी शक्कर"
    ["shakkar", "27"],
    ["दाल", "16"], // generic dal = Toor Daal
    ["तूर दाल", "16"], // toor = arhar, one pulse (owner) - was on Arhar Daal (17)
    ["तुअर दाल", "16"],
    ["toor dal", "16"],
    ["tur daal", "16"],
    ["tuvar dal", "16"],
    ["अरहर दाल", "16"],
  ])("%s -> only catalog id %s", (alias, id) => {
    expect(aliasesOf(id)).toContain(alias.toLowerCase());
    expect(holders(alias)).toEqual([id]);
  });

  it("Desi Shakkar keeps its own name, Bath Sabun its own", () => {
    expect(holders("देशी शक्कर")).toEqual(["32"]);
    expect(holders("नहाने का साबुन")).toEqual(["160"]);
    expect(holders("bath soap")).toContain("160");
  });
});
