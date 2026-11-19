// Option (b) step 4 (owner, 19 Nov 2026; D115): the test app "KVB Test" (com.kiranavoicebill.app.test) - the same code, built with
// VITE_APP_VARIANT=test. It uses the production database, so it opens ONLY for the test Google account (App.tsx's AuthGate checks
// this before anything of a shop is opened, read or synced). The real app's build leaves the setting unset.

export const isTestApp = (): boolean => import.meta.env.VITE_APP_VARIANT === "test";

/** The Android package this build belongs to (build.gradle: the kvbtest flavour adds ".test"). */
export const appPackage = (): string => (isTestApp() ? "com.kiranavoicebill.app.test" : "com.kiranavoicebill.app");

/** The test Google account's Supabase user id (owner, 19 Nov 2026) - an id, not a secret. */
export const TEST_APP_USER_IDS: readonly string[] = ["77636ea8-8058-44ef-9762-76dfc47e5502"];

export const TEST_SIGN_IN_HINT = "Use the TEST Google account (second Gmail)";
