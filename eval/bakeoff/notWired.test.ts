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
    // KB-384 time-limit spike (owner, 9 Nov 2026): TEMPORARY - gated by KB384_SPIKE_KEY (404 without it), deleted before the V3 release
    // (npm run check:spike). KB-384a (D107): the V3 worker /voice-run uses the Gemini AUDIO provider - only that one; the Sarvam and
    // Gemini-transcription providers stay out of everything shipped until KB-384b wires the backup.
    const ALLOWED: Record<string, string[]> = {
      "netlify/functions/voice-spike.mts": ["geminiAudioParseProvider"],
      "netlify/functions/voice-run.mts": ["geminiAudioParseProvider"],
    };
    const offenders = shipped.flatMap((f) => {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      const text = readFileSync(f, "utf8");
      return BAKEOFF_ONLY.filter((name) => text.includes(`/${name}`) && !(ALLOWED[rel] ?? []).includes(name)).map((name) => `${rel}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
