import { isNativeApp } from "@/data/nativeSignIn";

/** D91: the public privacy-policy page (Google's consent screen and Play link to it). */
export const PRIVACY_PAGE_URL = "https://kiranabilling.netlify.app/privacy";

/**
 * Option (b) step 3 (owner, 18 Nov 2026): the bundled app's own address is https://localhost, where "/privacy" is the app itself (the
 * rewrite exists only on Netlify) - so the app links to the public page, which Capacitor opens in the phone's browser.
 */
export const privacyHref = (): string => (isNativeApp() ? PRIVACY_PAGE_URL : "/privacy");
