import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// KB-308 (owner review): ₹ (U+20B9) is on every receipt. Plex Mono's Latin
// subset doesn't have it - the latin-ext file does - so the imported faces
// must declare a unicode-range that covers it, for both receipt weights, or
// every ₹ falls back to Mukta beside Plex digits.

const RUPEE = 0x20b9;

function plexFaces() {
  const css = readFileSync(resolve("src/index.css"), "utf8");
  const imports = [...css.matchAll(/@import\s+"(@fontsource\/ibm-plex-mono\/[^"]+)"/g)].map((m) => m[1]!);
  return imports.flatMap((spec) => {
    const file = readFileSync(resolve("node_modules", spec), "utf8");
    return [...file.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
      const body = m[1]!;
      const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
      const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? "";
      const covers = (cp: number) =>
        range.split(",").some((part) => {
          const [lo, hi] = part.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h, 16));
          return cp >= lo! && cp <= (hi ?? lo)!;
        });
      return { spec, weight, covers };
    });
  });
}

describe("receipt font - Plex Mono covers ₹", () => {
  it.each([400, 600])("weight %i: an imported face's unicode-range includes U+20B9", (weight) => {
    const faces = plexFaces().filter((f) => f.weight === weight);
    expect(faces.length, `no Plex Mono ${weight} imported`).toBeGreaterThan(0);
    expect(faces.some((f) => f.covers(RUPEE)), `no imported Plex Mono ${weight} face covers U+20B9: ${faces.map((f) => f.spec).join(", ")}`).toBe(true);
  });
});
