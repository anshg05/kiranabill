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

/** KB-409 (D111): where Supabase returns to inside the Android app - the one app link the app opens for (AndroidManifest.xml). */
export const NATIVE_REDIRECT = "com.kiranavoicebill.app://auth-callback";

/**
 * KB-409: the app's own path for a sign-in return link, or null when the link is not exactly ours or holds nothing to act on.
 * ANY app on the phone can send a link, so: only our scheme and host (no user, port or path), only the auth parameters, values
 * re-encoded, and always a path on the app's own origin - never an address taken from the link.
 */
export function nativeReturnPath(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const ours = new URL(NATIVE_REDIRECT);
  if (url.protocol !== ours.protocol || url.host !== ours.host) return null;
  if (url.username || url.password || url.port || (url.pathname !== "" && url.pathname !== "/")) return null;
  const from = paramsOf(url);
  const out = new URLSearchParams();
  for (const k of AUTH_PARAMS) {
    const v = from.get(k);
    if (v) out.set(k, v);
  }
  if (!["code", "error", "error_code", "error_description"].some((k) => out.has(k))) return null;
  return `/?${out.toString()}`;
}
