import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createShop } from "./shops";

/**
 * KB-384a step 2 (D107) on the real local stack, through the real Storage and PostgREST APIs (what the phone and the worker use):
 * a recording goes to the PRIVATE `recordings` bucket at {shop_id}/{recording_id}; its row is claimed ONCE; another shop can neither
 * download nor see it; a second upload of the same recording never overwrites the first. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function shopUser(label: string): Promise<{ client: SupabaseClient; shopId: string }> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  // Generated test credentials for the LOCAL stack only - never printed.
  const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb384a.local`, password: crypto.randomUUID() });
  if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
  const shopId = (await createShop(client, { ownerUserId: data.user.id, name: `KB-384a e2e ${label}`, phone: null, catalogMode: "custom_only" })).id;
  return { client, shopId };
}

describe("KB-384a e2e - recordings bucket + voice_recordings (local stack)", () => {
  let a: Awaited<ReturnType<typeof shopUser>>;
  let b: Awaited<ReturnType<typeof shopUser>>;
  let pg: Client;
  const audio = new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4]);

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    a = await shopUser("A");
    b = await shopUser("B");
  }, 60_000);
  afterAll(async () => {
    // No client may delete a recording, so the test removes its own objects' rows directly (local stack only) - the KB-407 backup
    // e2e refuses a dump while Storage holds files it cannot back up.
    if (pg && a && b) {
      await pg.query("begin");
      await pg.query("select set_config('storage.allow_delete_query', 'true', true)");
      await pg.query("delete from storage.objects where bucket_id = 'recordings' and (storage.foldername(name))[1] in ($1, $2)", [a.shopId, b.shopId]);
      await pg.query("commit");
    }
    await pg?.end();
  });

  const upload = (who: typeof a, path: string, body: Uint8Array | Blob = audio, contentType = "audio/webm") => who.client.storage.from("recordings").upload(path, body, { contentType, upsert: false });

  it("1. upload -> row -> claim once -> the worker (as the user) downloads the same bytes and stores the answer", async () => {
    const rec = crypto.randomUUID();
    expect((await upload(a, `${a.shopId}/${rec}`)).error).toBeNull();
    expect((await a.client.from("voice_recordings").insert({ recording_id: rec, shop_id: a.shopId, mime: "audio/webm" })).error).toBeNull();
    const first = await a.client.rpc("claim_voice_recording", { p_recording_id: rec });
    const second = await a.client.rpc("claim_voice_recording", { p_recording_id: rec });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject([{ status: "running", attempts: 1, path: `${a.shopId}/${rec}`, mime: "audio/webm" }]);
    expect(second.data).toEqual([]); // a double tap / retry: no second Gemini call
    const down = await a.client.storage.from("recordings").download(`${a.shopId}/${rec}`);
    expect(new Uint8Array(await down.data!.arrayBuffer())).toEqual(audio);
    const done = await a.client.rpc("finish_voice_recording", { p_recording_id: rec, p_attempt: 1, p_status: "done", p_transcript: "दो किलो चीनी", p_items: [], p_usage: {}, p_model: "gemini-3.8-flash", p_error: null });
    expect(done.data).toBe(true);
    expect((await a.client.from("voice_recordings").select("status, transcript").eq("recording_id", rec)).data).toEqual([{ status: "done", transcript: "दो किलो चीनी" }]);
    expect((await a.client.from("voice_recordings").update({ status: "queued" }).eq("recording_id", rec)).error).not.toBeNull(); // no direct status write
    expect((await a.client.rpc("claim_voice_recording", { p_recording_id: rec })).data).toEqual([]);
  }, 60_000);

  it("2. a second upload of the SAME recording is refused - the first is never overwritten", async () => {
    const rec = crypto.randomUUID();
    expect((await upload(a, `${a.shopId}/${rec}`)).error).toBeNull();
    expect((await upload(a, `${a.shopId}/${rec}`, new Uint8Array([9, 9, 9]))).error).not.toBeNull();
    expect((await a.client.storage.from("recordings").upload(`${a.shopId}/${rec}`, new Uint8Array([9]), { contentType: "audio/webm", upsert: true })).error).not.toBeNull();
    const down = await a.client.storage.from("recordings").download(`${a.shopId}/${rec}`);
    expect(new Uint8Array(await down.data!.arrayBuffer())).toEqual(audio);
  }, 60_000);

  it("3. shop B can neither download, list, see nor claim shop A's recording - and cannot upload into A's folder", async () => {
    const rec = crypto.randomUUID();
    await upload(a, `${a.shopId}/${rec}`);
    await a.client.from("voice_recordings").insert({ recording_id: rec, shop_id: a.shopId, mime: "audio/webm" });
    expect((await b.client.storage.from("recordings").download(`${a.shopId}/${rec}`)).data).toBeNull();
    expect((await b.client.storage.from("recordings").list(a.shopId)).data ?? []).toEqual([]);
    expect((await b.client.from("voice_recordings").select("recording_id").eq("recording_id", rec)).data).toEqual([]);
    expect((await b.client.rpc("claim_voice_recording", { p_recording_id: rec })).data).toEqual([]);
    expect((await upload(b, `${a.shopId}/${crypto.randomUUID()}`)).error).not.toBeNull();
    expect((await pg.query("select status from voice_recordings where recording_id = $1", [rec])).rows).toEqual([{ status: "queued" }]);
  }, 60_000);

  it("4. the bucket takes audio only, 10 MB at most, and a signed-out caller gets nothing", async () => {
    expect((await upload(a, `${a.shopId}/${crypto.randomUUID()}`, audio, "text/html")).error).not.toBeNull();
    expect((await upload(a, `${a.shopId}/${crypto.randomUUID()}`, new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "audio/webm" }))).error).not.toBeNull();
    const rec = crypto.randomUUID();
    await upload(a, `${a.shopId}/${rec}`);
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.storage.from("recordings").download(`${a.shopId}/${rec}`)).data).toBeNull();
  }, 60_000);
});
