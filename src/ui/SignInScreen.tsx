import { useEffect, useState } from "react";
import { FAILED_TEXT, REFUSED_TEXT, readOAuthReturn, stripOAuthReturn } from "@/data/oauthReturn";
import { useT } from "./useT";
import { useAuth } from "@/providers/AuthProvider";
import { useUpdateGate } from "@/pwa/updateGate";
import { DevEmailSignIn, isLocalSupabaseUrl } from "./DevEmailSignIn";

/** S1 (05-FRONTEND-SPEC.md): Google sign-in only. (A dev-only email form
 * appears against a LOCAL Supabase stack - DevEmailSignIn.tsx.) */
export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const { t } = useT();
  // KB-335 (D82): the marks of a refused or failed sign-in in the address bar - one plain sentence, then cleared.
  const [error, setError] = useState<string | null>(() => {
    const returned = readOAuthReturn(window.location.href);
    return returned === "refused" ? REFUSED_TEXT : returned === "failed" ? FAILED_TEXT : null;
  });
  useEffect(() => {
    const clean = stripOAuthReturn(window.location.href);
    if (clean !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", clean);
  }, []);
  useUpdateGate(true); // KB-401: nothing here to lose - a waiting update may apply

  const handleClick = () => {
    setError(null);
    signInWithGoogle().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">KiranaBill</h1>
      <button
        type="button"
        onClick={handleClick}
        className="rounded-lg bg-indigo px-6 py-3 text-white font-medium"
      >
        {t("signin.google")}
      </button>
      {error && <p role="alert" className="text-danger text-sm">{error === REFUSED_TEXT ? t("signin.refused") : error === FAILED_TEXT ? t("signin.unfinished") : error}</p>}
      {import.meta.env.DEV && isLocalSupabaseUrl(import.meta.env.VITE_SUPABASE_URL) && <DevEmailSignIn />}
    </div>
  );
}
