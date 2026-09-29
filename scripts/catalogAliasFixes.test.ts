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
