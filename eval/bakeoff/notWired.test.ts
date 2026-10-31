import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// KB-370 (V1 is a report only): the bake-off's providers exist for the measurement and for V3 - nothing the app or /voice runs imports them.

const ROOT = path.resolve(__dirname, "..", "..");
const BAKEOFF_ONLY = ["geminiTranscriptionProvider", "geminiAudioParseProvider", "geminiAudio\""];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("the bake-off providers are not wired into the app", () => {
  it("no file in src/app, src/data, src/domain, src/providers, src/ui or netlify/functions imports them", () => {
    const shipped = ["src/app", "src/data", "src/domain", "src/providers", "src/ui", "netlify/functions"].flatMap((d) => files(path.join(ROOT, d)));
    expect(shipped.length).toBeGreaterThan(50);
    const offenders = shipped.filter((f) => {
      const text = readFileSync(f, "utf8");
      return BAKEOFF_ONLY.some((name) => text.includes(`/${name}`));
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
