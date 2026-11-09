import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createShop } from "../../../src/data/shops";
import { runCleanup, supabaseDeps } from "./cleanup";

/**
 * KB-384a step 5 (owner, 9 Nov 2026; D105, D107) on the REAL local Docker stack: real uploads through the Storage API, aged in the
 * database, then the deletion exactly as the Edge Function runs it (cleanup.ts's supabaseDeps with the SERVICE ROLE client) - files
 * removed through the Storage API, then their rows. Billed 6 days ago stays, 8 days ago goes; unbilled 8 days after upload goes, 6 stays;
 * a file with no row goes after 7 days. Refuses anything but localhost.
 */

const url = process.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("KB-384a e2e - the 7-day deletion on the local stack", () => {
  let user: SupabaseClient;
  let service: SupabaseClient;
  let shopId: string;
  let pg: Client;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Refusing to run: not the local stack");
    // The LOCAL stack's service-role key (the CLI's default for local development) - read, never printed.
    const serviceKey = /^SERVICE_ROLE_KEY="?([^"\r\n]+)"?$/m.exec(execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))?.[1];
    if (!serviceKey) throw new Error("could not read the local service-role key from `supabase status`");
    service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await user.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb384a-clean.local`, password: crypto.randomUUID() });
    if (error || !data.user) throw new Error(`local signUp failed: ${error?.message}`);
    shopId = (await createShop(user, { ownerUserId: data.user.id, name: "KB-384a cleanup e2e", phone: null, catalogMode: "custom_only" })).id;
  }, 60_000);
  afterAll(async () => {
    await pg?.end();
  });

  /** A real upload + row, then aged with the DATABASE clock (triggers off for the test, so billed_at keeps the past date). */
  async function recording(opts: { billedDaysAgo?: number; uploadedDaysAgo: number; row?: boolean }): Promise<{ rec: string; path: string }> {
    const rec = crypto.randomUUID();
    const path = `${shopId}/${rec}`;
    const up = await user.storage.from("recordings").upload(path, new Uint8Array([26, 69, 223, 163, 1]), { contentType: "audio/webm" });
    if (up.error) throw new Error(up.error.message);
    await pg.query("update storage.objects set created_at = now() - make_interval(days => $2) where bucket_id = 'recordings' and name = $1", [path, opts.uploadedDaysAgo]);
    if (opts.row !== false) {
      await user.from("voice_recordings").insert({ recording_id: rec, shop_id: shopId, mime: "audio/webm" });
      await pg.query("begin");
      await pg.query("set local session_replication_role = replica");
      await pg.query(
        "update voice_recordings set created_at = now() - make_interval(days => $2), billed_at = case when $3::int is null then null else now() - make_interval(days => $3::int) end where recording_id = $1",
        [rec, opts.uploadedDaysAgo, opts.billedDaysAgo ?? null],
      );
      await pg.query("commit");
    }
    return { rec, path };
  }
  const fileExists = async (path: string) => (await service.storage.from("recordings").download(path)).data !== null;
  const objectRow = async (path: string) => (await pg.query("select 1 from storage.objects where bucket_id = 'recordings' and name = $1", [path])).rowCount;
  const rowExists = async (rec: string) => (await pg.query("select 1 from voice_recordings where recording_id = $1", [rec])).rowCount === 1;

  it("billed 6 days ago stays; billed 8 days ago goes; unbilled 8 days after upload goes, 6 days stays; a file with no row goes after 7 days", async () => {
    const billed6 = await recording({ billedDaysAgo: 6, uploadedDaysAgo: 9 }); // uploaded long ago, but billed recently: the bill's clock counts
    const billed8 = await recording({ billedDaysAgo: 8, uploadedDaysAgo: 8 });
    const unbilled8 = await recording({ uploadedDaysAgo: 8 });
    const unbilled6 = await recording({ uploadedDaysAgo: 6 });
    const orphan8 = await recording({ uploadedDaysAgo: 8, row: false });
    const orphan1 = await recording({ uploadedDaysAgo: 1, row: false });
    for (const r of [billed6, billed8, unbilled8, unbilled6, orphan8, orphan1]) expect(await fileExists(r.path)).toBe(true);

    const result = await runCleanup(supabaseDeps(service as never));
    expect(result.failedBatches).toBe(0);
    expect(result.files).toBeGreaterThanOrEqual(3);

    // gone: the FILE (Storage API download fails, its storage.objects row is gone) and the row
    for (const r of [billed8, unbilled8]) {
      expect(await fileExists(r.path)).toBe(false);
      expect(await objectRow(r.path)).toBe(0);
      expect(await rowExists(r.rec)).toBe(false);
    }
    expect(await fileExists(orphan8.path)).toBe(false);
    // kept
    for (const r of [billed6, unbilled6]) {
      expect(await fileExists(r.path)).toBe(true);
      expect(await rowExists(r.rec)).toBe(true);
    }
    expect(await fileExists(orphan1.path)).toBe(true);

    // a second run the same day finds none of these
    const again = await (supabaseDeps(service as never)).due();
    for (const r of [billed6, billed8, unbilled8, unbilled6, orphan8, orphan1]) expect(again.map((d) => d.path)).not.toContain(r.path);
  }, 120_000);
});
