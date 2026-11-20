import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// sharp is NOT a dependency of this app: it is already installed under node_modules by netlify-cli (devDependency) -> @netlify/images
// -> ipx -> sharp (0.34.5 on 20 Nov 2026). KB-425 (owner, 20 Nov 2026): commit the script, add no dependency. If a netlify-cli update
// ever drops it, run `npx --yes sharp-cli` or install sharp in a scratch folder - never add it to package.json for this.
import sharp from "sharp";

/**
 * KB-425 (D123): remakes every app icon and the splash icon from the design's two logos (docs/design, 26 §4) - run after a logo change:
 *   npx tsx scripts/makeIcons.ts
 * - the adaptive icon: foreground (the bill + the mic badge, no tile) and monochrome (an outline for Android 13+ themed icons) on the
 *   colour @color/ic_launcher_background (#2563D9; KVB Test keeps its red - android/app/src/kvbtest);
 * - the legacy square and round icons (Android 7.x), the Android 12 splash icon (the light logo), and the Play listing icon.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "android", "app", "src", "main", "res");
const BLUE = "#2563D9";
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;

const logo = (name: string) => readFileSync(join(ROOT, "docs", "design", name), "utf8");
/** The logo's drawing without its outer <svg> and without the first shape (the rounded tile). */
export function content(svg: string): string {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return inner.replace(/^\s*<rect [^>]*\/>/, "");
}

/** The themed-icon outline: every shape one colour, the bill and the badge drawn as outlines so the marks and the mic stay visible. */
export function monochrome(drawing: string): string {
  return drawing
    .replace(/fill="#1F4FA3" stroke="#1F4FA3"/, 'fill="none" stroke="#FFFFFF"') // the bill's outline
    .replace(/<polygon ([^>]*)fill="#FFFFFF"\/>/, "") // the bill's white paper: transparent
    .replace(/<circle cx="322" cy="160" r="87" [^>]*\/>/, "") // the badge's ring in the tile colour
    .replace(/<circle cx="322" cy="160" r="78" fill="#FFC72C"\/>/, '<circle cx="322" cy="160" r="74" fill="none" stroke="#FFFFFF" stroke-width="10"/>')
    .replace(/#263238|#1F3A75/g, "#FFFFFF")
    // the badge sits ON the bill: cut a hole for it in the bill (its centre and radius after the badge group's scale 1.1 about 256,256)
    .replace(/<g transform="translate\(256 256\) rotate\(-7\)[^>]*>[\s\S]*?<\/g>/, (bill) => `<g mask="url(#badgeHole)">${bill}</g>`)
    .replace(/^/, '<defs><mask id="badgeHole" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/><circle cx="328.6" cy="150.4" r="96" fill="#000"/></mask></defs>');
}

const svg = (viewBox: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}">${body}</svg>`;
/** 512-unit drawing placed in a box of `size` units, centred in a `canvas`. */
const placed = (drawing: string, canvas: number, size: number) => `<g transform="translate(${(canvas - size) / 2} ${(canvas - size) / 2}) scale(${size / 512})">${drawing}</g>`;

async function png(file: string, source: string, px: number): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(source), { density: 72 * Math.max(1, px / 108) }).resize(px, px).png().toFile(file);
}

async function main(): Promise<void> {
  const blue = logo("logo-blue2.svg");
  const drawing = content(blue);
  const light = logo("logo-light.svg");
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${d}`);
    // adaptive layers: 108 dp, the drawing's 512-unit tile in the central 72 dp (Android's visible area; the drawing sits inside 66 dp)
    await png(join(dir, "ic_launcher_foreground.png"), svg(108, placed(drawing, 108, 72)), 108 * k);
    await png(join(dir, "ic_launcher_monochrome.png"), svg(108, placed(monochrome(drawing), 108, 72)), 108 * k);
    // legacy (Android 7.x): the whole logo; the round one is the drawing on a blue circle
    await png(join(dir, "ic_launcher.png"), blue, 48 * k);
    await png(join(dir, "ic_launcher_round.png"), svg(512, `<circle cx="256" cy="256" r="256" fill="${BLUE}"/>${placed(drawing, 512, 400)}`), 48 * k);
    // Android 12 splash icon: 288 dp with no icon background, shown inside a 192 dp circle - the light logo's tile (132 dp) fits whole
    await png(join(RES, `drawable-${d}`, "splash_icon.png"), svg(288, placed(light.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""), 288, 132)), 288 * k);
  }
  // the Play listing icon: 512 x 512, full square (Play rounds it)
  await png(join(ROOT, "docs", "play", "icon-512.png"), blue.replace(/rx="112" /, ""), 512);
  console.log("icons written");
}

if (process.argv[1]?.endsWith("makeIcons.ts")) void main();
