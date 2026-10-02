import { describe, expect, it } from "vitest";
import { buildCatalogIndex, buildCatalogSlice, lookupCandidates, phoneticNormalize, prepareParserCatalog, searchCatalog } from "./catalogIndex";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { catalog } from "./catalog";

describe("phoneticNormalize", () => {
  it("ph -> f", () => {
    expect(phoneticNormalize("Phortune")).toBe("fortune");
  });

  it("w -> v", () => {
    expect(phoneticNormalize("Wim")).toBe("vim");
  });

  it("both rules together", () => {
    expect(phoneticNormalize("Phawan")).toBe("favan");
  });
});

describe("lookupCandidates - exact and phonetic matches", () => {
  const index = buildCatalogIndex(catalog);

  it("an exact alias scores 1.0", () => {
    const candidates = lookupCandidates(index, "chawal");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.score).toBe(1);
    expect(candidates[0]!.catalogId).toBe("11");
  });

  it("phonetic variant 'wim' still reaches Vim (id 195) - docs/14-LEGACY-REFERENCE.md section 6", () => {
    const candidates = lookupCandidates(index, "wim");
    const vim = candidates.find((c) => c.catalogId === "195");
    expect(vim).toBeDefined();
    expect(vim!.score).toBe(1); // "wim" normalizes to "vim", an exact match
  });

  it("an unrelated query returns low- or no-scoring candidates for a real product", () => {
    const candidates = lookupCandidates(index, "xyzzy nonsense product");
    const chawal = candidates.find((c) => c.catalogId === "11");
    expect(chawal === undefined || chawal.score < 0.5).toBe(true);
  });

  it("candidates are ranked best-first", () => {
    const candidates = lookupCandidates(index, "chini");
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.score).toBeLessThanOrEqual(candidates[i - 1]!.score);
    }
  });
});

// KB-302: the Layer 2 catalog slice (docs/04-VOICE-PIPELINE.md section 4 -
// top ~30 relevant products, from the SHOP's catalog).
describe("buildCatalogSlice", () => {
  it("every product spoken in a multi-item transcript is in the slice; at most 30", () => {
    const slice = buildCatalogSlice(SEED_PARSER_CATALOG, "do kilo chini, teen parle g das wala aur ek kilo besan");
    const ids = slice.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["27", "52", "4"])); // Chini, Parle-G 10, Besan
    expect(slice.length).toBeLessThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("a long transcript is still capped at the limit", () => {
    const words = SEED_PARSER_CATALOG.entries.slice(0, 80).map((e) => e.displayName).join(" aur ");
    expect(buildCatalogSlice(SEED_PARSER_CATALOG, words)).toHaveLength(30);
    expect(buildCatalogSlice(SEED_PARSER_CATALOG, words, 5)).toHaveLength(5);
  });

  it("nothing recognisable -> an empty slice (Gemini still returns unknown lines)", () => {
    expect(buildCatalogSlice(SEED_PARSER_CATALOG, "   ")).toEqual([]);
  });
});

// KB-305: the add-item type-ahead (05 S3a) - over the SHOP's catalog, Roman
// and Devanagari alike; the shopkeeper picks, so nothing here guesses a brand.
describe("searchCatalog (KB-305 type-ahead)", () => {
  const names = (q: string, usage = {}) => searchCatalog(SEED_PARSER_CATALOG, q, usage).map((r) => r.entry.displayName);

  it.each([
    ["chini", "Chini"],
    ["cheeni", "Chini"],
    ["चीनी", "Chini"],
    ["शक्कर", "Chini"],
    ["aata", "Chakki Aata"], // the generic first, brands after (KI-47 / KI-52: nothing guessed)
    ["आटा", "Chakki Aata"],
    ["sabun", "Sabun"],
    ["साबुन", "Sabun"],
    ["parle", "Parle-G 10"],
  ])("%s -> %s first", (query, first) => {
    expect(names(query)[0]).toBe(first);
  });

  it("at most 8 results", () => {
    expect(names("dal").length).toBeLessThanOrEqual(8);
    expect(names("dal").length).toBeGreaterThan(1);
  });

  it("a single Roman letter is noise ('c' ranked Dahi first) - nothing until 2 characters; 'ची' (2) searches", () => {
    expect(names("c")).toEqual([]);
    expect(names(" c ")).toEqual([]);
    expect(names("ची")).toContain("Chini");
  });

  it("each result carries the alias that matched (shown when it isn't the name)", () => {
    const [top] = searchCatalog(SEED_PARSER_CATALOG, "cheeni");
    expect(top!.alias).toBe("cheeni");
  });

  it("an inactive product never appears - even from a catalog that still holds it (Arhar Daal, id 17)", () => {
    const withInactive = prepareParserCatalog(catalog); // the FULL seed, incl. isActive: false
    expect(catalog.find((e) => e.id === "17")).toMatchObject({ displayName: "Arhar Daal", isActive: false });
    for (const q of ["arhar", "Arhar Daal", "अरहर"]) {
      expect(searchCatalog(withInactive, q).map((r) => r.entry.id)).not.toContain("17");
      expect(searchCatalog(SEED_PARSER_CATALOG, q).map((r) => r.entry.id)).not.toContain("17");
    }
  });

  it("an equal score is broken by the shop's own use count, then by name", () => {
    // "surf": Surf Excel and Washing Powder both score 1.00 (both carry the alias).
    const wp = catalog.find((e) => e.displayName === "Washing Powder")!.id;
    expect(names("surf").slice(0, 2)).toEqual(["Surf Excel", "Washing Powder"]);
    expect(names("surf", { [wp]: { useCount: 7 } }).slice(0, 2)).toEqual(["Washing Powder", "Surf Excel"]);
  });
});
