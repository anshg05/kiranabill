import { describe, expect, it } from "vitest";
import { parseUtterance, parseUtteranceParts, splitItemSegments } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-358a (owner, 28 Oct 2026): Whisper often drops the commas, and one text with six numbers is a miss for the whole order.
// A comma-less utterance is split after each PRICE PHRASE ("... 56 रुपए किलो", "... 90 रुपए", "... 30 ka", "... दस वाला"),
// but only when EVERY piece has a name and a number - otherwise the text stays whole, exactly as before.

const U543 = "1 किलो चीनी 56 रुपए किलो, 1 किलो हरा बटाना 56 रुपए किलो, 1 किलो चावल 84 रुपए किलो, 10 किलो गेहु 34 रुपए किलो";
const U543_NO_COMMAS = U543.replace(/,/g, "");
const U437 = "कि एक किलो मुँगडाल चैन रुपए किलो दो किलो बरबटी दाल अठ्यास्थी रुपए किलो एक किलो उड़त मुगर 130 रुपए किलो एक किलो मुँग मोहगर 110 रुपए किलो";
const U438 = "1 kg मुंग दाल 96 रुपई किलो, 1 kg बरबटी दाल 88 रुपई किलो, 2 kg उडद मुगर 130 रुपई किलो, 1 kg मुंग मुगर 110 रुपई किलो, 1 kg चीनी 56 रुपई किलो,";
const SPOKEN = "2 किलो चीनी 56 रुपए किलो 10 किलो गेहु 34 रुपए किलो 2 किलो चावल 90 रुपए"; // the owner's draft-v7 test, no commas

const items = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG);

describe("splitting a comma-less order after each price phrase", () => {
  it("the owner's draft test: three pieces, and the rice stays a TOTAL of Rs 90 (not Rs 180)", () => {
    expect(splitItemSegments(SPOKEN)).toHaveLength(3);
    const got = items(SPOKEN)!;
    expect(got.map((i) => [i.qty, i.rate, i.total, i.priceType])).toEqual([
      [2, 5600, 11200, "rate"],
      [10, 3400, 34000, "rate"],
      [2, null, 9000, "total"],
    ]);
  });
  it("the 5:43 PM order reads the same with and without its commas", () => {
    expect(splitItemSegments(U543_NO_COMMAS)).toHaveLength(4);
    expect(items(U543_NO_COMMAS)).toEqual(items(U543));
  });
  it("the 4:38 PM order (five items, trailing comma) is five pieces", () => {
    expect(splitItemSegments(U438)).toHaveLength(5);
    expect(splitItemSegments(U438.replace(/,/g, ""))).toHaveLength(5);
  });
  it("total, rate and 'wala' markers end a piece too (Roman and Devanagari), with or without a unit after", () => {
    expect(splitItemSegments("2 kilo chawal 100 ka 1 kilo chini 50 ka")).toHaveLength(2);
    expect(splitItemSegments("3 पालेजी दसवाला 2 किलो चीनी 90 का")).toHaveLength(2);
    expect(splitItemSegments("2 kilo chini 56 ka kilo 1 kilo atta 40 ka kilo")).toHaveLength(2);
    expect(splitItemSegments("2 kilo chini 56 rupay 1 kilo atta 40 rupay")).toHaveLength(2);
  });
  it("'per' / 'ka' between the price and its unit stay inside the piece", () => {
    const t = "2 kilo chini 56 rupay per kilo 1 kilo atta 40 rupay ka kilo";
    expect(splitItemSegments(t)).toHaveLength(2);
    expect(items(t)!.map((i) => [i.qty, i.rate, i.total])).toEqual([[2, 5600, 11200], [1, 4000, 4000]]);
    expect(items("2 किलो चीनी 56 रुपए प्रति किलो 1 किलो आटा 40 रुपए प्रति किलो")!.map((i) => i.total)).toEqual([11200, 4000]);
  });
  it("commas and a price phrase together: each comma piece may split further", () => {
    expect(splitItemSegments("2 kilo chini 56 rupay kilo 1 kilo atta 40 rupay kilo, 3 packet parle g 10 rupay packet")).toHaveLength(3);
  });
});

