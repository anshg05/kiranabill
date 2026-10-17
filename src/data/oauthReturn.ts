// KB-335 (docs/07-DECISIONS.md D82): the Google sign-in return. The client uses the PKCE flow: the return is
// `/?code=...` (a one-time code swapped for a session, key kept in this browser) instead of the implicit flow's
// `/#access_token=...`. auth-js leaves the marks of a REFUSED or FAILED return in the address bar (and, when the sign-in
// was started in another browser context, a `?code=` it cannot exchange) - the sign-in screen reads them, says one plain
// sentence and clears them. Never the server's own words: an error description can hold an email address.

/** Passed to createClient (supabaseClient.ts). */
export const AUTH_OPTIONS = { flowType: "pkce" } as const;

export const REFUSED_TEXT = "This account isn't set up for the pilot";
export const FAILED_TEXT = "Sign-in didn't finish — tap Sign in with Google again";

const AUTH_PARAMS = ["code", "sb_flow_id", "error", "error_code", "error_description"] as const;

function paramsOf(url: URL): URLSearchParams {
  const merged = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  url.searchParams.forEach((v, k) => merged.set(k, v)); // the query wins, as in auth-js
  return merged;
}

/** "refused" = sign-ups are off and this account was not created; "failed" = anything else that went wrong; null = nothing to say. */
export function readOAuthReturn(href: string): "refused" | "failed" | null {
  const p = paramsOf(new URL(href));
  const error = p.get("error");
  const errorCode = p.get("error_code");
  const description = p.get("error_description") ?? "";
  if (errorCode === "signup_disabled" || /sign-?ups? not allowed/i.test(description)) return "refused";
  if (error === "access_denied" && !errorCode) return null; // Cancel on Google's page
  if (error || errorCode || description || p.get("code")) return "failed";
  return null;
}

/** The address without the auth parameters (path + query + fragment), for history.replaceState. */
export function stripOAuthReturn(href: string): string {
  const url = new URL(href);
  for (const k of AUTH_PARAMS) url.searchParams.delete(k);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  for (const k of AUTH_PARAMS) hash.delete(k);
  const h = hash.toString();
  return `${url.pathname}${url.search}${h ? `#${h}` : ""}`;
}
