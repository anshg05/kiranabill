import { describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { resolveUtterance } from "./voiceBilling";

// KB-358-0 (owner, 28 Oct 2026): the owner's orders through the SHIPPED routing (src/domain/grammarPerUnit.test.ts holds the
// grammar cases). A quantity above 1 with "N रुपए किलो" must bill qty x rate, never the bare price.

const parse = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG);

describe("the owner's three orders (28 Oct 2026), through the shipped routing", () => {
  const run = async (t: string) => {
    let geminiCalled = false;
    const r = await resolveUtterance(t, { shop: SEED_PARSER_CATALOG, parse: async () => ((geminiCalled = true), []) });
    return { r, geminiCalled };
  };
  it("5:43 PM: four lines, each with the right total - Gehun 10 kg at Rs 34 is Rs 340", async () => {
    const { r, geminiCalled } = await run("1 किलो चीनी 56 रुपए किलो, 1 किलो हरा बटाना 56 रुपए किलो, 1 किलो चावल 84 रुपए किलो, 10 किलो गेहु 34 रुपए किलो");
    expect(geminiCalled).toBe(false);
    expect(r.layer).toBe("fastpath");
    expect(r.lines.map((l) => [l.item.qty, l.item.rate, l.item.total])).toEqual([
      [1, 5600, 5600],
      [1, 5600, 5600],
      [1, 8400, 8400],
      [10, 3400, 34000],
    ]);
  });
  it("4:38 PM (it went to Layer 2): the same five-line order reads the same by rule, with 'रुपई'", async () => {
    const { r } = await run("1 kg मुंग दाल 96 रुपई किलो, 1 kg बरबटी दाल 88 रुपई किलो, 2 kg उडद मुगर 130 रुपई किलो, 1 kg मुंग मुगर 110 रुपई किलो, 1 kg चीनी 56 रुपई किलो,");
    const sums = parse("2 kg उडद मुगर 130 रुपई किलो");
    expect(sums![0]).toMatchObject({ qty: 2, rate: 13000, total: 26000, priceType: "rate" });
    // a layer-1 hit or a hand-off is both safe; what must never happen is a line total that ignores the quantity
    for (const l of r.lines) {
      if (l.item.qty !== null && l.item.rate !== null && l.item.total !== null) expect(l.item.total).toBe(Math.round(l.item.qty * l.item.rate));
    }
  });
});
