import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createShop } from "./shops";

/**
 * KB-334 (D73, D74) built the block reservation; KB-351 (D92) retired it - the shop's numbers come from the server's counter now
 * (serverBillNumbers.e2e.test.ts has the two-phone race). What stays here is the DATABASE side: the exclusion constraint is
 * still in the schema (D55 section 5: contract in a later release) and a phone still on the old build keeps using it.
 * Real local stack (D21, D32). Refuses anything but localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start` and every migration, incl. receipt_blocks_no_overlap).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

describe("KB-334 receipt-number blocks - the database constraint (retired by KB-351 until the contract release)", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb334.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-334 e2e", phone: null, catalogMode: "custom_only" });
    shopId = shop.id;
  });

  afterAll(async () => {
    await pg?.end();
  });

  it("the database still refuses an overlapping block for the same shop (23P01) and accepts the next one - the old build on a phone that has not updated yet is safe until the contract release", async () => {
    const insert = (start: number, end: number) =>
      pg.query(
        `insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'sql-probe', $2, $3, $2)`,
        [shopId, start, end],
      );
    try {
      await insert(9001, 9050);
      await expect(insert(9025, 9075)).rejects.toMatchObject({ code: "23P01" });
      await expect(insert(9001, 9050)).rejects.toMatchObject({ code: "23P01" });
      await insert(9051, 9100); // adjacent is fine
    } finally {
      await pg.query(`delete from receipt_number_blocks where shop_id = $1 and device_id = 'sql-probe'`, [shopId]);
    }
  });
});
