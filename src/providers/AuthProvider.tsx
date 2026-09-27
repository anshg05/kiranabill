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
    Promise.all([client.auth.getSession(), getActiveUserId(deviceDb)]).then(async ([result, activeUserId]) => {
      if (!active) return;
      const resolved = resolveAuthMode(result, activeUserId);
      if (resolved.kind === "online") await setActiveUserId(deviceDb, resolved.userId);
      if (!active) return;
      setMode(resolved);
      setLoading(false);
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
      const { error } = await client.auth.signInWithOAuth({ provider: "google" });
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
