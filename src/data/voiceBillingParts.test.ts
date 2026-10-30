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

describe("KB-363 (owner, 29 Oct 2026): 'एक सो दस' is 110 - the owner's phone sentence raises no warning at all", () => {
  const SAID = "एक किलो मुंग मोगर एक सो दस रुपए किलो";
  const geminiLine: ParsedItem = { spokenName: "मुंग मोगर", catalogId: "622", isCustom: false, matchStatus: "matched", qty: 1, unit: "kg", rate: 11000, rateUnit: "kg", total: 11000, priceType: "rate" };
  it("whichever layer reads it (Layer 1 by rule, or Gemini's correct 1 kg x Rs 110): one line at Rs 110 and no HIGH flag", async () => {
    const r = await run(SAID, async () => [geminiLine]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ qty: 1, unit: "kg", rate: 11000, total: 11000 });
    expect(r.flags.filter((f) => f.severity === "HIGH")).toEqual([]);
  });
  it("Gemini's answer for it, sent whole to Layer 2 (a text Layer 1 left alone): still no number flag - the checker reads 110 once", async () => {
    const r = await run("मुंग मोगर " + SAID.replace("मुंग मोगर ", ""), async () => [geminiLine]);
    expect(r.flags.filter((f) => f.severity === "HIGH")).toEqual([]);
  });
});

describe("KB-362 (owner, 29 Oct 2026): a price per kilo said WITHOUT 'rupees', after the quantity, is never a quantity", () => {
  const OWNER = "1 किलो मूंग दाल 96 किलो 1 किलो बर्बटी दाल 88 किलो 1 किलो उडद मोगर 130 किलो 1 किलो मूंग मोगर 110 किलो";
  it.each([OWNER, "1 किलो मूंग दाल 96 किलो", "2 किलो चीनी 45 किलो", "एक किलो चीनी पैंतालीस किलो"])("Layer 1 does not read %s by rule (it never becomes 96 kg) - the text goes to Layer 2 whole", async (t) => {
    const asked: string[] = [];
    const r = await run(t, async (text) => (asked.push(text), []));
    expect(asked).toEqual([t]);
    expect(r.lines).toEqual([]);
  });
});

