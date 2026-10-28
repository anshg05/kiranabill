import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "@/data/supabaseClient";
import { DeviceDB, getActiveUserId, setActiveUserId } from "@/data/device";
import { resolveAuthMode, signOutDevice, type AuthMode } from "@/data/offlineSession";
import { markCold } from "@/ui/coldMarks";

/** KB-352: how long the cold start waits for getSession() (a token refresh over the network) before a remembered user is let in offline. */
export const AUTH_WAIT_MS = 1500;

interface AuthContextValue {
  /** The live Supabase user - null in offline-session mode (KB-315, D38). */
  user: User | null;
  session: Session | null;
  /** "online" (live session), "offline" (no network, last signed-in user from
   * this device - billing works from local data, nothing syncs) or
   * "signedOut". */
  mode: AuthMode["kind"];
  /** The user whose local database the app should open - live or offline. */
  userId: string | null;
  deviceDb: DeviceDB;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Injected in tests to avoid hitting the real Supabase client. */
  client?: SupabaseClient;
  /** Injected in tests; the app uses the one per-installation device DB. */
  deviceDb?: DeviceDB;
}

export function AuthProvider({ children, client = supabase, deviceDb: injectedDeviceDb }: AuthProviderProps) {
  const deviceDb = useMemo(() => injectedDeviceDb ?? new DeviceDB(), [injectedDeviceDb]);
  const [mode, setMode] = useState<AuthMode>({ kind: "signedOut" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // KB-315 (D38): a stored session whose refresh failed only because the
    // network is down is an OFFLINE session for the last signed-in user,
    // not a sign-out. See offlineSession.ts for the real auth-js behaviour.
    // KB-352 (owner, 28 Oct 2026): getSession() refreshes an EXPIRED access token over the network with no deadline of its own - on a slow
    // mobile network that kept the app on "Loading…" for seconds (cold start p95 28 s). A remembered user does not wait for it: after
    // AUTH_WAIT_MS the app opens in offline mode (billing runs from local data, nothing syncs), and when the answer arrives it is applied -
    // online with the new session, signed out if the refresh token was refused, or still offline if it was only the network.
    const sessionP = client.auth.getSession();
    const activeP = getActiveUserId(deviceDb);
    const apply = async (result: Awaited<typeof sessionP>, activeUserId: string | null) => {
      if (!active) return;
      const resolved = resolveAuthMode(result, activeUserId);
      if (resolved.kind === "online") await setActiveUserId(deviceDb, resolved.userId);
      if (!active) return;
      setMode(resolved);
      setLoading(false);
      markCold("auth");
    };
    const timer = setTimeout(() => {
      void activeP.then((activeUserId) => {
        if (!active || !activeUserId) return; // nobody remembered: nothing local to open - keep waiting for the real answer
        setMode((current) => (current.kind === "signedOut" ? { kind: "offline", userId: activeUserId } : current));
        setLoading(false);
        markCold("auth");
      });
    }, AUTH_WAIT_MS);
    void Promise.all([sessionP, activeP]).then(([result, activeUserId]) => {
      clearTimeout(timer);
      void apply(result, activeUserId);
    });

    const { data: subscription } = client.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      if (newSession) {
        void setActiveUserId(deviceDb, newSession.user.id);
        setMode({ kind: "online", userId: newSession.user.id, session: newSession });
        setLoading(false);
      } else if (event === "SIGNED_OUT") {
        setMode({ kind: "signedOut" });
        setLoading(false);
      }
      // Any other null-session event (e.g. INITIAL_SESSION while offline) is
      // left to the getSession() resolution above - it must not knock an
      // offline session back to the sign-in screen.
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [client, deviceDb]);

  const value: AuthContextValue = {
    user: mode.kind === "online" ? mode.session.user : null,
    session: mode.kind === "online" ? mode.session : null,
    mode: mode.kind,
    userId: mode.kind === "signedOut" ? null : mode.userId,
    deviceDb,
    loading,
    signInWithGoogle: async () => {
      // KB-309: back to THIS origin (a draft deploy, localhost), not the Site URL (the live site).
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/` } });
      if (error) throw error;
    },
    signOut: async () => {
      await signOutDevice(client, deviceDb);
      setMode({ kind: "signedOut" });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside an <AuthProvider>");
  return ctx;
}
