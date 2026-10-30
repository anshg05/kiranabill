import { describe, expect, it } from "vitest";
import { parseUtterance, splitItemSegments } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-362 (owner, 29-30 Oct 2026): an order with no commas is cut at its QUANTITY phrases ("एक किलो") as well as at its price phrases -
// in both word orders, mixed priced / price-less orders included - and ONLY when every piece is complete and the attachment is
// unambiguous. Anything else stays whole (Layer 2 reads it): a quantity is never given to the wrong item.

describe("a price-less order is cut at its quantity phrases", () => {
  it.each([
    ["name first: बरबटी दाल एक किलो मूंग दाल दो किलो हरा बटाना एक किलो", "बरबटी दाल एक किलो मूंग दाल दो किलो हरा बटाना एक किलो", ["बरबटी दाल एक किलो", "मूंग दाल दो किलो", "हरा बटाना एक किलो"]],
    ["quantity first: एक किलो बरबटी दाल दो किलो मूंग दाल एक किलो हरा बटाना", "एक किलो बरबटी दाल दो किलो मूंग दाल एक किलो हरा बटाना", ["एक किलो बरबटी दाल", "दो किलो मूंग दाल", "एक किलो हरा बटाना"]],
    ["Roman, quantity first", "ek kilo chini do kilo chawal teen kilo besan", ["ek kilo chini", "do kilo chawal", "teen kilo besan"]],
    ["Roman, name first", "chini ek kilo chawal do kilo", ["chini ek kilo", "chawal do kilo"]],
    ["fractions (आधा, डेढ़) are quantities", "आधा किलो चीनी डेढ़ किलो चावल", ["आधा किलो चीनी", "डेढ किलो चावल"]],
    ["digits", "2 किलो चीनी 3 किलो चावल 500 ग्राम बेसन", ["2 किलो चीनी", "3 किलो चावल", "500 ग्राम बेसन"]],
  ])("%s", (_label, said, pieces) => {
    expect(splitItemSegments(said)).toEqual(pieces);
  });
});

describe("MIXED orders: priced and price-less pieces, no commas", () => {
  it.each([
    ["the owner's example (name first)", "चीनी दो किलो चावल 90 रुपए दाल एक किलो 96 रुपए किलो", ["चीनी दो किलो", "चावल 90 रुपए", "दाल एक किलो 96 रुपए किलो"]],
    ["quantity first", "दो किलो चीनी तीन किलो चावल 90 रुपए एक किलो दाल 96 रुपए किलो", ["दो किलो चीनी", "तीन किलो चावल 90 रुपए", "एक किलो दाल 96 रुपए किलो"]],
    ["name first, a per-kilo price after its quantity", "चीनी दो किलो 45 रुपए किलो चावल तीन किलो", ["चीनी दो किलो 45 रुपए किलो", "चावल तीन किलो"]],
    ["Roman, quantity first, the price-less piece last", "2 kilo chini 45 rupay kilo 3 kilo chawal", ["2 kilo chini 45 rupay kilo", "3 kilo chawal"]],
  ])("%s", (_label, said, pieces) => {
    expect(splitItemSegments(said)).toEqual(pieces);
  });
});

describe("what is NOT cut - ambiguous or incomplete, so it stays whole for Layer 2", () => {
  it.each([
    ["the owner's per-kilo price without 'rupees': a quantity phrase with no name (never 96 kg)", "1 किलो मूंग दाल 96 किलो 1 किलो बर्बटी दाल 88 किलो"],
    ["starts and ends with a name: whose quantity is the middle one?", "चीनी दो किलो चावल"],
    ["the same, with two-word names (long enough that only the list rule can refuse it)", "हरा बटाना दो किलो मूंग दाल"],
    ["a bare number between two quantity-first pieces", "एक किलो चीनी 5 दो किलो चावल"],
    ["a last piece that is only a name, after a priced piece", "बेसन दो किलो 90 रुपए चावल"],
    ["ends with a quantity phrase that has no name", "एक किलो चीनी दो किलो"],
    ["a bare number that is neither a quantity nor a price", "चीनी दो किलो चावल 5"],
    ["a unit with no number", "चीनी किलो चावल दो किलो"],
    ["two quantities in a row", "चीनी दो किलो तीन किलो चावल"],
    ["a leading filler word makes both readings possible ('कि' + quantity-first, or name-first)", "कि एक किलो चीनी दो किलो चावल 90 रुपए"],
    ["a quantity AFTER the price of the same piece, no name for it", "चावल 90 रुपए दो किलो"],
    ["only one quantity: nothing to cut", "बरबटी दाल एक किलो"],
  ])("%s", (_label, said) => {
    expect(splitItemSegments(said)).toEqual([said]);
  });
});

describe("read by rule: each quantity lands on the right item", () => {
  const read = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG)!.map((i) => [i.spokenName, i.qty, i.unit, i.priceType]);

  it("name first", () => {
    expect(read("chini ek kilo besan do kilo chawal teen kilo")).toEqual([
      ["chini", 1, "kg", "default"],
      ["besan", 2, "kg", "default"],
      ["chawal", 3, "kg", "default"],
    ]);
  });
  it("quantity first", () => {
    expect(read("ek kilo chini do kilo besan teen kilo chawal")).toEqual([
      ["chini", 1, "kg", "default"],
      ["besan", 2, "kg", "default"],
      ["chawal", 3, "kg", "default"],
    ]);
  });
  it("mixed: the price stays with ITS item", () => {
    const items = parseUtterance("chini do kilo chawal 90 rupay besan ek kilo 96 rupay kilo", SEED_PARSER_CATALOG)!;
    expect(items.map((i) => [i.spokenName, i.qty, i.priceType, i.total])).toEqual([
      ["chini", 2, "default", 9000],
      ["chawal", null, "total", 9000],
      ["besan", 1, "rate", 9600],
    ]);
  });
  it("an ambiguous order is not read by rule at all", () => {
    expect(parseUtterance("1 किलो मूंग दाल 96 किलो 1 किलो बर्बटी दाल 88 किलो", SEED_PARSER_CATALOG)).toBeNull();
    expect(parseUtterance("कि एक किलो चीनी दो किलो चावल 90 रुपए", SEED_PARSER_CATALOG)).toBeNull();
  });
});
