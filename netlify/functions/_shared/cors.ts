// Option (b) step 3 (owner, 18 Nov 2026): who may call /voice-run from another site. Exact origins only, never "*". The Android app's
// origin is Capacitor's androidScheme + hostname (capacitor.config.ts) - the real app and the test app share it, so CORS cannot tell
// them apart; the login (verifyAccessToken + RLS) is the boundary, CORS only keeps other websites' pages out.
export const ANDROID_APP_ORIGIN = "https://localhost";
export const WEBSITE_ORIGIN = "https://kiranabilling.netlify.app";
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([ANDROID_APP_ORIGIN, WEBSITE_ORIGIN]);

/**
 * The CORS headers for this request, or null when it comes from a page on a site that may not call us. No Origin (a script) and a
 * same-origin call (the website and its drafts calling their own site) are not cross-site: they get no Allow-Origin and are not refused.
 */
export function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (origin === null || origin === new URL(req.url).origin) return { Vary: "Origin" };
  return ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : null;
}

export const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};
