import { describe, expect, it, vi } from "vitest";
import type { ParsedItem } from "@/domain/grammar";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { resolveUtterance } from "./voiceBilling";

// KB-358a / b (owner, 28 Oct 2026): a long order is resolved PIECE by piece. Layer 1 keeps every piece it can read; only the
// pieces it cannot read go to Layer 2, together; if Layer 2 fails, only those pieces are left over (each with its own text),
// and what Layer 1 read is already on the bill. A piece with a spoken quantity, unit, name and price is a line even when the
// product is not in the catalog (exactly the spoken numbers) - and never reaches Gemini.

const U437 = "कि एक किलो मुँगडाल चैन रुपए किलो दो किलो बरबटी दाल अठ्यासथा रुपए किलो एक किलो उड़त मुगर 130 रुपए किलो एक किलो मुँग मोहगर 110 रुपए किलो";
const U438 = "1 kg मुंग दाल 96 रुपई किलो, 1 kg बरबटी दाल 88 रुपई किलो, 2 kg उडद मुगर 130 रुपई किलो, 1 kg मुंग मुगर 110 रुपई किलो, 1 kg चीनी 56 रुपई किलो,";
const SPOKEN = "2 किलो चीनी 56 रुपए किलो 10 किलो गेहु 34 रुपए किलो 2 किलो चावल 90 रुपए";

const never = vi.fn(async (): Promise<ParsedItem[]> => {
  throw new Error("Gemini must not be called");
});
const run = (t: string, parse: (text: string) => Promise<ParsedItem[]> = never) => resolveUtterance(t, { shop: SEED_PARSER_CATALOG, parse });

const custom = (name: string, qty: number): ParsedItem => ({ spokenName: name, catalogId: null, isCustom: true, matchStatus: "none", qty, unit: "kg", rate: 9600, rateUnit: "kg", total: qty * 9600, priceType: "rate" });

describe("KB-358a: comma-less orders resolve in Layer 1", () => {
  it("the owner's draft test: three lines, no Gemini, the rice is Rs 90 total", async () => {
    const r = await run(SPOKEN);
    expect(r.layer).toBe("fastpath");
    expect(r.unresolved).toEqual([]);
    expect(r.lines.map((l) => [l.item.qty, l.item.total, l.source])).toEqual([[2, 11200, "fastpath"], [10, 34000, "fastpath"], [2, 9000, "fastpath"]]);
  });
});

describe("KB-358b: a fully spoken price makes a line even when the product is unknown", () => {
  it("the 4:38 PM order: five lines in Layer 1, 'उडद मुगर' a custom line at exactly 2 kg x Rs 130, flagged 'not in your catalog'", async () => {
    const r = await run(U438);
    expect(r.unresolved).toEqual([]);
    expect(r.lines).toHaveLength(5);
    const urad = r.lines.find((l) => l.item.catalogId === null)!;
    expect(urad.item).toMatchObject({ qty: 2, unit: "kg", rate: 13000, total: 26000, priceType: "rate" });
    expect(urad.source).toBe("fastpath");
    expect(r.flags.some((f) => f.code === "unknown_product")).toBe(true);
  });
  it("a piece with no unit, no price, a total only, or a bare total next to a garbled word is NOT made into a line by Layer 1 - it goes to Layer 2", async () => {
    for (const t of ["2 kuch naya 50 rupay", "1 kilo kuch naya", "kuch naya 50 rupay ka", "2 kilo kuch naya 90 rupay", "5 किलो चावल 30 खाब"]) {
      const asked: string[] = [];
      await run(t, async (text) => (asked.push(text), []));
      expect(asked, t).toHaveLength(1);
    }
  });
});

describe("KB-360: only NO match at all makes a custom line - an ambiguous one never does", () => {
  it("two close products for the same spoken name (the owner's हरा बटाना, 29 Oct) + a full rate: the piece goes to Layer 2, never a custom line", async () => {
    const hara = SEED_PARSER_CATALOG.entries.find((e) => e.id === "626")!;
    const shop = prepareParserCatalog([...SEED_PARSER_CATALOG.entries, { ...hara, id: "9002" }]);
    const asked: string[] = [];
    const r = await resolveUtterance("1 किलो हरा बटाना 56 रुपए किलो", { shop, parse: async (text) => (asked.push(text), []) });
    expect(asked).toHaveLength(1);
    expect(r.lines).toEqual([]);
  });
  it("a name that matches NOTHING, with a full rate, is still a custom line (KB-358b)", async () => {
    const r = await run("2 kg zzyzx khaas 130 rupay kilo");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ catalogId: null, qty: 2, rate: 13000, total: 26000 });
  });
});

