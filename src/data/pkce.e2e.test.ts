import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { AUTH_OPTIONS } from "./oauthReturn";

/**
 * KB-335 (D82) on the real local stack (D21, D32): the PKCE exchange the Google sign-in relies on, proven without Google.
 * A magic link uses the SAME mechanism (a one-time ?code= swapped for a session with a key kept by the client): request a
 * link with the shipped options, read the mail from the local inbox, follow the link WITHOUT following the redirect,
 * take the ?code= from where it points, exchange it. Refuses anything but localhost.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const MAIL = "http://127.0.0.1:54324"; // the local stack's inbox (Mailpit)
const BACK = "http://127.0.0.1:3000/"; // the local site URL - an allowed redirect

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
}

/** An in-memory storage - what the browser's localStorage is to the real client. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] };
};

async function linkFor(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAIL}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
      const m = /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify\?[^\s"'<>]+/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the sign-in mail never arrived in the local inbox");
}

describe("KB-335 e2e - PKCE sign-in exchange (local stack)", () => {
  it("1. the shipped client is configured for PKCE", () => {
    assertLocal();
    expect((supabase.auth as unknown as { flowType: string }).flowType).toBe("pkce");
  });

  it("2. a ?code= is exchanged for a session: the return URL carries a code, never tokens", async () => {
    assertLocal();
    const storage = memory();
    const client = createClient(url!, anonKey!, { auth: { ...AUTH_OPTIONS, storage, detectSessionInUrl: false, autoRefreshToken: false, persistSession: true } });
    const email = `pkce-${crypto.randomUUID()}@kb335.local`;
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: BACK, shouldCreateUser: true } });
    expect(error).toBeNull();
    expect(storage.keys().some((k) => k.endsWith("code-verifier") || k.includes("code-verifier"))).toBe(true); // the key stays in THIS browser

    const verify = await fetch(await linkFor(email), { redirect: "manual" });
    const back = verify.headers.get("location") ?? "";
    expect(back.startsWith(BACK)).toBe(true);
    const returned = new URL(back);
    expect(returned.searchParams.get("code")).toBeTruthy(); // ?code= in the query...
    expect(returned.hash).not.toContain("access_token"); // ...no tokens in the address bar

    const { data, error: exchange } = await client.auth.exchangeCodeForSession(returned.searchParams.get("code")!);
    expect(exchange).toBeNull();
    expect(data.session?.user.email).toBe(email);
    expect(data.session?.access_token).toBeTruthy();
  }, 60_000);

  it("3. the same code cannot be used twice, and a browser that did not start the sign-in cannot exchange it", async () => {
    assertLocal();
    const starter = createClient(url!, anonKey!, { auth: { ...AUTH_OPTIONS, storage: memory(), detectSessionInUrl: false, autoRefreshToken: false } });
    const email = `pkce-${crypto.randomUUID()}@kb335.local`;
    await starter.auth.signInWithOtp({ email, options: { emailRedirectTo: BACK, shouldCreateUser: true } });
    const code = new URL((await fetch(await linkFor(email), { redirect: "manual" })).headers.get("location") ?? "").searchParams.get("code")!;

    const other = createClient(url!, anonKey!, { auth: { ...AUTH_OPTIONS, storage: memory(), detectSessionInUrl: false, autoRefreshToken: false } }); // another browser context: no key
    const stranger = await other.auth.exchangeCodeForSession(code);
    expect(stranger.error).not.toBeNull();
    expect(stranger.data.session).toBeNull();

    const first = await starter.auth.exchangeCodeForSession(code);
    expect(first.error).toBeNull();
    const again = await starter.auth.exchangeCodeForSession(code);
    expect(again.error).not.toBeNull();
  }, 60_000);
});
