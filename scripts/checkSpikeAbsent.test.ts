import { describe, expect, it } from "vitest";
import { spikeLeftovers } from "./check-spike-absent";

// KB-384 (owner, 9 Nov 2026): the release fails its own check while the time-limit spike is still there - its function, its test, or
// KB384_SPIKE_KEY in the build's environment. Production's build command runs this before `npm run build` (netlify.toml).

describe("check:spike - the release build fails while the KB-384 spike remains", () => {
  it("nothing left: no problem", () => {
    expect(spikeLeftovers(() => false, {})).toEqual([]);
  });

  it("the function file, its test, or the key each fail the check", () => {
    expect(spikeLeftovers((f) => f === "netlify/functions/voice-spike.mts", {})).toEqual(["netlify/functions/voice-spike.mts still exists"]);
    expect(spikeLeftovers((f) => f === "netlify/functions/voiceSpike.test.ts", {})).toEqual(["netlify/functions/voiceSpike.test.ts still exists"]);
    expect(spikeLeftovers(() => false, { KB384_SPIKE_KEY: "x" })).toEqual(["KB384_SPIKE_KEY is still set in this build's environment"]);
  });
});
