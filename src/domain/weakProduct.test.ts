import { describe, expect, it } from "vitest";
import type { ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import type { CatalogEntry } from "./catalog";
import { flagWeakProducts } from "./weakProduct";
import { translateEnglish } from "./messages";

// KB-368 (owner, 30 Oct 2026): a product chosen from a name that a word of is explained by NOTHING about that product is never silent.
// One general rule - no product-by-product work: MEDIUM ("Check this item", non-blocking) when the price was spoken, HIGH when the price
// came from the catalog. A27 "हारपी केक" -> Cake (he said Harpic), A35 "फॉल्चून" -> Tel Pouch (he said Fortune) are the two real cases.

const entries = SEED_PARSER_CATALOG.entries;
const item = (spokenName: string, catalogId: string | null, over: Partial<ParsedItem> = {}): ParsedItem => ({
  spokenName, catalogId, isCustom: catalogId === null, matchStatus: catalogId ? "matched" : "none",
  qty: 1, unit: "piece", rate: 6000, rateUnit: "piece", total: 6000, priceType: "rate", ...over,
});
const flagsFor = (...items: ParsedItem[]) => flagWeakProducts(items, entries);

describe("flagWeakProducts (KB-368)", () => {
  it("A27: 'हारपी केक' chosen as Cake with a SPOKEN price -> one MEDIUM 'Check this item' on that line", () => {
    const f = flagsFor(item("हारपी केक", "69"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "weak_product", severity: "MEDIUM", itemIndex: 0 });
    expect(f[0]!.message).toBe(`Check this item — heard "हारपी केक", chose "Cake".`);
  });

  it("the same weak choice with the CATALOG's price (nothing spoken backs the amount) is HIGH", () => {
    const f = flagsFor(item("हारपी केक", "69", { priceType: "default", rate: 2000, total: 2000 }));
    expect(f).toMatchObject([{ code: "weak_product", severity: "HIGH", itemIndex: 0 }]);
  });

  it("A35: 'फॉल्चून' (a word that is not Fortune's spelling in the catalog) chosen as another product is flagged", () => {
    expect(flagsFor(item("तेल पैकेट एक फॉल्चून", "335"))).toMatchObject([{ code: "weak_product" }]);
  });

  it("a mis-chosen product with a different brand is flagged: 'मदर डिलाइट तेल' -> Ruchi Gold Oil", () => {
    expect(flagsFor(item("मदर डिलाइट तेल", "335", { unit: "liter", rateUnit: "liter" }))).toMatchObject([{ code: "weak_product" }]);
  });

  it.each([
    ["Cake by its own name", "केक", "69"],
    ["Cake by an English alias", "small cake", "69"],
    ["Harpic spelled as the catalog has it", "हार्पिक", "199"],
    ["Harpic by its English name", "harpic", "199"],
    ["a product by a part of its name", "fortune", "301"],
    ["a name with a generic word added (set / packet / ek)", "एक पैकेट केक", "69"],
    ["a name with only a generic word added (सेट / पाउडर)", "केक सेट", "69"],
    ["a name with a number glued to the kilo", "2किलो fortune", "301"],
  ])("a RIGHT match is silent: %s", (_why, spoken, id) => {
    expect(flagsFor(item(spoken, id))).toEqual([]);
  });

  it("a line with no catalog product (custom) has nothing to doubt - no flag", () => {
    expect(flagsFor(item("काली मूच राइस", null))).toEqual([]);
  });

  it("an alias the shop LEARNED (a correction with the pencil, KB-336) explains the word: the repeat is silent", () => {
    const learned: CatalogEntry[] = entries.map((e) => (e.id === "199" ? { ...e, aliases: [...e.aliases, "हारपी केक"] } : e));
    expect(flagWeakProducts([item("हारपी केक", "199")], learned)).toEqual([]);
  });

  it("each line gets its own flag with its own index; only the weak one is flagged", () => {
    const f = flagsFor(item("केक", "69"), item("हारपी केक", "69"), item("हार्पिक", "199"));
    expect(f.map((x) => x.itemIndex)).toEqual([1]);
  });

  it("an unknown catalog id never throws and never flags", () => {
    expect(flagsFor(item("xyz", "does-not-exist"))).toEqual([]);
  });

  it("its sentence is translated like every other flag (Hindi and Hinglish), with both names kept", () => {
    const m = flagsFor(item("हारपी केक", "69"))[0]!.message;
    expect(translateEnglish(m, "hi")).toBe("इस सामान को देख लें — सुना “हारपी केक”, चुना “Cake”।");
    expect(translateEnglish(m, "hl")).toBe("Is saaman ko dekh lein — suna “हारपी केक”, chuna “Cake”.");
  });
});