describe("KB-358a: only the unresolved pieces go to Layer 2, together", () => {
  it("the 4:37 PM order: Gemini sees the two unreadable pieces and nothing else; its lines join the two Layer 1 lines", async () => {
    const asked: string[] = [];
    const r = await run(U437, async (text) => (asked.push(text), [custom("मुंगडाल", 1), custom("बरबटी दाल", 2)]));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("चैन");
    expect(asked[0]).toContain("अठ्यासथा");
    expect(asked[0]).not.toContain("130");
    expect(asked[0]).not.toContain("110");
    expect(r.layer).toBe("voice");
    expect(r.unresolved).toEqual([]);
    expect(r.lines).toHaveLength(4);
    expect(r.lines.map((l) => l.source).sort()).toEqual(["fastpath", "fastpath", "voice", "voice"]);
  });

  it("the review flags of Layer 2's lines point at THEIR place on the bill, after the Layer 1 lines", async () => {
    const r = await run(U437, async () => [custom("मुंगडाल", 1), custom("बरबटी दाल", 2)]);
    const unknown = r.flags.filter((f) => f.code === "unknown_product").map((f) => f.itemIndex).sort();
    expect(r.lines).toHaveLength(4);
    expect(unknown.every((i) => i !== null && i >= 0 && i < 4)).toBe(true);
    // the two Layer 1 lines come first (0, 1); a flag for a Layer 2 line (2, 3) must not point at a Layer 1 line
    for (const f of r.flags.filter((x) => x.itemIndex !== null && x.itemIndex >= 2)) expect(r.lines[f.itemIndex!]!.source).toBe("voice");
    expect(r.flags.some((f) => f.itemIndex !== null && f.itemIndex >= 2)).toBe(true);
  });

  it("if Layer 2 FAILS: the two readable lines are returned, and each unreadable piece is its own leftover with its own text", async () => {
    const boom = new Error("429");
    const r = await run(U437, async () => {
      throw boom;
    });
    expect(r.lines).toHaveLength(2);
    expect(r.lines.every((l) => l.source === "fastpath")).toBe(true);
    expect(r.unresolved).toHaveLength(2);
    expect(r.unresolved[0]).toContain("चैन");
    expect(r.unresolved[1]).toContain("अठ्यासथा");
    expect(r.failure).toBe(boom);
  });

  it("if Layer 2 answers with nothing for those pieces, they are still left over - never silently dropped", async () => {
    const r = await run(U437, async () => []);
    expect(r.lines).toHaveLength(2);
    expect(r.unresolved).toHaveLength(2);
    expect(r.failure).toBeUndefined();
  });

  it("a text that cannot be split (one piece) behaves exactly as before: a Layer 2 failure is thrown", async () => {
    const boom = new Error("busy");
    await expect(run("2 kuch naya", async () => { throw boom; })).rejects.toBe(boom);
  });

  it("nothing readable at all and several pieces: no throw - every piece is its own leftover", async () => {
    const boom = new Error("429");
    const r = await run("कि एक किलो मुँगडाल चैन रुपए किलो दो किलो बरबटी दाल अठ्यासथा रुपए किलो", async () => { throw boom; });
    expect(r.lines).toEqual([]);
    expect(r.unresolved).toHaveLength(2);
    expect(r.failure).toBe(boom);
  });
});

describe("the all-readable case is unchanged", () => {
  it("the 5:43 PM order: four lines, flags as before, no leftovers", async () => {
    const r = await run("1 किलो चीनी 56 रुपए किलो, 1 किलो हरा बटाना 56 रुपए किलो, 1 किलो चावल 84 रुपए किलो, 10 किलो गेहु 34 रुपए किलो");
    expect(r.lines.map((l) => l.item.total)).toEqual([5600, 5600, 8400, 34000]);
    expect(r.unresolved).toEqual([]);
  });
});
