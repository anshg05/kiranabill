// KB-401 (D67): which built files the worker precaches, and the guard that nothing else ever gets in.
// Offline open needs the shell, the JS/CSS, Mukta (all subsets - Devanagari is the app's text) and ONLY the IBM Plex
// Mono latin + latin-ext 400/600 (KB-308's note: the digits). woff fallbacks and other subsets are never requested
// by Android Chrome, so they stay online-only.

const FONT = /\.(woff2?|ttf|otf|eot)$/;
const MUKTA = /^mukta-[a-z-]+-\d+-normal-[^/]+\.woff2$/;
const PLEX = /^ibm-plex-mono-(latin|latin-ext)-(400|600)-normal-[^/]+\.woff2$/;
const STATIC = /^icons\/[^/]+\.(png|svg|ico)$/;

/** Built file paths relative to dist/ ("index.html", "assets/x.js") -> the URLs to precache, sorted. */
export function selectPrecache(files: readonly string[]): string[] {
  const urls = new Set<string>();
  for (const file of files) {
    if (file === "index.html") urls.add("/");
    else if (file === "manifest.webmanifest" || STATIC.test(file)) urls.add(`/${file}`);
    else if (file.startsWith("assets/")) {
      const name = file.slice("assets/".length);
      if (name.includes("/") || name.endsWith(".map")) continue;
      if (!FONT.test(name) || MUKTA.test(name) || PLEX.test(name)) urls.add(`/${file}`);
    }
  }
  return [...urls].sort();
}

const ALLOWED = /^\/(assets\/[^/]+|icons\/[^/]+|manifest\.webmanifest)?$/;

/** The build stops here if the list could ever hold something the worker must not: an API, a function, a dev route. */
export function assertSafePrecache(urls: readonly string[]): void {
  for (const url of urls) {
    if (!ALLOWED.test(url) || url.includes("..")) throw new Error(`service worker precache: ${url} is not an app file`);
  }
  if (!urls.includes("/")) throw new Error("service worker precache: no app shell ('/')");
  if (!urls.some((u) => u.endsWith(".js"))) throw new Error("service worker precache: no script");
}
