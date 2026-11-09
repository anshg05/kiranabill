import { describe, expect, it } from "vitest";
import { DRAFT_ORIGIN, checkPlan, mimeOf } from "./draft-voice-check";

// KB-384a step 6 (owner, 10 Nov 2026): the owner runs this himself against the DRAFT with his own login. It may spend at most what was
// approved (Gemini cap Rs 2 = the two recordings A63 and A61, one call each) and may talk only to the draft - never production's site.

describe("draft-voice-check guards", () => {
  it("only the release-draft address", () => {
    expect(DRAFT_ORIGIN).toBe("https://release-draft--kiranabilling.netlify.app");
    expect(checkPlan(["A63", "A61"], DRAFT_ORIGIN)).toEqual([]);
    expect(checkPlan(["A63"], "https://kiranabilling.netlify.app").join(" ")).toMatch(/draft/);
  });

  it("at most the two approved recordings, each once", () => {
    expect(checkPlan(["A63", "A61", "A01"], DRAFT_ORIGIN).join(" ")).toMatch(/at most 2/);
    expect(checkPlan(["A63", "A63"], DRAFT_ORIGIN).join(" ")).toMatch(/twice/);
    expect(checkPlan(["A02"], DRAFT_ORIGIN).join(" ")).toMatch(/approved/);
  });

  it("the audio type from the file name - what the bucket accepts", () => {
    expect(mimeOf("A63.m4a")).toBe("audio/mp4");
    expect(mimeOf("A61.webm")).toBe("audio/webm");
  });
});
