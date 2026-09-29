import { describe, expect, it } from "vitest";
import { loadRealTranscripts, scoreTranscript } from "./real-transcripts";

// KB-317 commit 2: Layer 1 on the owner's REAL transcripts (Whisper Devanagari,
// expected lines confirmed by the owner). A wrong line is never acceptable;
// "hit" cases must be answered correctly by Layer 1 alone.
//
// duplicate_line is KB-317 commit 3 - until then RT20-RT22 are scored on
// their lines only. Commit 3 deletes this set.
const FLAGS_FROM_COMMIT_3 = new Set(["duplicate_line"]);

describe("KB-317 - Layer 1 on the owner's real transcripts", () => {
  it.each(loadRealTranscripts().map((c) => [c.id, c.layer1, c.transcript, c] as const))("%s (%s) %s", async (_id, layer1, transcript, c) => {
    const flags = (c.expectedFlags ?? []).filter((f) => !FLAGS_FROM_COMMIT_3.has(f));
    const r = await scoreTranscript(transcript, c.expectedLines, flags);
    expect(r.outcome, r.detail).not.toBe("hit-wrong");
    if (layer1 === "hit") expect(r.outcome, r.detail).toBe("hit-correct");
    if (layer1 === "miss") expect(r.outcome, r.detail).toBe("miss");
  });
});
