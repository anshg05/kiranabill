import { useState, type FormEvent } from "react";
import { supabase } from "@/data/supabaseClient";

// DEV ONLY (owner, 27 Sep 2026, KB-301). The local Supabase stack has no
// Google provider (supabase/config.toml has no [auth.external.google]), so
// the owner's browser check signs in with email + password against the LOCAL
// stack's Auth, which allows email signup without confirmation. SignInScreen
// renders this only when import.meta.env.DEV AND the Supabase URL is
// localhost/127.0.0.1 - never against the remote project. `npm run build`
// drops it (VERIFY greps dist/ for the heading text).

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export function DevEmailSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (mode: "signIn" | "signUp") => async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    // AuthProvider's onAuthStateChange picks up the new session.
    const { error: err } =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (err) setError(err.message);
  };

  return (
    <form onSubmit={run("signIn")} className="flex w-full max-w-sm flex-col gap-2 rounded-[6px] border border-line p-4">
      <p className="text-[13px] font-medium text-ink-soft">Dev sign-in (local Supabase only)</p>
      <input
        type="email"
        autoComplete="off"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-h-11 rounded-[6px] border border-line px-3"
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="min-h-11 rounded-[6px] border border-line px-3"
      />
      <div className="flex gap-2">
        <button type="submit" className="min-h-11 flex-1 rounded-[6px] border border-line bg-surface font-medium">
          Sign in
        </button>
        <button
          type="button"
          onClick={() => void run("signUp")()}
          className="min-h-11 flex-1 rounded-[6px] border border-line bg-surface font-medium"
        >
          Create account
        </button>
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
    </form>
  );
}
