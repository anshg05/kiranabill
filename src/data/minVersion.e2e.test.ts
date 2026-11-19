import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchMinVersion } from "./minVersion";

/**
 * D116 on the REAL local stack: the app reads app_min_version with the anon key BEFORE anyone signs in (the "Please update" check runs
 * at start), a signed-in user reads the same row, and neither can change it through the API (only the owner, in the dashboard).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const local = !!url && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url.replace(/\/$/, ""));

describe.skipIf(!local)("D116 e2e - app_min_version on the local stack", () => {
  let anon: SupabaseClient;
  let signedIn: SupabaseClient;
  beforeAll(async () => {
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    signedIn = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const email = `minversion-${crypto.randomUUID()}@example.test`;
    const { error } = await signedIn.auth.signUp({ email, password: `pw-${crypto.randomUUID()}` });
    if (error) throw error;
  });
  afterAll(async () => {
    await signedIn?.auth.signOut();
  });

  it("before sign-in the app reads the android row: minimum 1, no update address", async () => {
    expect(await fetchMinVersion(anon)).toEqual({ minVersionCode: 1, updateUrl: null });
  });

  it("a signed-in user reads the same row", async () => {
    expect(await fetchMinVersion(signedIn)).toEqual({ minVersionCode: 1, updateUrl: null });
  });

  it("neither can change it through the API - the row stays 1", async () => {
    for (const c of [anon, signedIn]) {
      const up = await c.from("app_min_version").update({ min_version_code: 99 }).eq("platform", "android").select();
      expect(up.error ?? (up.data?.length === 0 ? "no row changed" : null)).toBeTruthy();
      const del = await c.from("app_min_version").delete().eq("platform", "android").select();
      expect(del.error ?? (del.data?.length === 0 ? "no row deleted" : null)).toBeTruthy();
      const ins = await c.from("app_min_version").insert({ platform: "android", min_version_code: 2 });
      expect(ins.error).toBeTruthy();
    }
    expect(await fetchMinVersion(anon)).toEqual({ minVersionCode: 1, updateUrl: null });
  });
});
