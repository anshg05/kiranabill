/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetKeyCache, verifyAccessToken } from "./jwt";

/**
 * KB-353 (D94): the verifier against REAL tokens - the local stack signs with ES256 and publishes its key, exactly as the
 * hosted project does, so a token it issues must verify and a tampered or wrong-project one must not. Local only.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-353 verifyAccessToken - the real local stack", () => {
  it("a token the stack issued verifies to its user; a flipped payload, another project's URL, and the anon key do not", async () => {
    expect(url && /^http:\/\/(127\.0\.0\.1|localhost)/.test(url)).toBe(true);
    resetKeyCache();
    const c = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.signUp({ email: `e2e-jwt-${crypto.randomUUID()}@kb353.local`, password: crypto.randomUUID() });
    if (error || !data.session || !data.user) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const token = data.session.access_token;

    expect(await verifyAccessToken(`Bearer ${token}`, url!)).toEqual({ userId: data.user.id });

    const [h, p, s] = token.split(".") as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, sub: crypto.randomUUID() })).toString("base64url")}.${s}`;
    expect(await verifyAccessToken(`Bearer ${forged}`, url!)).toBeNull();

    expect(await verifyAccessToken(`Bearer ${token}`, "http://127.0.0.1:1")).toBeNull(); // the issuer is not that project
    expect(await verifyAccessToken(`Bearer ${anonKey}`, url!)).toBeNull(); // the anon key is not a user's token
    expect(await verifyAccessToken(`Bearer ${token}`, url!, { nowS: () => payload.exp + 61 })).toBeNull(); // expired
  });
});
