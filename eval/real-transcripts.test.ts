import { describe, expect, it } from "vitest";
import { resolveUtterance } from "../src/data/voiceBilling";
import type { ParsedItem } from "../src/domain/grammar";
import { SEED_PARSER_CATALOG } from "../src/domain/seedCatalog";
import { loadRealTranscripts, scoreTranscript } from "./real-transcripts";

// KB-317 commit 2: Layer 1 on the owner's REAL transcripts (Whisper Devanagari,
// expected lines confirmed by the owner). A wrong line is never acceptable;
// "hit" cases must be answered correctly by Layer 1 alone - including their
// expected flags (commit 3: RT20-RT22's duplicate_line).

const cases = loadRealTranscripts();

describe("KB-317 - Layer 1 on the owner's real transcripts", () => {
  it.each(cases.map((c) => [c.id, c.layer1, c.transcript, c] as const))("%s (%s) %s", async (_id, layer1, transcript, c) => {
    const r = await scoreTranscript(transcript, c.expectedLines, c.expectedFlags);
    expect(r.outcome, r.detail).not.toBe("hit-wrong");
    if (layer1 === "hit") expect(r.outcome, r.detail).toBe("hit-correct");
    if (layer1 === "miss") expect(r.outcome, r.detail).toBe("miss");
  });
});

// KB-317 commit 5 (owner): the silent taps (RT35-RT39). Replays what real
// Gemini did with them - an unknown "झाल" line with no number, or nothing - and
// requires no line and no flag on the bill.
describe("KB-317 - silence: a hallucinated transcript puts nothing on the bill", () => {
  const silent = cases.filter((c) => c.expectedLines.length === 0);

  it("the silent fixtures are there", () => {
    expect(silent.map((c) => c.id)).toEqual(["RT35", "RT36", "RT37", "RT38", "RT39"]);
  });

  it.each(silent.map((c) => [c.id, c.transcript] as const))("%s %s -> no lines, no flags", async (_id, transcript) => {
    const junk: ParsedItem = {
      spokenName: transcript, catalogId: null, isCustom: true, matchStatus: "none",
      qty: null, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown",
    };
    for (const geminiSaid of [[junk], []]) {
      const r = await resolveUtterance(transcript, { shop: SEED_PARSER_CATALOG, parse: async () => geminiSaid });
      expect(r.lines).toEqual([]);
      expect(r.flags).toEqual([]);
    }
  });
});
