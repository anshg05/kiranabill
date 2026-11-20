import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./nativeSignIn";

// KB-425 (owner, 20 Nov 2026; D123): the Android app's shell - android/app/src/main/java/com/kiranavoicebill/app/AppShellPlugin.kt.
//  1. The splash: MainActivity keeps the blue splash until ready() (at most 5 s). ready() goes once the app's first REAL screen (Home,
//     Sign in, setup - anything but a holding screen) is in #root and drawn, so the cream "Loading" never shows in the app.
//  2. Permissions, one at a time: the explanation card (screen 07's words) once per install just BEFORE Android's own prompt - the mic at
//     the first Record, Nearby devices at the first Choose printer; after the action failed because Android will not ask again, Open
//     Settings.

export type PermissionKind = "microphone" | "nearby";
interface PermissionState {
  granted: boolean;
  /** Android would still show its prompt */
  canAsk: boolean;
}
interface AppShellPlugin {
  ready(): Promise<void>;
  permissionState(options: { name: PermissionKind | "scan" }): Promise<PermissionState>;
  openSettings(): Promise<void>;
  openBluetoothSettings(): Promise<void>;
}
const AppShell = registerPlugin<AppShellPlugin>("AppShell");

/** The marker a holding screen carries (App.tsx AppHolding): while it is in #root, the app is not ready. */
export const HOLDING_ATTR = "data-app-holding";

/** Calls `onReady` once: the first time `root` holds a screen that is not a holding screen, after the browser has drawn it. */
export function watchFirstScreen(root: HTMLElement, onReady: () => void, frame: (cb: () => void) => void = (cb) => requestAnimationFrame(() => requestAnimationFrame(cb))): () => void {
  let done = false;
  const check = () => {
    if (done || root.childElementCount === 0 || root.querySelector(`[${HOLDING_ATTR}]`)) return;
    done = true;
    observer.disconnect();
    frame(onReady); // two frames: the screen is painted before the splash goes
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: [HOLDING_ATTR] });
  check();
  return () => observer.disconnect();
}

/** main.tsx: inside the Android app, tell the splash when the first real screen is on. Nothing on the website. */
export function startAppShell(root: HTMLElement): void {
  if (!isNativeApp()) return;
  watchFirstScreen(root, () => void AppShell.ready().catch(() => {}));
}

// ---------------------------------------------------------------------------------------------------------------- permissions

type Sheet = "explain" | "settings";
type Choice = "allow" | "close";
let host: ((kind: PermissionKind, sheet: Sheet) => Promise<Choice>) | null = null;
/** PermissionSheetHost (src/ui/PermissionSheet.tsx) registers itself; returns the unregister. */
export function setPermissionHost(show: typeof host): () => void {
  host = show;
  return () => {
    if (host === show) host = null;
  };
}

const flagKey = (kind: PermissionKind, what: "card") => `kb.perm.${kind}.${what}.v1`;
function flag(kind: PermissionKind, what: "card"): boolean {
  try {
    return localStorage.getItem(flagKey(kind, what)) === "1";
  } catch {
    return false;
  }
}
function setFlag(kind: PermissionKind, what: "card"): void {
  try {
    localStorage.setItem(flagKey(kind, what), "1");
  } catch {
    // a phone that cannot store: the card may show again - never a crash
  }
}

async function stateOf(kind: PermissionKind | "scan"): Promise<PermissionState | null> {
  try {
    return await AppShell.permissionState({ name: kind });
  } catch {
    return null; // an older app without the plugin: today's behaviour (Android's prompt straight away)
  }
}

/**
 * Before the action that makes Android ask (Record / Choose printer). Shows the card ONCE per install when the permission is not
 * there yet; true = go on (the action asks Android itself, or simply works), false = the shopkeeper chose Not now on the card.
 * It never decides "turned off for good" (owner's phone test, 20 Nov 2026): Android grants only what an action asks for - Choose
 * printer's "connect", never the search's "scan" - so a missing part is not a refusal. Only afterRefused, after the action really
 * failed, may offer Open Settings. Outside the Android app: true.
 */
export async function beforeAsking(kind: PermissionKind): Promise<boolean> {
  if (!isNativeApp() || flag(kind, "card")) return true;
  const state = await stateOf(kind);
  if (!state || state.granted) return true;
  setFlag(kind, "card"); // once per install, whatever the answer
  return !host || (await host(kind, "explain")) === "allow";
}

/** After the action failed because Android refused: if Android will not ask again, the Open Settings sheet. */
export async function afterRefused(kind: PermissionKind): Promise<void> {
  if (!isNativeApp()) return;
  const state = await stateOf(kind);
  if (state && !state.granted && !state.canAsk) await host?.(kind, "settings");
}

export function openAppSettings(): void {
  void AppShell.openSettings().catch(() => {});
}

/**
 * KB-416 (owner, 20 Nov 2026): may Choose printer search for new printers BY ITSELF? Only when Android already allows the Bluetooth
 * search, so opening Choose printer never brings up a prompt; otherwise the search waits for the shopkeeper's tap. Outside the app,
 * or an app without the plugin: no.
 */
export async function scanAllowed(): Promise<boolean> {
  if (!isNativeApp()) return false;
  return (await stateOf("scan"))?.granted === true;
}

/** KB-416: "Not listed?" - Android's Bluetooth settings, to pair a printer. */
export function openBluetoothSettings(): void {
  void AppShell.openBluetoothSettings().catch(() => {});
}
