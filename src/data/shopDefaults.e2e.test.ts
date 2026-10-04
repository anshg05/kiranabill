import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createShop } from "./shops";

/**
 * KB-308 (owner, 4 Oct 2026; D57): a NEW shop's receipts are in English -
 * shops.bill_language defaults to 'en' (was 'hi'). Only the column default
 * changes; existing shops keep their value. createShop never sends
 * bill_language, so the server default decides. Local stack only.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("D57 e2e - a new shop's bill_language (local Postgres)", () => {
  it("a shop created the way onboarding creates it gets bill_language 'en'", async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@d57.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "D57 default", phone: null, catalogMode: "custom_only" });
    const { data: row, error: readError } = await client.from("shops").select("bill_language").eq("id", shop.id).single();
    if (readError) throw new Error(readError.message);
    expect(row).toEqual({ bill_language: "en" });
  }, 30_000);
});
