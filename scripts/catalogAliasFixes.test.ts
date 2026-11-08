import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import seed from "../src/domain/catalog-seed.json";
import { KB317_ALIAS_FIXES } from "./catalogAliasFixes";
import { buildAliasMigrationSql } from "./build-alias-migration";

// KB-317 (owner): the alias moves in the migration and in the seed are the
// SAME list - scripts/catalogAliasFixes.ts. No drift either way.

const products = seed as { id: string; displayName: string; aliases: string[]; isActive: boolean }[];

describe("KB-317 alias fixes - one list, no drift", () => {
  it("the committed migration is exactly what the list generates", () => {
    const dir = path.resolve(__dirname, "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith("_kb317_alias_fixes.sql"));
    expect(files).toHaveLength(1);
    expect(readFileSync(path.join(dir, files[0]!), "utf8")).toBe(buildAliasMigrationSql(KB317_ALIAS_FIXES));
  });

  it.each(KB317_ALIAS_FIXES.map((fix) => [fix.displayName, fix] as const))("catalog-seed.json carries the fix for %s", (_name, fix) => {
    const matches = products.filter((p) => p.displayName === fix.displayName);
    expect(matches).toHaveLength(1);
    const product = matches[0]!;
    for (const alias of fix.remove ?? []) expect(product.aliases).not.toContain(alias);
    for (const alias of fix.add ?? []) expect(product.aliases).toContain(alias);
    expect(product.isActive).toBe(!fix.deactivate);
  });

  it("every added alias lands on ONE active product - no new tie", () => {
    for (const fix of KB317_ALIAS_FIXES) {
      for (const alias of fix.add ?? []) {
        const holders = products.filter((p) => p.isActive && [p.displayName, ...p.aliases].some((a) => a.toLowerCase() === alias.toLowerCase()));
        expect(holders.map((p) => p.displayName), alias).toEqual([fix.displayName]);
      }
    }
  });
});

describe("KB-383 Devanagari aliases - one list, no drift, no tie (owner, 9 Nov 2026)", () => {
  it("the committed migration is exactly what the list generates", async () => {
    const { KB383_DEVANAGARI_ALIASES } = await import("./catalogAliasFixes");
    const dir = path.resolve(__dirname, "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith("_kb383_devanagari_aliases.sql"));
    expect(files).toHaveLength(1);
    expect(readFileSync(path.join(dir, files[0]!), "utf8")).toBe(buildAliasMigrationSql(KB383_DEVANAGARI_ALIASES, "-- KB-383 (owner, 9 Nov 2026): Devanagari names for the 10 seed products with none - additive alias adds only."));
  });

  it("catalog-seed.json carries every alias, each on ONE active product, and the matcher finds that product by it", async () => {
    const { KB383_DEVANAGARI_ALIASES } = await import("./catalogAliasFixes");
    const { SEED_PARSER_CATALOG } = await import("../src/domain/seedCatalog");
    const { matchProductName } = await import("../src/domain/grammar");
    expect(KB383_DEVANAGARI_ALIASES).toHaveLength(10);
    for (const fix of KB383_DEVANAGARI_ALIASES) for (const alias of fix.add ?? []) {
      const holders = products.filter((p) => p.isActive && [p.displayName, ...p.aliases].some((a) => a.toLowerCase() === alias.toLowerCase()));
      expect(holders.map((p) => p.displayName), alias).toEqual([fix.displayName]);
      const m = matchProductName(alias, SEED_PARSER_CATALOG);
      expect(m.catalogId ? SEED_PARSER_CATALOG.byId.get(m.catalogId)?.displayName : null, alias).toBe(fix.displayName);
    }
  });
});

describe("KB-383 follow-up: 'फुटाने' -> Futana (owner, 9 Nov 2026) - one list, its own additive migration", () => {
  it("the committed migration is exactly what the list generates, and the alias lands on Futana only", async () => {
    const { KB383_SPELLING_ALIASES } = await import("./catalogAliasFixes");
    const { SEED_PARSER_CATALOG } = await import("../src/domain/seedCatalog");
    const { matchProductName } = await import("../src/domain/grammar");
    const dir = path.resolve(__dirname, "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith("_kb383_futane_alias.sql"));
    expect(files).toHaveLength(1);
    expect(readFileSync(path.join(dir, files[0]!), "utf8")).toBe(buildAliasMigrationSql(KB383_SPELLING_ALIASES, "-- KB-383 follow-up (owner, 9 Nov 2026): the spelling फुटाने for Futana - an additive alias add."));
    for (const fix of KB383_SPELLING_ALIASES) for (const alias of fix.add ?? []) {
      expect(products.filter((p) => p.isActive && [p.displayName, ...p.aliases].includes(alias)).map((p) => p.displayName), alias).toEqual([fix.displayName]);
      expect(SEED_PARSER_CATALOG.byId.get(matchProductName(alias, SEED_PARSER_CATALOG).catalogId ?? "")?.displayName, alias).toBe(fix.displayName);
    }
  });
});
