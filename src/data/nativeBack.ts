import { App } from "@capacitor/app";
import { isNativeApp } from "./nativeSignIn";

/**
 * KB-406: Android Back inside the app. @capacitor/app 8.1.2 swallows Back when the web view cannot go back, so the main screen's Back
 * did nothing (owner, 13 Nov 2026). With something open, Back goes back (useBackEntry closes that layer, "Discard changes?" included);
 * on the main screen the app goes to the background like any Android 12+ app - never killed, so a draft bill stays.
 */
export function startNativeBack(): void {
  if (!isNativeApp()) return;
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
}
