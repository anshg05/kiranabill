import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { ShopProvider, useShop } from "@/providers/ShopProvider";
import { SignInScreen } from "@/ui/SignInScreen";
import { OnboardingScreen } from "@/ui/OnboardingScreen";

/**
 * Signed-in-with-a-shop placeholder until KB-1xx (S3 billing) exists.
 * The temporary sign-out button here has no permanent home yet either
 * (05-FRONTEND-SPEC.md's S7 doesn't specify one) - it exists only so the
 * sign-in/sign-out loop is testable without clearing browser storage by
 * hand.
 */
function HasShopPlaceholder() {
  const { user, signOut } = useAuth();
  const { shop } = useShop();

  return (
    <div className="min-h-screen bg-paper text-ink font-body flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">KiranaBill</h1>
      <p>Signed in as {user?.email}</p>
      <p>Shop: {shop?.name}</p>
      <p className="text-ink-soft text-sm">Billing (KB-1xx) isn&apos;t built yet.</p>
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

/** The Auth {Signed in?} -> HasShop? branch from 16-APP-FLOW.md's nav map. */
function ShopGate() {
  const { loading, shop } = useShop();

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-soft">Loading…</p>
      </div>
    );
  }

  return shop ? <HasShopPlaceholder /> : <OnboardingScreen />;
}

function AuthGate() {
  // KB-315: userId is the live user OR, offline, the last signed-in user on
  // this device (D38) - the app runs from their local database either way.
  const { loading, userId, mode, deviceDb } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-soft">Loading…</p>
      </div>
    );
  }

  if (!userId) return <SignInScreen />;

  return (
    <ShopProvider userId={userId} online={mode === "online"} deviceDb={deviceDb}>
      <ShopGate />
    </ShopProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
