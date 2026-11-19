import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { ShopProvider, useShop } from "@/providers/ShopProvider";
import { useEffect, useState } from "react";
import { buildMatchesPackage, isNativeApp } from "@/data/nativeSignIn";
import { SignedOutFlow, markWelcomed } from "@/ui/WelcomeScreens";
import { OnboardingScreen } from "@/ui/OnboardingScreen";
import { BillingScreen } from "@/ui/BillingScreen";
import { useT } from "@/ui/useT";
import { TestAppBanner, TestAppRefused, WrongBuild } from "@/ui/TestAppBanner";
import { TEST_APP_USER_IDS, isTestApp } from "@/data/testApp";
import { VersionGateProvider, useVersionGate } from "@/ui/VersionGate";
import { PleaseUpdate } from "@/ui/PleaseUpdate";

/** KB-301: online, no cached shop, and the shop lookup failed. Retry, never
 * onboarding - onboarding here could create a second shop (12-PARKED.md KI-42). */
function ShopLoadError() {
  const { retry } = useShop();
  const { t } = useT();
  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col items-center justify-center gap-4 px-4">
      <p>{t("app.serverDown")}</p>
      <button
        type="button"
        onClick={retry}
        className="min-h-11 rounded-[6px] border border-line bg-surface px-6 font-medium"
      >
        {t("retry.button")}
      </button>
    </div>
  );
}

/** The Auth {Signed in?} -> HasShop? branch from 16-APP-FLOW.md's nav map. */
export function ShopGate() {
  const { loading, shop, loadError, localDb } = useShop();
  const { t } = useT();
  // D116: below the minimum version - INSIDE the shop loader, so the sync loop keeps uploading behind the screen
  if (useVersionGate().blocked) return <PleaseUpdate localDb={localDb} />;

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-soft">{t("app.loading")}</p>
      </div>
    );
  }

  if (loadError) return <ShopLoadError />;
  return shop ? <BillingScreen /> : <OnboardingScreen />;
}

function AuthGate() {
  // KB-315: userId is the live user OR, offline, the last signed-in user on
  // this device (D38) - the app runs from their local database either way.
  const { loading, userId, mode, deviceDb, signOut } = useAuth();
  const { t } = useT();
  const { blocked } = useVersionGate();
  // KB-415: someone signed in on this phone has been welcomed - an update to this version never shows them the splash after a sign-out
  useEffect(() => {
    if (userId) markWelcomed();
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-soft">{t("app.loading")}</p>
      </div>
    );
  }

  // KB-415: signed out -> the splash and onboarding once per install, then Sign in (WelcomeScreens.tsx)
  if (!userId) return blocked ? <PleaseUpdate localDb={null} /> : <SignedOutFlow />; // D116: signed out, nothing to upload
  // D115: the test app uses the production database - only the test account gets past here. Checked BEFORE ShopProvider, so for any
  // other account (the owner's real one) no phone database is opened, no shop read, nothing pulled, no sync started.
  if (isTestApp() && !TEST_APP_USER_IDS.includes(userId)) return <TestAppRefused onSignOut={() => void signOut()} />;

  return (
    <ShopProvider userId={userId} online={mode === "online"} deviceDb={deviceDb}>
      <ShopGate />
    </ShopProvider>
  );
}

export function App() {
  // D115: inside the Android app nothing starts (no sign-in, no shop) until this bundle is known to belong to its package.
  const [build, setBuild] = useState<"checking" | "ok" | "wrong">(() => (isNativeApp() ? "checking" : "ok"));
  useEffect(() => {
    if (build === "checking") void buildMatchesPackage().then((ok) => setBuild(ok ? "ok" : "wrong"));
  }, [build]);
  if (build === "checking") return null;
  if (build === "wrong") return <WrongBuild />;
  return (
    <VersionGateProvider>
      <AuthProvider>
        <AuthGate />
        <TestAppBanner />
      </AuthProvider>
    </VersionGateProvider>
  );
}
