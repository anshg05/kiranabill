import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// KB-370 (V1 is a report only): the bake-off's providers exist for the measurement and for V3 - nothing the app or /voice runs imports them.

const ROOT = path.resolve(__dirname, "..", "..");
const BAKEOFF_ONLY = ["geminiTranscriptionProvider", "geminiAudioParseProvider", "geminiAudio\"", "sarvamTranscriptionProvider"];

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
    // KB-384 time-limit spike (owner, 9 Nov 2026): the ONE temporary exception - gated by KB384_SPIKE_KEY (404 without it), deleted before
    // the V3 release. KB-384a then wires the audio provider into /voice and this guard is rewritten for V3.
    const TEMPORARY = new Set(["netlify/functions/voice-spike.mts"]);
    const offenders = shipped.filter((f) => !TEMPORARY.has(path.relative(ROOT, f).split(path.sep).join("/"))).filter((f) => {
      const text = readFileSync(f, "utf8");
      return BAKEOFF_ONLY.some((name) => text.includes(`/${name}`));
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
