// KB-346 (D90): which phone is this - only what the app has to do differently. Both functions take what they read as
// arguments (tests pass fakes); the defaults read the browser.

type NavLike = { userAgent: string; maxTouchPoints?: number };

/** An iPhone, an iPod or an iPad - an iPad (iPadOS 13+) calls itself a Mac, with a touch screen. Every iOS browser is WebKit. */
export function isIos(nav: NavLike = navigator): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Installed to the Home Screen: Safari says so with navigator.standalone, other browsers with the display-mode query. */
export function isStandalone(
  nav: { standalone?: boolean } = navigator as { standalone?: boolean },
  matches: (query: string) => boolean = (q) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches,
): boolean {
  return nav.standalone === true || matches("(display-mode: standalone)");
}
