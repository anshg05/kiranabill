import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { SignInScreen } from "@/ui/SignInScreen";

/**
 * Signed-in placeholder until KB-107 (onboarding) and KB-1xx (S3 billing)
 * exist. Deliberately not S2/S3 - KB-106 stops at "has a working session,"
 * not "has a shop." The temporary sign-out button here has no permanent
 * home yet either (05-FRONTEND-SPEC.md's S7 doesn't specify one) - it
 * exists only so the sign-in/sign-out loop is testable without clearing
 * browser storage by hand.
 */
function SignedInPlaceholder() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-paper text-ink font-body flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">KiranaBill</h1>
      <p>Signed in as {user?.email}</p>
      <p className="text-ink-soft text-sm">
        Onboarding (KB-107) and billing (KB-1xx) aren&apos;t built yet.
      </p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-lg border border-line px-4 py-2 text-sm"
      >
        Sign out
      </button>
    </div>
  );
}

function AuthGate() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-soft">Loading…</p>
      </div>
    );
  }

  return user ? <SignedInPlaceholder /> : <SignInScreen />;
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
