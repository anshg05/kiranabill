import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog";
import { changeProduct, editRate, isEdited } from "./billEdit";
import { amountNeeded } from "./finalBill";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-336 (D83): change a line's product. The line keeps its quantity; a price the shopkeeper SAID stays; only a
// catalog-derived rate follows the new product (or "Price needed" when it has none); an incompatible unit clears the
// quantity ("Quantity needed"); nothing is ever invented (hard rules 1, 5, 7). Pure.

const entry = (over: Partial<CatalogEntry> & Pick<CatalogEntry, "id" | "displayName" | "unit" | "suggestedPricePaise">): CatalogEntry => ({
  aliases: [over.displayName], isActive: true, sourceCategory: "", guardCategory: "other", ...over,
});
const besan = entry({ id: "besan", displayName: "Besan", unit: "kg", suggestedPricePaise: 9_500 });
const nameless = entry({ id: "free", displayName: "Free Gift", unit: "piece", suggestedPricePaise: 0 });
const piece = entry({ id: "biscuit", displayName: "Biscuit", unit: "piece", suggestedPricePaise: 1_000 });
const line = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG)![0]!;
const ok = (r: ReturnType<typeof changeProduct>) => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};

describe("changeProduct - the product, the quantity, the catalog price", () => {
  it("a catalog-priced line: the quantity and unit stay, the rate and total follow the NEW product", () => {
    const item = ok(changeProduct(line("2 kilo chini"), besan));
    expect(item).toMatchObject({ catalogId: "besan", qty: 2, unit: "kg", rate: 9_500, rateUnit: "kg", total: 19_000, priceType: "default", isCustom: false, matchStatus: "matched" });
  });
  it("what was heard stays as heard (it is what learning teaches); only the product changes", () => {
    expect(ok(changeProduct(line("2 kilo chini"), besan)).spokenName).toBe("chini");
  });
  it("a compatible unit keeps its own unit and the quantity number: 500 gm of a per-kg product", () => {
    const item = ok(changeProduct(line("500 gram chini"), besan));
    expect(item).toMatchObject({ qty: 500, unit: "gm", rate: 9_500, rateUnit: "kg", total: 4_750 });
  });
  it("the same product again changes nothing", () => {
    const original = line("2 kilo chini");
    expect(ok(changeProduct(original, SEED_PARSER_CATALOG.byId.get(original.catalogId!)!))).toEqual(original);
  });
});

describe("a price the shopkeeper said stays (owner, 17 Oct 2026)", () => {
  it("a rate typed or said stays - the product's catalog price does not replace it", () => {
    const said = ok(editRate(line("2 kilo chini"), "52")); // ₹52/kg, priceType rate
    const item = ok(changeProduct(said, besan));
    expect(item).toMatchObject({ catalogId: "besan", rate: 5_200, rateUnit: "kg", total: 10_400, priceType: "rate" });
  });
  it("a spoken total stays: '5 kg chawal 30 ka' keeps ₹30", () => {
    const spoken = parseUtterance("5 kg chawal 30 ka", SEED_PARSER_CATALOG)![0]!;
    expect(spoken.priceType).toBe("total");
    expect(ok(changeProduct(spoken, besan))).toMatchObject({ catalogId: "besan", total: 3_000, rate: null, priceType: "total", qty: 5 });
  });
});

describe("units that do not fit: the quantity is cleared, never converted", () => {
  const packets = () => parseUtterance("2 packet maggi", SEED_PARSER_CATALOG)![0]!;
  it("2 packets onto a per-kg product: the unit becomes the product's, the quantity is cleared - 'Quantity needed'", () => {
    const item = ok(changeProduct(packets(), besan));
    expect(item).toMatchObject({ catalogId: "besan", qty: null, unit: "kg", total: null });
    expect(amountNeeded(item)).toBe("quantity");
  });
  it("a rate said per the OLD unit cannot price the new one: it follows the catalog (or 'Price needed'); a spoken total stays", () => {
    const said = ok(editRate(packets(), "12")); // ₹12 per packet, said
    const moved = ok(changeProduct(said, besan));
    expect(moved).toMatchObject({ qty: null, unit: "kg", rate: 9_500, rateUnit: "kg", priceType: "default" });
    const free = ok(changeProduct(said, entry({ id: "n", displayName: "N", unit: "kg", suggestedPricePaise: 0 })));
    expect(free).toMatchObject({ qty: null, rate: null, total: null, priceType: "unknown" });
    expect(amountNeeded(free)).toBe("price");
  });
  it("KB-338 (D86): a line with no unit (an unknown product) fits every product - its qty and its '—' unit stay; the catalog price applies as a plain number ('Quantity needed' while there is no qty)", () => {
    const unknown = { ...line("2 kilo chini"), catalogId: null, isCustom: true, matchStatus: "none" as const, qty: null, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown" as const };
    const item = ok(changeProduct(unknown, piece));
    expect(item).toMatchObject({ catalogId: "biscuit", qty: null, unit: "", rate: 1_000, rateUnit: "", priceType: "default" });
    expect(amountNeeded(item)).toBe("quantity");
  });
});

describe("no price in the catalog: 'Price needed', never a guess", () => {
  it("a catalog-priced line moved to a product with no price has no rate and no total", () => {
    const item = ok(changeProduct(line("2 piece parle jee"), nameless));
    expect(item).toMatchObject({ qty: 2, unit: "piece", rate: null, rateUnit: null, total: null, priceType: "unknown" });
    expect(amountNeeded(item)).toBe("price");
  });
});

describe("isEdited counts a product change (owner decision 5)", () => {
  it("a changed product is an edit; the same product is not; undoing it (back to the first product) is not", () => {
    const original = line("2 kilo chini");
    const moved = ok(changeProduct(original, besan));
    expect(isEdited(moved, original)).toBe(true);
    expect(isEdited(original, original)).toBe(false);
    const sameNumbers = ok(changeProduct(original, entry({ id: "twin", displayName: "Twin", unit: "kg", suggestedPricePaise: original.rate! })));
    expect(sameNumbers).toMatchObject({ qty: original.qty, unit: original.unit, total: original.total }); // only the product differs...
    expect(isEdited(sameNumbers, original)).toBe(true); // ...and that alone is an edit
    expect(isEdited(ok(changeProduct(moved, SEED_PARSER_CATALOG.byId.get(original.catalogId!)!)), original)).toBe(false);
  });
});
