import { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";

/** S1 (05-FRONTEND-SPEC.md): Google sign-in only. */
export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    signInWithGoogle().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="min-h-screen bg-paper text-ink font-body flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">KiranaBill</h1>
      <button
        type="button"
        onClick={handleClick}
        className="rounded-lg bg-indigo px-6 py-3 text-white font-medium"
      >
        Sign in with Google
      </button>
      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  );
}
