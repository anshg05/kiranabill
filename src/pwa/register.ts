import { SW_KILL_BUILD } from "./buildId";
import { createUpdater } from "./updater";
import { isUpdateSafe, onUpdateSafetyChange } from "./updateGate";

// KB-401 (docs/07-DECISIONS.md D67): registers /sw.js in a production build and feeds the update policy
// (updater.ts). Service workers do not run in the Vite dev server (nothing registers there).
//
// Recovery, per phone, no deploy needed: open /?nosw=1. The worker (if it works) serves that page from the network
// and drops its caches; this page (if the worker does not) unregisters every worker, deletes every cache, and goes
// to the plain page, which registers a fresh worker.

export const wantsReset = (search: string): boolean => new URLSearchParams(search).get("nosw") === "1";

interface ResetEnv {
  serviceWorker?: { getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]> };
  caches?: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> };
  location: { pathname: string; search: string; hash: string; replace(url: string): void };
}

/** Unregisters every worker and deletes every cache this origin holds. Never throws. */
async function clearServiceWorkers(env: Pick<ResetEnv, "serviceWorker" | "caches">): Promise<void> {
  try {
    await Promise.all((await env.serviceWorker?.getRegistrations() ?? []).map((r) => r.unregister()));
  } catch (err) {
    console.warn("[pwa] could not unregister:", err instanceof Error ? err.message : err);
  }
  try {
    const store = env.caches;
    if (store) await Promise.all((await store.keys()).map((name) => store.delete(name)));
  } catch (err) {
    console.warn("[pwa] could not clear caches:", err instanceof Error ? err.message : err);
  }
}

export async function resetServiceWorker(env: ResetEnv): Promise<void> {
  await clearServiceWorkers(env);
  const params = new URLSearchParams(env.location.search);
  params.delete("nosw");
  const rest = params.toString();
  env.location.replace(`${env.location.pathname}${rest ? `?${rest}` : ""}${env.location.hash}`);
}

function sessionGuard() {
  return {
    get: (key: string) => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key: string, value: string) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // without sessionStorage the guard is just absent
      }
    },
  };
}

/** What this page does about the worker. A KILL build clears and never registers (the tombstone reloads its pages). */
export function swPlan(env: { production: boolean; supported: boolean; search: string; killBuild: boolean }): "off" | "reset" | "clear" | "register" {
  if (!env.production || !env.supported) return "off";
  if (wantsReset(env.search)) return "reset";
  return env.killBuild ? "clear" : "register";
}

export function startServiceWorker(): void {
  const plan = swPlan({ production: import.meta.env.PROD, supported: "serviceWorker" in navigator, search: window.location.search, killBuild: SW_KILL_BUILD });
  if (plan === "off") return;
  if (plan === "reset") {
    void resetServiceWorker({ serviceWorker: navigator.serviceWorker, caches: window.caches, location: window.location });
    return;
  }
  if (plan === "clear") {
    void clearServiceWorkers({ serviceWorker: navigator.serviceWorker, caches: window.caches });
    return;
  }
  const sw = navigator.serviceWorker;
  let registration: ServiceWorkerRegistration | null = null;
  const updater = createUpdater({
    isSafe: isUpdateSafe,
    onSafetyChange: onUpdateSafetyChange,
    reload: () => window.location.reload(),
    guard: sessionGuard(),
    now: () => Date.now(),
    checkForUpdate: () => (registration ? registration.update() : Promise.resolve()),
  });
  sw.addEventListener("controllerchange", () => updater.controllerChanged());
  sw.addEventListener("message", (e) => updater.message(e.data));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updater.foreground();
  });
  const register = () => {
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        if (reg.waiting && sw.controller) updater.waitingFound(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && sw.controller) updater.waitingFound(installing);
          });
        });
      })
      .catch((err: unknown) => console.warn("[pwa] service worker not registered:", err instanceof Error ? err.message : err));
  };
  // After the page has loaded: the first paint never competes with the precache download.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
