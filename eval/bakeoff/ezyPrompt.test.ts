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
