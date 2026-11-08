import { describe, expect, it } from "vitest";
import { EZY_D102_NOCAT_PROMPT, EZY_D102_PROMPT, EZY_D103_NOCAT_PROMPT } from "./ezyPrompt.js";

// KB-370 nocat (owner, 6 Nov 2026): two no-catalog prompts. nocat-old changes ONLY the catalog rule (there is no catalog to pick from);
// nocat-D103 also rewrites rule 3 to D103 (the unit next to the NUMBER wins). Everything else is E-flash's D102 prompt word for word.

const rules = (p: string) => p.split("\n");

describe("the no-catalog prompts", () => {
  it("nocat-old: E-flash's prompt with only rule 7 (pick a catalog id) replaced", () => {
    const a = rules(EZY_D102_PROMPT);
    const b = rules(EZY_D102_NOCAT_PROMPT);
    expect(b).toHaveLength(a.length);
    const changed = a.flatMap((l, i) => (l === b[i] ? [] : [i]));
    expect(changed).toHaveLength(1);
    expect(a[changed[0]!]).toMatch(/^7\. catalogId/);
    expect(b[changed[0]!]).toMatch(/^7\. catalogId is always null/);
  });

  it("nocat-D103: the same, plus rule 3 rewritten - '1 किलो पैकेट' is 1 kg now, never 1 packet; पैकेट / सेट alone stay packet / set", () => {
    const a = rules(EZY_D102_NOCAT_PROMPT);
    const b = rules(EZY_D103_NOCAT_PROMPT);
    const changed = a.flatMap((l, i) => (l === b[i] ? [] : [i]));
    expect(changed).toHaveLength(1);
    expect(a[changed[0]!]).toMatch(/^3\./);
    expect(EZY_D103_NOCAT_PROMPT).not.toContain('"1 किलो पैकेट" = 1 packet');
    expect(EZY_D103_NOCAT_PROMPT).toContain('"1 किलो पैकेट" = 1 kg');
    expect(EZY_D103_NOCAT_PROMPT).toContain('"सेट"');
    expect(EZY_D103_NOCAT_PROMPT).toContain("never changes a price");
  });
});

describe("KB-383: the V3 prompt (doc 25 §2; owner, 9 Nov 2026)", () => {
  it("is nocat-D103's prompt plus the V3 rules - nothing of the old rules lost", async () => {
    const { EZY_V3_PROMPT } = await import("./ezyPrompt.js");
    for (const kept of ["1. spokenName", "2. A spoken correction", "5. Prices in PAISE", "6. Never invent", "7. catalogId is always null"]) expect(EZY_V3_PROMPT).toContain(kept);
  });

  it("units only from the list, in English; a size word stays in the name (A60)", async () => {
    const { EZY_V3_PROMPT } = await import("./ezyPrompt.js");
    expect(EZY_V3_PROMPT).toContain("kg, gm, liter, ml, piece, packet, dozen, box, bottle, pouch, bag, can, tin, set");
    expect(EZY_V3_PROMPT).toContain('"बोतल" = "bottle"');
    expect(EZY_V3_PROMPT).toContain('"हार्पिक बड़ा"');
  });

  it("repeats: written twice, two lines (A39, A40); A19's example in rule 3", async () => {
    const { EZY_V3_PROMPT } = await import("./ezyPrompt.js");
    expect(EZY_V3_PROMPT).toMatch(/said twice[^\n]*TWO lines/);
    expect(EZY_V3_PROMPT).toContain('"एक किलो लाल मिर्ची पैकेट" = 1 kg');
  });

  it("removal (owner): only WITH the item named; with no item named nothing is removed", async () => {
    const { EZY_V3_PROMPT } = await import("./ezyPrompt.js");
    expect(EZY_V3_PROMPT).toContain('"हटा दो" / "निकाल दो" / "cancel"');
    expect(EZY_V3_PROMPT).toMatch(/no item is named[^\n]*remove NOTHING/);
  });

  it("the quantity rule as D105 has it, and Devanagari names AND transcript", async () => {
    const { EZY_V3_PROMPT } = await import("./ezyPrompt.js");
    expect(EZY_V3_PROMPT).toContain('"X वाला" with no quantity');
    expect(EZY_V3_PROMPT).toMatch(/never any other 1/);
    expect(EZY_V3_PROMPT).toMatch(/transcript[^\n]*Devanagari/);
    expect(EZY_V3_PROMPT).toContain("लाइज़ॉल");
  });
});
