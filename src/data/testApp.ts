// Option (b) step 4 (owner, 19 Nov 2026; D115): the test app "KVB Test" (com.kiranavoicebill.app.test) - the same code, built with
// VITE_APP_VARIANT=test. It uses the production database, so it opens ONLY for the test Google account (App.tsx's AuthGate checks
// this before anything of a shop is opened, read or synced). The real app's build leaves the setting unset.

export const isTestApp = (): boolean => import.meta.env.VITE_APP_VARIANT === "test";

// D117 (owner, 19 Nov 2026): each test-only value tests the build setting INLINE (import.meta.env.VITE_APP_VARIANT === "test"), so a
// production build - where Vite writes the setting as a constant - folds the test branch away and its strings never reach the real
// app's bundle (scripts/checkReleaseApk.ts proves it on the APK). Functions, not constants, so tests can switch the setting.

/** The Android package this build belongs to (build.gradle: the kvbtest flavour adds ".test"). */
export const appPackage = (): string => (import.meta.env.VITE_APP_VARIANT === "test" ? "com.kiranavoicebill.app.test" : "com.kiranavoicebill.app");

/** The test Google account's Supabase user id (owner, 19 Nov 2026) - an id, not a secret. None in the real app. */
export const testAppUserIds = (): readonly string[] => (import.meta.env.VITE_APP_VARIANT === "test" ? ["77636ea8-8058-44ef-9762-76dfc47e5502"] : []);

export const testSignInHint = (): string => (import.meta.env.VITE_APP_VARIANT === "test" ? "Use the TEST Google account (second Gmail)" : "");
