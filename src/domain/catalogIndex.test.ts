import { describe, expect, it } from "vitest";
import { catalog, type CatalogEntry } from "./catalog";
import { buildCatalogIndex, lookupCandidates, phoneticNormalize } from "./catalogIndex";

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
  const index = buildCatalogIndex();

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

describe("catalogIndex - performance (docs/18-AGENT-CONTRACT.md section 8: under 16ms at 10,000 products)", () => {
  it("a single lookup stays under 16ms against a synthetic 10,000-product catalog", () => {
    // Vary alias text per copy, not just the id - an exact-text duplicate
    // 21x over is a pathological trigram-index case no real 10,000-product
    // catalog would produce (real catalogs have distinct product names).
    const scaled: CatalogEntry[] = [];
    const copies = Math.ceil(10_000 / catalog.length);
    for (let copy = 0; copy < copies; copy++) {
      for (const entry of catalog) {
        const suffix = copy === 0 ? "" : ` v${copy}`;
        scaled.push({
          ...entry,
          id: `${entry.id}-dup${copy}`,
          displayName: `${entry.displayName}${suffix}`,
          aliases: entry.aliases.map((alias) => `${alias}${suffix}`),
        });
      }
    }
    expect(scaled.length).toBeGreaterThanOrEqual(10_000);

    const index = buildCatalogIndex(scaled); // build is a one-time startup cost, not timed

    const queries = ["chawal", "toor daal", "wim", "besan 500 gram", "ajwain"];
    for (const query of queries) {
      const start = performance.now();
      lookupCandidates(index, query);
      const elapsedMs = performance.now() - start;
      expect(elapsedMs).toBeLessThan(16);
    }
  });
});
