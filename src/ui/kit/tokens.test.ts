import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// KB-411 (D110 item 8.12, 26 §2.1): every colour of the approved design is a token, defined once in index.css's @theme as
// --color-kb-<name> (Tailwind's prefix on 26's --kb-<name>), and nothing in the kit writes a colour of its own.

const ROOT = join(__dirname, "..", "..", "..");
const spec = readFileSync(join(ROOT, "docs", "26-DESIGN-SPEC.md"), "utf8");
const css = readFileSync(join(ROOT, "src", "index.css"), "utf8");

const section = (from: string, to: string) => spec.slice(spec.indexOf(from), spec.indexOf(to));
const colourTable = section("### 2.1 Colour", "### 2.2 Typography");

/** 26 §2.1's table: token name -> hex. The splash row holds two tokens and two hexes. */
const specTokens = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const row of colourTable.split("\n").filter((l) => l.startsWith("| `--kb-"))) {
    const [names, hexes] = row.split("|").slice(1, 3);
    const n = [...names!.matchAll(/`--kb-([a-z0-9-]+)`/g)].map((m) => m[1]!);
    const h = [...hexes!.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase());
    expect(n.length, row).toBe(h.length);
    n.forEach((name, i) => out.set(name, h[i]!));
  }
  return out;
};

const themeBlock = css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("--color-kb-")) + 1);
const themeTokens = (): Map<string, string> =>
  new Map([...themeBlock.matchAll(/--color-kb-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]));

const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });

describe("colour tokens = 26 §2.1, exactly (doc and code never drift)", () => {
  it("the table has the 36 approved colours", () => {
    expect(specTokens().size).toBe(36);
  });

  it("every --kb-* colour of 26 is a --color-kb-* token in @theme with the same hex, and @theme has no other", () => {
    expect(Object.fromEntries(themeTokens())).toEqual(Object.fromEntries(specTokens()));
  });

  it("every colour written in docs/design/ is a token or one of 26's listed non-UI colours (logo, Google mark, board)", () => {
    const notUi = [...section("Not UI tokens", "Contrast rules").matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase());
    expect(notUi).toContain("#E9E6DF");
    const allowed = new Set([...specTokens().values(), ...notUi]);
    const stray: string[] = [];
    // logo-original.svg is the OLD icon kept for reference (D110 item 1), not part of the new design.
    for (const f of files(join(ROOT, "docs", "design"), /\.(html|svg)$/).filter((p) => !p.endsWith("logo-original.svg"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/#[0-9A-Fa-f]{6}\b/g)) if (!allowed.has(m[0].toUpperCase())) stray.push(`${m[0]} in ${f}`);
    }
    expect(stray).toEqual([]);
  });

  it("the kit never writes a colour of its own (hex, rgb, hsl or a named colour) - tokens only", () => {
    const kit = files(__dirname, /\.tsx?$/).filter((f) => !/\.test\.tsx?$/.test(f));
    const found = kit.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:bg|text|border|ring|fill|stroke|shadow|from|to|via)-(?:white|black|red|blue|green|gray|slate|amber|yellow)\b/g)].map((m) => `${m[0]} in ${f}`),
    );
    expect(found).toEqual([]);
  });
});

describe("the other design tokens (26 §2.2 - §2.3)", () => {
  it("the shadows of 26 §2.3 are tokens", () => {
    expect(themeBlock).toMatch(/--shadow-kb-1:\s*0 6px 16px rgba\(38, ?50, ?56, ?\.06\)/);
    expect(themeBlock).toMatch(/--shadow-kb-2:\s*0 10px 22px rgba\(38, ?50, ?56, ?\.1\d?\)/);
    expect(themeBlock).toMatch(/--shadow-kb-primary:\s*0 8px 18px rgba\(37, ?99, ?217, ?\.25\)/);
    expect(themeBlock).toMatch(/--shadow-kb-mic:\s*0 12px 26px rgba\(37, ?99, ?217, ?\.32\)/);
  });

  it("text sizes are rem tokens, so a bigger phone text size (130%) grows the text and never the layout's boxes", () => {
    const sizes = [...themeBlock.matchAll(/--text-kb-(\d+):\s*([\d.]+)rem\s*;/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(sizes.length).toBeGreaterThanOrEqual(10);
    for (const [px, rem] of sizes) expect(rem * 16, `--text-kb-${px}`).toBeCloseTo(px, 5);
    for (const px of [12, 13, 14, 15, 16, 17, 18, 26, 30, 64]) expect(sizes.map(([p]) => p)).toContain(px);
  });

  it("the new look's fonts are bundled (no font CDN), variable, and the kit's stack is 26 §2.2's", () => {
    expect(css).toContain('@import "@fontsource-variable/inter/wght.css";');
    expect(css).toContain('@import "@fontsource-variable/noto-sans-devanagari/wght.css";');
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(themeBlock).toMatch(/--font-kb:\s*"Inter Variable", "Noto Sans Devanagari Variable", sans-serif;/);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/inter"]).toBe("5.3.0"); // pinned exact (09 §B6, D110 item 8.2)
    expect(pkg.dependencies["@fontsource-variable/noto-sans-devanagari"]).toBe("5.3.0");
  });

  it("inside the kit a spacing step is a fixed 4 px, so a bigger text size grows the words and never the boxes (reviewer, 15 Nov 2026)", () => {
    expect(css).toMatch(/\.font-kb\s*\{\s*--spacing:\s*4px;\s*\}/);
    // every kit part's root carries font-kb, so the rule reaches it
    const roots = files(__dirname, /\.tsx$/).filter((f) => !/test|icons/.test(f)).map((f) => [f, readFileSync(f, "utf8")] as const);
    for (const [f, src] of roots) if (/export function/.test(src) && !/Logo\.tsx|ReceiptPaper\.tsx/.test(f)) expect(src, f).toMatch(/font-kb/);
  });

  it("the screens of today keep their own tokens and font until they move to the new look (no screen change in KB-411)", () => {
    expect(css).toMatch(/--color-indigo:\s*#2C3E7B;/);
    expect(css).toMatch(/--font-sans:\s*"Mukta", system-ui, sans-serif;/);
    expect(css).toMatch(/--font-mono:\s*"IBM Plex Mono", "Mukta", monospace;/);
  });
});
