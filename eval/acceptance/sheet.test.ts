import { describe, expect, it } from "vitest";
import { parseSheet, sheetBlock } from "./sheet";

// KB-364: the expected-bill sheet the owner fills in, in plain words.

const sheet = (body: string) => parseSheet(body);

describe("one order block", () => {
  it("reads said, lines of every price kind, not-added pieces and the accepted checks", () => {
    const r = sheet(`## A01 short-priced
said: दो किलो चीनी पैंतालीस रुपए किलो
- 2 kg चीनी @45
- 5 किलो चावल =225
- चावल =90
- 1 kg मूंग दाल
- 500 gm बेसन price needed
- NOT ADDED 2
checks: 1
`);
    expect(r.errors).toEqual([]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toEqual({
      id: "A01",
      category: "short-priced",
      said: "दो किलो चीनी पैंतालीस रुपए किलो",
      expected: {
        lines: [
          { name: "चीनी", qty: 2, unit: "kg", price: { kind: "rate", paise: 4500 } },
          { name: "चावल", qty: 5, unit: "kg", price: { kind: "total", paise: 22500 } },
          { name: "चावल", qty: null, unit: "", price: { kind: "total", paise: 9000 } },
          { name: "मूंग दाल", qty: 1, unit: "kg", price: { kind: "default" } },
          { name: "बेसन", qty: 500, unit: "gm", price: { kind: "needed" } },
        ],
        notAdded: 2,
        checks: 1,
      },
    });
  });

  it("amounts are exact paise - decimals never go through a float", () => {
    const r = sheet("## A02 x\nsaid: x\n- 1 kg चीनी @45.5\n- 1 kg चीनी =0.07\n- 1 kg चीनी =1234.05\n");
    expect(r.errors).toEqual([]);
    expect(r.orders[0]!.expected!.lines.map((l) => l.price)).toEqual([
      { kind: "rate", paise: 4550 },
      { kind: "total", paise: 7 },
      { kind: "total", paise: 123405 },
    ]);
  });

  it("fractions and units in Hindi are read", () => {
    const r = sheet("## A03 x\nsaid: x\n- 0.5 किलो चीनी\n- 1.5 liter तेल @120\n- 2 packet पारले जी\n");
    expect(r.errors).toEqual([]);
    expect(r.orders[0]!.expected!.lines.map((l) => [l.qty, l.unit])).toEqual([[0.5, "kg"], [1.5, "liter"], [2, "packet"]]);
  });

  it("NOT ADDED alone is one piece; checks default to 0", () => {
    const r = sheet("## A04 x\nsaid: x\n- NOT ADDED\n");
    expect(r.orders[0]!.expected).toEqual({ lines: [], notAdded: 1, checks: 0 });
  });

  it("a block with nothing filled in is pending (expected null), not an error", () => {
    const r = sheet("## A05 mixed\nsaid:\n\n## A06 mixed\nsaid: x\n- 1 kg चीनी\n");
    expect(r.errors).toEqual([]);
    expect(r.orders.map((o) => [o.id, o.expected === null])).toEqual([["A05", true], ["A06", false]]);
  });

  it.each([
    ["a quantity without a unit", "- 2 चीनी @45", /unit/],
    ["a line with no quantity and no total", "- चावल", /total/],
    ["a rate on a line with no quantity", "- चावल @45", /quantity/],
    ["two prices", "- 2 kg चीनी @45 =90", /one price/],
    ["a negative or odd amount", "- 2 kg चीनी @-5", /amount/],
    ["a stray line", "chini 2 kilo", /start with/],
    ["checks that is not a number", "checks: many", /checks/],
  ])("refuses %s with the block id and the reason", (_label, line, why) => {
    const r = sheet(`## A07 x\nsaid: x\n${line}\n`);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^A07: /);
    expect(r.errors[0]).toMatch(why);
  });

  it("OWNER CHECK: a block with a '# OWNER CHECK' line stays pending even with its text and lines written - until the line is removed", () => {
    const r = sheet("## A13 x\nsaid: garbled text\n# OWNER CHECK: what did you say?\n- 1 kg चीनी\nchecks: 0\n");
    expect(r.errors).toEqual([]);
    expect(r.orders[0]).toMatchObject({ id: "A13", said: "garbled text", expected: null, ownerCheck: "what did you say?" });
    const answered = sheet("## A13 x\nsaid: garbled text\n- 1 kg चीनी\nchecks: 0\n");
    expect(answered.orders[0]!.expected).not.toBeNull();
    expect(answered.orders[0]!.ownerCheck).toBeUndefined();
  });

  it("SKIP: a block with a '# SKIP: reason' line is kept out of the gate and says why (the owner's call, or Whisper heard other words)", () => {
    const r = sheet("## A41 x\nsaid: heard text\n# SKIP: not needed now (owner)\n- 1 kg चीनी\nchecks: 0\n");
    expect(r.errors).toEqual([]);
    expect(r.orders[0]).toMatchObject({ id: "A41", expected: null, skipped: "not needed now (owner)" });
    expect(r.orders[0]!.ownerCheck).toBeUndefined();
  });

  it("KB-370: a SKIP block still carries its written bill as skippedExpected (the bake-off scores it; the gate does not)", () => {
    const r = sheet("## A33 x\nsaid: heard text\n# SKIP: Whisper heard other numbers\n- 1 kg चीनी @80\nchecks: 0\n");
    expect(r.orders[0]).toMatchObject({ expected: null, skippedExpected: { lines: [{ name: "चीनी", qty: 1, unit: "kg", price: { kind: "rate", paise: 8000 } }], notAdded: 0, checks: 0 } });
    const notWritten = sheet("## A13 x\nsaid:\n# SKIPPED: could not be read\nchecks: 0\n");
    expect(notWritten.orders[0]!.skippedExpected).toBeUndefined();
  });

  it("duplicate ids and ids that are not A01..A99 are errors", () => {
    expect(sheet("## A01 x\nsaid: x\n- 1 kg चीनी\n## A01 x\nsaid: y\n- 1 kg चीनी\n").errors.join()).toMatch(/twice/);
    expect(sheet("## B1 x\nsaid: x\n").errors.join()).toMatch(/id/);
  });
});

describe("the template block", () => {
  it("is a block the parser reads as pending", () => {
    const r = sheet(sheetBlock({ id: "A12", category: "mixed" }));
    expect(r.errors).toEqual([]);
    expect(r.orders[0]).toMatchObject({ id: "A12", category: "mixed", expected: null });
  });
});