describe("when NOT to split - the text stays whole, as before", () => {
  it("a price first and the quantity after is one item ('chini 100 rupay 2 kilo')", () => {
    expect(splitItemSegments("chini 100 rupay 2 kilo")).toHaveLength(1);
    expect(items("chini 100 rupay 2 kilo")![0]).toMatchObject({ qty: 2, unit: "kg", total: 10000, priceType: "total" });
  });
  it("a marker word inside a NAME is not a price end ('chai ki patti', 'सरसों का तेल')", () => {
    expect(splitItemSegments("2 kilo chai ki patti 100 rupay")).toHaveLength(1);
    expect(splitItemSegments("1 लीटर सरसों का तेल 180 रुपए")).toHaveLength(1);
  });
  it("one item with one price is one piece", () => {
    for (const t of ["100 का चावल", "chawal 100 ka", "2 kilo chawal 90 rupay", "10 किलो गेहु 34 रुपए किलो", "5 kg chawal 30 wala"]) {
      expect(splitItemSegments(t), t).toHaveLength(1);
    }
  });
  it("a piece with no name or no number makes the whole text stay in one piece", () => {
    expect(splitItemSegments("2 kilo chini 56 rupay hisab se")).toHaveLength(1);
    expect(splitItemSegments("56 rupay kilo 2 kilo chini 40 rupay")).toHaveLength(1);
  });
});

describe("parseUtteranceParts: every piece on its own (KB-358a)", () => {
  it("the 4:37 PM order (no commas): two pieces with a price word nobody understood, two readable", () => {
    const parts = parseUtteranceParts(U437, SEED_PARSER_CATALOG);
    expect(parts).toHaveLength(4);
    // "चैन" / "अठ्यास्थी" are 96 and 88 misheard: no number was spoken, so none is invented
    expect(parts[0]!.item).toMatchObject({ qty: 1, unit: "kg", total: null });
    expect(parts[1]!.item).toMatchObject({ qty: 2, unit: "kg", total: null });
    expect(parts[2]!.item).toMatchObject({ catalogId: null, qty: 1, unit: "kg", rate: 13000, total: 13000, priceType: "rate" });
    expect(parts[3]!.item).toMatchObject({ catalogId: "622", qty: 1, unit: "kg", rate: 11000, total: 11000 });
    expect(parts[0]!.text).toContain("चैन");
    expect(parts[2]!.text).toContain("130");
  });
  it("one piece that cannot be read is null; the others still are", () => {
    const parts = parseUtteranceParts("2 kilo chini 56 rupay kilo 5 kg chawal पीस ka", SEED_PARSER_CATALOG); // the 2nd has an orphaned marker (NB077)
    expect(parts).toHaveLength(2);
    expect(parts[0]!.item).toMatchObject({ qty: 2, rate: 5600, total: 11200 });
    expect(parts[1]!.item).toBeNull();
  });
  it("an incomplete piece anywhere keeps the WHOLE text as one unreadable part (as parseUtterance always did)", () => {
    const parts = parseUtteranceParts("चीनी, 2 किलो", SEED_PARSER_CATALOG);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.item).toBeNull();
    expect(items("चीनी, 2 किलो")).toBeNull();
  });
  it("parseUtterance is exactly 'all parts readable'", () => {
    for (const t of [U543, U543_NO_COMMAS, U438, SPOKEN, U437, "2 kilo chini 50 rupay"]) {
      const parts = parseUtteranceParts(t, SEED_PARSER_CATALOG);
      const all = parts.every((p) => p.item !== null);
      expect(items(t) !== null, t).toBe(all);
    }
  });
});
