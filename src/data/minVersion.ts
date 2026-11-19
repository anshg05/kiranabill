import type { SupabaseClient } from "@supabase/supabase-js";

// D116 (owner, 19 Nov 2026): the minimum app version (Supabase app_min_version, one row per platform - only 'android'). Readable
// BEFORE sign-in; nobody writes it from the app. The bundled Android app compares it with its own versionCode (appVersion.ts).

export interface MinVersion {
  readonly minVersionCode: number;
  /** Where "Please update"'s Update button goes; null = no address yet ("Ask for the new version"). */
  readonly updateUrl: string | null;
}

/** Reads the android row. Throws on any error or a malformed row - the caller then keeps the last value it saw. */
export async function fetchMinVersion(client: SupabaseClient, signal?: AbortSignal): Promise<MinVersion> {
  let query = client.from("app_min_version").select("min_version_code, update_url").eq("platform", "android");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`app_min_version: ${error.message}`);
  const row = data as { min_version_code: unknown; update_url: unknown } | null;
  if (!row || !Number.isInteger(row.min_version_code) || (row.min_version_code as number) < 1) throw new Error("app_min_version: no valid android row");
  const url = typeof row.update_url === "string" && row.update_url.startsWith("https://") ? row.update_url : null;
  return { minVersionCode: row.min_version_code as number, updateUrl: url };
}
