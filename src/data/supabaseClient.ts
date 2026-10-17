import { createClient } from "@supabase/supabase-js";
import { AUTH_OPTIONS } from "./oauthReturn";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).",
  );
}

// KB-335 (D82): PKCE - the sign-in returns `?code=`, not tokens in the address bar.
export const supabase = createClient(url, anonKey, { auth: AUTH_OPTIONS });
