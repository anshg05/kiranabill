import "fake-indexeddb/auto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { KiranaBillDB } from "./db";
import { createShop, copyBaseCatalog } from "./shops";
import { pullBaseProducts, pullShopProducts } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import { parseUtterance } from "@/domain/grammar";

/**
 * KB-317 commit 2 (owner): Layer 1 reads the shop's OWN Dexie copy of
 * shop_products, made from base_products at onboarding - so an alias fix in
 * catalog-seed.json alone never reaches a shop that already exists. The alias
 * migration must update base_products AND every existing shop's base-copied
 * rows, and the change must arrive in Dexie through the ordinary pull.
 *
 * Real local stack (D21, D32): a real signUp, the real copy_base_catalog(),
 * the real pullShopProducts(). The shop is put into the PRE-migration state
 * first (the aliases a shop onboarded before this migration has), then the
 * migration file itself is run - it is idempotent, so running it again on an
 * already-migrated local database is safe. Refuses anything but localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start`).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MIGRATION_SUFFIX = "_kb317_alias_fixes.sql";

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

function migrationSql(): string {
  const dir = path.resolve(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(MIGRATION_SUFFIX));
  if (files.length !== 1) throw new Error(`expected exactly one *${MIGRATION_SUFFIX} migration, found ${files.length}`);
  return readFileSync(path.join(dir, files[0]!), "utf8");
}

describe("KB-317 alias migration reaches an EXISTING shop via sync", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-aliases-${crypto.randomUUID()}`);

  // The pre-migration aliases (catalog-seed.json before KB-317), exactly as
  // every shop onboarded before this migration has them.
  const OLD_ALIASES: Readonly<Record<string, readonly string[]>> = {
    "गेहूं": ["गेहूं", "gehun", "gehu", "wheat", "आटा", "गेहुं", "गेहू"],
    "Chakki Aata": ["Chakki Aata", "chakki aata", "chakki fresh", "chakki ka aata", "fresh aata", "पिसा आटा", "चक्की आटा", "aata", "atta", "wheat flour", "gehu atta"],
    "Toor Daal": ["Toor Daal", "daal", "dal", "dhal", "lentils", "दाल"],
    "Arhar Daal": ["Arhar Daal", "arhar daal", "tur daal", "tuvar dal", "toor dal", "pigeon pea", "अरहर दाल", "तुअर दाल", "तूर दाल"],
    "Desi Shakkar": ["Desi Shakkar", "shakkar", "desi shakkar", "khandsari", "raw sugar", "खांडसारी", "देशी शक्कर"],
    "Bath Sabun": ["Bath Sabun", "sabun", "soap", "bathing soap", "bath soap", "साबुन", "नहाने का साबुन"],
    "Sabun": ["Sabun", "Fena sabun", "Tanman sabun", "Fena", "Tanman", "Surfexcel sabun", "Wheel sabun", "फेना", "तनमन", "सर्फ एक्सेल साबुन", "व्हील साबुन", "bath sabun", "bathing sabun", "bath soap"],
  };

  async function layer1(text: string) {
    const { entries } = await loadShopCatalog(localDb, shopId);
    const item = parseUtterance(text, prepareParserCatalog(entries))?.[0];
    return item?.catalogId ? entries.find((e) => e.id === item.catalogId)?.displayName : null;
  }

  async function shopAliases(displayName: string): Promise<string[]> {
    const row = (await localDb.shopProducts.where("shopId").equals(shopId).toArray()).find((p) => p.displayName === displayName);
    if (!row) throw new Error(`no shop product "${displayName}"`);
    return row.aliases;
  }

  beforeAll(async () => {
    assertLocal();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb317.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-317 e2e", phone: null, catalogMode: "base_imported" });
    shopId = shop.id;
    await copyBaseCatalog(client, shopId, deviceId);

    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    // Put THIS shop into the pre-migration state (other shops untouched). The
    // local database may already be migrated, so copy_base_catalog() skipped
    // the now-inactive Arhar Daal: re-add it from base_products first.
    await pg.query(
      `insert into shop_products (shop_id, base_product_id, display_name, category, unit, price_paise, aliases, source, local_id, device_id)
       select $1, bp.id, bp.display_name, bp.source_category, bp.default_unit, bp.suggested_price_paise, bp.aliases, 'base', gen_random_uuid(), $2
       from base_products bp where bp.display_name = 'Arhar Daal'
         and not exists (select 1 from shop_products sp where sp.shop_id = $1 and sp.base_product_id = bp.id)`,
      [shopId, deviceId],
    );
    for (const [name, aliases] of Object.entries(OLD_ALIASES)) {
      const { rowCount } = await pg.query(
        `update shop_products set aliases = $3::jsonb, is_active = true, updated_at = now() - interval '1 day' where shop_id = $1 and display_name = $2`,
        [shopId, name, JSON.stringify(aliases)],
      );
      expect(rowCount, name).toBe(1);
    }
    // One alias the shopkeeper added themselves - the migration must keep it.
    await pg.query(`update shop_products set aliases = aliases || '["mera aata"]'::jsonb where shop_id = $1 and display_name = 'Chakki Aata'`, [shopId]);

    await pullBaseProducts(client, localDb);
    await pullShopProducts(client, localDb, shopId);
  });

  afterAll(async () => {
    await pg?.end();
  });

  it("before the migration, this shop's Layer 1 has the old aliases - एक किलो आटा -> गेहूं (the RT12 wrong line)", async () => {
    expect(await layer1("एक किलो आटा")).toBe("गेहूं");
    expect(await shopAliases("गेहूं")).toContain("आटा");
  });

  it("after the migration and an ordinary pull, the SAME shop's Dexie catalog has the fixed aliases", async () => {
    await pg.query(migrationSql());
    await pullShopProducts(client, localDb, shopId);

    expect(await layer1("एक किलो आटा")).toBe("Chakki Aata");
    expect(await layer1("साबुन 180 रुपए")).toBe("Sabun");
    expect(await layer1("2 kilo shakkar")).toBe("Chini");
    expect(await layer1("1 किलो तूर दाल")).toBe("Toor Daal");
    expect(await layer1("1 kilo arhar daal")).toBe("Toor Daal");
    expect(await layer1("आधा किलो बेशन")).toBe("Besan"); // a Whisper-spelling alias, same migration

    expect(await shopAliases("गेहूं")).not.toContain("आटा");
    expect(await shopAliases("Chakki Aata")).toEqual(expect.arrayContaining(["आटा", "mera aata"])); // the shop's own alias survives
    expect(await shopAliases("Bath Sabun")).not.toContain("साबुन");
    expect(await shopAliases("Desi Shakkar")).not.toContain("shakkar");

    // Arhar Daal: deactivated, never deleted - still in Dexie, out of Layer 1.
    const arhar = (await localDb.shopProducts.where("shopId").equals(shopId).toArray()).find((p) => p.displayName === "Arhar Daal");
    expect(arhar?.isActive).toBe(false);
    expect((await loadShopCatalog(localDb, shopId)).entries.some((e) => e.displayName === "Arhar Daal")).toBe(false);
  });

  it("base_products carries the same fix (for shops onboarded from now on)", async () => {
    const { rows } = await pg.query<{ display_name: string; aliases: string[]; is_active: boolean }>(
      `select display_name, aliases, is_active from base_products where display_name in ('गेहूं', 'Chakki Aata', 'Bath Sabun', 'Sabun', 'Arhar Daal')`,
    );
    const of = (n: string) => rows.find((r) => r.display_name === n)!.aliases;
    expect(of("गेहूं")).not.toContain("आटा");
    expect(of("Chakki Aata")).toContain("आटा");
    expect(of("Bath Sabun")).not.toContain("साबुन");
    expect(of("Sabun")).toContain("साबुन");
    expect(rows.find((r) => r.display_name === "Arhar Daal")!.is_active).toBe(false);
  });

  it("a display_name that doesn't match exactly one base_products row aborts the WHOLE migration - no silent zero-row update", async () => {
    await pg.query("begin");
    try {
      await pg.query(`update base_products set display_name = 'Chai Patti (renamed)' where display_name = 'Chai Patti'`);
      await expect(pg.query(migrationSql())).rejects.toThrow(/KB-317 alias fix: base_products display_name Chai Patti matches 0 rows/);
    } finally {
      await pg.query("rollback");
    }
  });

  it("running the migration twice changes nothing more (idempotent)", async () => {
    const before = await pg.query(`select id, aliases from shop_products where shop_id = $1 order by id`, [shopId]);
    await pg.query(migrationSql());
    const after = await pg.query(`select id, aliases from shop_products where shop_id = $1 order by id`, [shopId]);
    expect(after.rows).toEqual(before.rows);
  });
});
