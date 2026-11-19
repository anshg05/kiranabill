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
