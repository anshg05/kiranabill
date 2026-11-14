import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// KB-411 (26 §3): the motion of the approved screens, copied from docs/design/ exactly, transform / opacity only, and all of
// it off when the phone asks for reduced motion (or the dev gallery forces it with data-motion="reduce").
const ROOT = join(__dirname, "..", "..", "..");
const css = readFileSync(join(ROOT, "src", "index.css"), "utf8");
const screens = readdirSync(join(ROOT, "docs", "design", "screens")).map((f) => readFileSync(join(ROOT, "docs", "design", "screens", f), "utf8")).join("\n");

const norm = (s: string) => s.replace(/\s+/g, "").replace(/0\./g, ".").replace(/;}/g, "}");
/** @keyframes name{...} bodies, by name. */
const keyframes = (src: string, prefix: RegExp): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    if (!prefix.test(m[1]!)) continue;
    let depth = 1, i = m.index! + m[0].length;
    for (; depth > 0; i++) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    out.set(m[1]!, norm(src.slice(m.index! + m[0].length, i - 1)));
  }
  return out;
};
const kebab = (designName: string) => "kb-" + designName.slice(2).replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase());

const ours = keyframes(css, /^kb-/);
const design = keyframes(screens, /^kb[A-Z]/);
// kbShimmer moves the same highlight with a transform instead of background-position - same look, 26 §3's rule. kbPrint is copied
// as drawn (max-height): the owner's one exception (14 Nov 2026, 26 §3).
const COPIED = [...design.keys()].filter((k) => k !== "kbShimmer");

describe("the design's motion, exactly (26 §3, docs/design/)", () => {
  it("the screens draw these animations", () => {
    expect([...design.keys()].sort()).toEqual(["kbBar", "kbBlink", "kbFloat", "kbPop", "kbPrint", "kbPulse", "kbSheet", "kbShimmer", "kbSlide", "kbSpin", "kbTwinkle", "kbUp"]);
  });

  it.each(COPIED)("%s is in index.css with the same steps", (name) => {
    expect(ours.get(kebab(name)), kebab(name)).toBe(design.get(name));
  });

  it("each animation token has the design's timing", () => {
    const timing = (name: string) => norm(new RegExp(`--animate-${name}:\\s*([^;]+);`).exec(css)?.[1] ?? "");
    expect(timing("kb-up")).toBe(norm("kb-up .6s cubic-bezier(.2,.7,.2,1) both"));
    expect(timing("kb-pulse")).toBe(norm("kb-pulse 1.9s ease-out infinite"));
    expect(timing("kb-bar")).toBe(norm("kb-bar 1.1s ease-in-out infinite"));
    expect(timing("kb-blink")).toBe(norm("kb-blink 1.2s ease-in-out infinite"));
    expect(timing("kb-float")).toBe(norm("kb-float 4.5s ease-in-out infinite"));
    expect(timing("kb-twinkle")).toBe(norm("kb-twinkle 2.6s ease-in-out infinite"));
    expect(timing("kb-shimmer")).toBe(norm("kb-shimmer 1.4s linear infinite"));
    expect(timing("kb-slide")).toBe(norm("kb-slide .45s both"));
    expect(timing("kb-pop")).toBe(norm("kb-pop .6s cubic-bezier(.2,.8,.2,1.2) both"));
    expect(timing("kb-sheet")).toBe(norm("kb-sheet .4s cubic-bezier(.2,.8,.2,1) both"));
    expect(timing("kb-fade")).toBe(norm("kb-fade .4s both")); // the sheet's backdrop (26 §3 "backdrop fades")
    expect(timing("kb-spin")).toBe(norm("kb-spin 1s linear infinite"));
    expect(timing("kb-print")).toBe(norm("kb-print 2.4s ease-out both")); // 11, the waiting screen
    expect(timing("kb-print-saved")).toBe(norm("kb-print 1.2s ease-out both")); // 13 Bill saved: 1.2 s (owner, 15 Nov 2026, 26 §3)
  });

  it("every animation moves only transform and opacity (26 §3, smooth on a cheap phone) - but the receipt print, the one exception", () => {
    for (const [name, body] of ours) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      const allowed = name === "kb-print" ? ["max-height"] : ["transform", "opacity"];
      expect(props.filter((p) => !allowed.includes(p!)), name).toEqual([]);
    }
  });

  it("the exception is written in 26 §3 (owner, 14 Nov 2026)", () => {
    const spec = readFileSync(join(ROOT, "docs", "26-DESIGN-SPEC.md"), "utf8");
    expect(spec).toMatch(/Receipt print[^\n]*only exception[^\n]*max-height/i);
  });

  it("every animation token has its keyframes", () => {
    for (const m of css.matchAll(/--animate-(kb-[\w-]+):\s*([\w-]+)/g)) expect(ours.has(m[2]!), m[1]).toBe(true);
  });
});

describe("reduced motion: everything off, end states only", () => {
  const block = (sel: RegExp) => {
    const m = sel.exec(css);
    expect(m, String(sel)).toBeTruthy();
    return css.slice(m!.index, css.indexOf("}", css.indexOf("}", m!.index) + 1) + 1);
  };

  it("the phone's setting (prefers-reduced-motion) and the gallery's switch turn off every kb animation and transition", () => {
    for (const b of [block(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\[class\*="animate-kb-"\]/), block(/:root\[data-motion="reduce"\] \[class\*="animate-kb-"\]/)]) {
      expect(b).toMatch(/animation:\s*none\s*!important/);
      expect(b).toMatch(/transition:\s*none\s*!important/);
      expect(b).toMatch(/\.kb-press/);
      expect(b).toMatch(/\.kb-tab/);
    }
  });

  it("press (26 §3: .97 in 100 ms) and the tab pill (200 ms fade) are transitions", () => {
    expect(css).toMatch(/\.kb-press\s*\{[^}]*transition:\s*transform 100ms[^}]*\}/);
    expect(css).toMatch(/\.kb-press:active\s*\{[^}]*transform:\s*scale\(\.97\)[^}]*\}/);
    expect(css).toMatch(/\.kb-tab\s*\{[^}]*transition:\s*opacity 200ms[^}]*\}/);
  });
});