describe("KB-362 (owner, 30 Oct 2026): price-less and MIXED orders with no commas are read by rule, each quantity on its own item", () => {
  const lines = (r: Awaited<ReturnType<typeof run>>) => r.lines.map((l) => [l.item.spokenName, l.item.qty, l.item.priceType, l.item.total, l.source]);

  it.each([
    ["name first (the owner's sentence)", "बरबटी दाल एक किलो मूंग दाल दो किलो हरा बटाना एक किलो"],
    ["quantity first", "एक किलो बरबटी दाल दो किलो मूंग दाल एक किलो हरा बटाना"],
  ])("%s: three lines, quantities 1 / 2 / 1 on the right items, Gemini never called", async (_label, said) => {
    const r = await run(said); // `never` throws if Layer 2 is called
    expect(lines(r)).toEqual([
      ["बरबटी दाल", 1, "default", 8000, "fastpath"],
      ["मूंग दाल", 2, "default", 22000, "fastpath"],
      ["हरा बटाना", 1, "default", 7000, "fastpath"],
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it("the owner's MIXED order: चीनी 2 kg (default price), चावल Rs 90 total, दाल 1 kg at Rs 96 - the price stays with its item", async () => {
    const r = await run("चीनी दो किलो चावल 90 रुपए दाल एक किलो 96 रुपए किलो");
    expect(lines(r)).toEqual([
      ["चीनी", 2, "default", 9000, "fastpath"],
      ["चावल", null, "total", 9000, "fastpath"],
      ["दाल", 1, "rate", 9600, "fastpath"],
    ]);
  });

  it.each(["चीनी दो किलो चावल 5", "चीनी एक किलो चावल 90 रुपए", "कि एक किलो चीनी दो किलो चावल 90 रुपए", "1 किलो मूंग दाल 96 किलो 1 किलो बर्बटी दाल 88 किलो"])(
    "ambiguous - %s: Layer 1 accepts NO line; the whole text goes to Layer 2 (a quantity is never put on a guess)",
    async (said) => {
      const asked: string[] = [];
      const r = await run(said, async (text) => (asked.push(text), []));
      expect(r.lines).toEqual([]);
      expect(asked).toEqual([said]);
    },
  );
});

describe("KB-359: Gemini's answer is checked against the piece it was asked about", () => {
  const priced = (over: Partial<ParsedItem>): ParsedItem => ({ spokenName: "zzyzx khaas", catalogId: null, isCustom: true, matchStatus: "none", qty: 5, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "unknown", ...over });

  it("A: a total spoken ('90 rupay') that the AI wrote as a RATE (Rs 450) -> the AI's line is shown with a HIGH flag on it", async () => {
    const r = await run("5 kilo zzyzx khaas 90 rupay", async () => [priced({ rate: 9000, rateUnit: "kg", total: 45000, priceType: "rate" })]);
    expect(r.lines[0]!.item).toMatchObject({ qty: 5, total: 45000 });
    expect(r.flags.filter((f) => f.code === "layer2_disagrees")).toEqual([expect.objectContaining({ severity: "HIGH", itemIndex: 0 })]);
  });
  it("A: the AI agrees with what was spoken -> no such flag", async () => {
    const r = await run("5 kilo zzyzx khaas 90 rupay", async () => [priced({ total: 9000, priceType: "total" })]);
    expect(r.flags.some((f) => f.code === "layer2_disagrees")).toBe(false);
  });
  it("B: 'चैन रुपए किलो' (a price nobody can read) and the AI invents Rs 60 -> the line has NO price ('price needed'), the quantity stays, no flag", async () => {
    const r = await run("एक किलो मुँगडाल चैन रुपए किलो", async () => [{ ...custom("मुंगडाल", 1), rate: 6000, total: 6000 }]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ qty: 1, unit: "kg", rate: null, total: null, priceType: "unknown" });
    expect(r.flags.some((f) => f.code === "layer2_disagrees")).toBe(false);
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

describe("KB-366 (A42): a custom line needs an EXPLICIT unit word - a bare number is not a quantity", () => {
  it("'दन्त कान 30 60 वाला' (30 = the pack size) is NOT 30 pieces at Rs 60 = Rs 1,800: Layer 1 accepts nothing, the text goes to Layer 2", async () => {
    const asked: string[] = [];
    const r = await run("दन्त कान 30 60 वाला", async (text) => (asked.push(text), []));
    expect(r.lines).toEqual([]);
    expect(asked).toEqual(["दन्त कान 30 60 वाला"]);
  });
  it("with a spoken unit it is still a custom line (KB-358b)", async () => {
    const r = await run("2 kg zzyzx khaas 130 rupay kilo");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ qty: 2, unit: "kg", total: 26000 });
  });
  it("Layer 2 gives a quantity nobody said for a price-only piece: the bill line has NO quantity (Check C through the real resolver)", async () => {
    const r = await run("kuch naya 110 rupay", async () => [{ spokenName: "kuch naya", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit: "piece", rate: null, rateUnit: null, total: 11000, priceType: "total" }]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ qty: null, unit: "", total: 11000 });
  });
});

describe("KB-366 (A48): Layer 2 may not put a number on the bill that nobody said", () => {
  it("Gemini answers Rs 602 for 'kuch naya 200 rupay': the line stays, with no price (Price needed)", async () => {
    const r = await run("kuch naya 200 rupay", async () => [{ spokenName: "kuch naya", catalogId: null, isCustom: true, matchStatus: "none", qty: null, unit: "", rate: null, rateUnit: null, total: 60200, priceType: "total" }]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ rate: null, total: null, priceType: "unknown" });
  });
  it("and Rs 200 (spoken) is kept", async () => {
    const r = await run("kuch naya 200 rupay", async () => [{ spokenName: "kuch naya", catalogId: null, isCustom: true, matchStatus: "none", qty: null, unit: "", rate: null, rateUnit: null, total: 20000, priceType: "total" }]);
    expect(r.lines[0]!.item).toMatchObject({ total: 20000, priceType: "total" });
  });
});
