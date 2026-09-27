import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { ShopProvider, useShop } from "@/providers/ShopProvider";
import { SignInScreen } from "@/ui/SignInScreen";
import { OnboardingScreen } from "@/ui/OnboardingScreen";
import { BillingScreen } from "@/ui/BillingScreen";

/** KB-301: online, no cached shop, and the shop lookup failed. Retry, never
 * onboarding - onboarding here could create a second shop (12-PARKED.md KI-42). */
function ShopLoadError() {
  const { retry } = useShop();
  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col items-center justify-center gap-4 px-4">
      <p>Server se connect nahi ho paaya</p>
      <button
        type="button"
        onClick={retry}
        className="min-h-11 rounded-[6px] border border-line bg-surface px-6 font-medium"
      >
        Retry
      </button>
    </div>
  );
}

/** The Auth {Signed in?} -> HasShop? branch from 16-APP-FLOW.md's nav map. */
export function ShopGate() {
  const { loading, shop, loadError } = useShop();

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-soft">Loading…</p>
      </div>
    );
  }

  if (loadError) return <ShopLoadError />;
  return shop ? <BillingScreen /> : <OnboardingScreen />;
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
