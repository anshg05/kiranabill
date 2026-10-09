import type { SupabaseClient } from "@supabase/supabase-js";
import { nameKey } from "@/domain/catalogImport";
import { deterministicUuid } from "@/domain/ids";
import type { KiranaBillDB } from "./db";
import { pullShopProducts } from "./sync";

// KB-314 (docs/07-DECISIONS.md D68): bulk catalog import. Like every catalog write (KB-311, D62) it goes ONLINE to
// Postgres and the ordinary pull brings the products into Dexie - shop_products is a pull-only cache (03 section 0).
// The rows were previewed and confirmed (domain/catalogImport.ts); this only ADDS them (source 'custom') - an existing
// name is never touched, so a re-run adds nothing.
//
// Batches of 200: ONE insert statement each, so a batch is all-or-nothing. A batch that fails with a unique violation
// (23505 - a name the server has and this phone had not pulled) is sorted out row by row after a pull. Any other
// failure stops the import there (the rest are "not sent") - the run can simply be repeated: what is already in is
// skipped. Only codes are logged, never product names.

export const IMPORT_BATCH = 200;
const UNIQUE_VIOLATION = "23505";

export interface ImportRow {
  name: string;
  pricePaise: number;
  unit: string;
  category: string | null;
  aliases: string[];
  sku: string | null;
  barcode: string | null;
}

export interface ImportOutcome {
  added: number;
  /** Names that turned out to be in the shop already (another phone added them) - skipped, not changed. */
  alreadyThere: number;
  /** Rows the server refused one by one after a unique-violation retry. */
  failed: { name: string; reason: string }[];
  /** Rows never sent because the import stopped. */
  notSent: number;
  stopReason: string | null;
}

export async function importProducts(
  client: SupabaseClient,
  localDb: KiranaBillDB,
  shopId: string,
  deviceId: string,
  rows: readonly ImportRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const out: ImportOutcome = { added: 0, alreadyThere: 0, failed: [], notSent: 0, stopReason: null };
  const record = (r: ImportRow) => ({
    shop_id: shopId,
    display_name: r.name,
    category: r.category,
    unit: r.unit,
    price_paise: r.pricePaise,
    aliases: r.aliases,
    source: "custom",
    sku: r.sku,
    barcode: r.barcode,
    // the same name is always the same id: a repeated insert can only be refused, never doubled
    local_id: deterministicUuid("catalog-import", shopId, nameKey(r.name)),
    device_id: deviceId,
  });

  let done = 0;
  for (let start = 0; start < rows.length; start += IMPORT_BATCH) {
    const batch = rows.slice(start, start + IMPORT_BATCH);
    const { error } = await client.from("shop_products").insert(batch.map(record));
    if (!error) {
      out.added += batch.length;
    } else if (error.code === UNIQUE_VIOLATION) {
      await pullQuietly(client, localDb, shopId);
      const have = new Set((await localDb.shopProducts.where("shopId").equals(shopId).toArray()).map((p) => nameKey(p.displayName)));
      for (const r of batch) {
        if (have.has(nameKey(r.name))) {
          out.alreadyThere += 1;
          continue;
        }
        const one = await client.from("shop_products").insert(record(r));
        if (!one.error) out.added += 1;
        else if (one.error.code === UNIQUE_VIOLATION) out.alreadyThere += 1;
        else out.failed.push({ name: r.name, reason: one.error.code || "error" });
      }
    } else {
      console.warn(`[import] stopped at row ${start + 1}: ${error.code || "error"}`);
      out.notSent = rows.length - start;
      out.stopReason = `${error.code || "network error"}: ${error.message}`;
      break;
    }
    done = Math.min(start + batch.length, rows.length);
    onProgress?.(done, rows.length);
  }
  await pullQuietly(client, localDb, shopId);
  return out;
}

async function pullQuietly(client: SupabaseClient, localDb: KiranaBillDB, shopId: string): Promise<void> {
  try {
    await pullShopProducts(client, localDb, shopId);
  } catch (err) {
    console.warn("[import] pull failed (the products are saved on the server):", err instanceof Error ? err.message : err);
  }
}
