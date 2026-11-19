import { isTestApp } from "@/app/testApp";

/** D115: the test app's mark on every screen - a red frame and a TEST pill, fixed above everything, never taking a tap. */
export function TestAppBanner() {
  if (!isTestApp()) return null;
  return (
    <div data-testid="test-app-banner" aria-hidden className="pointer-events-none fixed inset-0 z-[100] border-4 border-kb-err">
      <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-[6px] bg-kb-err px-3 text-kb-13 font-bold tracking-widest text-white">TEST</span>
    </div>
  );
}

/** D115: the test app, signed in with any account but the test one - nothing of a shop has been opened. Sign out is the only way on. */
export function TestAppRefused({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="min-h-screen bg-paper text-ink flex flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-kb-18 font-bold">This test app only opens the TEST account</h1>
      <p className="text-kb-14 text-kb-sub">Sign out, then sign in with the TEST Google account (second Gmail). Your real shop opens only in Kirana Voice Bill.</p>
      <button type="button" onClick={onSignOut} className="min-h-11 rounded-[6px] border border-line bg-surface px-6 font-medium">
        Sign out
      </button>
    </main>
  );
}
