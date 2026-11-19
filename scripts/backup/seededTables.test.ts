import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEEDED_PUBLIC_TABLES } from "./rehearseRestore";

// D116 (owner, 19 Nov 2026): a restore applies every migration to an empty database, then loads the backed-up rows. A public table a
// migration SEEDS (a top-level INSERT) is in the backup too, so the load would meet its own rows - a duplicate key that stopped the
// rehearsal (app_min_version, 19 Nov 2026). Every seeded table must be cleared before the load: this keeps the list equal to the
// migrations, so the next seeded table cannot break restores again. (Inserts inside functions run later, not at migration time.)

const DIR = path.join(__dirname, "..", "..", "supabase", "migrations");

function seededPublicTables(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql"))) {
    for (const m of readFileSync(path.join(DIR, f), "utf8").matchAll(/^insert into\s+("?[\w.]+"?)/gim)) {
      const name = m[1]!.replace(/"/g, "").toLowerCase();
      if (name.includes(".") && !name.startsWith("public.")) continue; // storage.buckets etc.: not in the public data dump
      out.add(name.startsWith("public.") ? name : `public.${name}`);
    }
  }
  return [...out].sort();
}

describe("the restore's clear-before-load list", () => {
  it("equals every public table a migration seeds", () => {
    expect(seededPublicTables()).toEqual(["public.app_min_version", "public.base_products"]);
    expect([...SEEDED_PUBLIC_TABLES].sort()).toEqual(seededPublicTables());
  });
});
