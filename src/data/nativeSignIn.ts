import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NATIVE_REDIRECT, nativeReturnPath } from "./oauthReturn";

// KB-409 (D111): Google sign-in inside the Android app. Google refuses sign-in in an app's own web view, so the Google page opens
// in a Chrome Custom Tab and Supabase returns to the app link (NATIVE_REDIRECT). The link is turned into the WEB return
// (/?code=...) on the app's own origin, so auth-js exchanges the code with the PKCE key in this web view, exactly as on the web (D82).

/** True inside the Android app; false in a browser and in the installed PWA. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** How long the sign-in button waits before coming back by itself, when the phone never says the Custom Tab closed. */
export const SIGN_IN_WAIT_MS = 60_000;

// One sign-in = one PKCE key (KB-342). auth-js 2.116 exchanges a returning code with the key of the NEWEST start, so a second
// start would orphan a Custom Tab that is still open. A second tap therefore reopens the SAME address until the page reloads
// (a completed or failed return always reloads it).
let pendingUrl: string | null = null;

/** Tests only. */
export function resetNativeSignIn(): void {
  pendingUrl = null;
}

/**
 * Opens Google in a Custom Tab. Resolves "returned" when the attempt is over WITHOUT a sign-in so far - the tab was closed, or the
 * app is in front again (MIUI does not always report the tab closing), or SIGN_IN_WAIT_MS passed - so the button can come back.
 * A return link arriving later is still handled: watchNativeReturn does not depend on this promise.
 */
export async function startNativeSignIn(client: SupabaseClient): Promise<"returned"> {
  if (!pendingUrl) {
    const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
    if (error) throw error;
    if (!data.url) throw new Error("sign-in: no address to open");
    pendingUrl = data.url;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: () => void = () => {};
  const over = new Promise<void>((resolve) => (finish = resolve));
  const handles = [
    App.addListener("appStateChange", (state) => {
      if (state.isActive) finish();
    }),
    Browser.addListener("browserFinished", () => finish()),
  ];
  try {
    await Promise.all(handles);
    timer = setTimeout(finish, SIGN_IN_WAIT_MS);
    await Browser.open({ url: pendingUrl });
    await over;
  } finally {
    clearTimeout(timer);
    for (const handle of handles) void handle.then((h) => h.remove()).catch(() => {});
  }
  return "returned";
}

const HANDLED_KEY = "kb.nativeReturn.handled";

/**
 * Listens for the sign-in's return link - while the app is open, and the one that LAUNCHED it (Android may have closed the app
 * behind the Custom Tab). Each link is acted on once, remembered across reloads: the launch link is still reported after the page
 * reloads onto /?code=..., and acting on it again would reload forever. Returns the function that stops listening.
 */
export function watchNativeReturn(go: (path: string) => void = (path) => window.location.replace(path)): () => void {
  let live = true;
  const handle = (link: string | undefined) => {
    if (!live || !link) return;
    const path = nativeReturnPath(link);
    if (!path) return;
    try {
      if (localStorage.getItem(HANDLED_KEY) === link) return;
      localStorage.setItem(HANDLED_KEY, link);
    } catch {
      return; // cannot remember it: one unfinished sign-in is better than a reload loop
    }
    go(path);
  };
  const listener = App.addListener("appUrlOpen", (event) => handle(event.url));
  void App.getLaunchUrl().then((launch) => handle(launch?.url)).catch(() => {});
  return () => {
    live = false;
    void listener.then((h) => h.remove()).catch(() => {});
  };
}
