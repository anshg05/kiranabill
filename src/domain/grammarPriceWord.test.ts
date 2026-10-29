import { describe, expect, it } from "vitest";
import { diagnoseUtterance, parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-361 (found by its own benchmark, 29 Oct 2026): when a price was SAID but one word of it is not understood, that word fell into the
// product name ("चावल अठासी रुपए") and the rest was billed as if it were the whole price - "चार किलो चावल दो सौ अठासी रुपए" read as
// Rs 200 (not 288), and "एक किलो मूंग दाल चैन रुपए किलो" silently took the CATALOG price instead of the spoken one. A currency word
// inside a product name means a price nobody understood: the piece is not read by rule (Layer 2 or by hand), never guessed.

const parse = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG);

describe("a currency word inside the name = a price nobody understood", () => {
  it.each([
    "4 किलो चावल दो सौ अठाली रुपए", // 'अठाली' is not 88: Rs 200 must never be billed
    "1 किलो उडद मुगर एक सौ अठाली रुपए किलो",
    "एक किलो मूंग दाल चैन रुपए किलो", // the catalog price must never stand in for a spoken one
    "2 किलो चीनी छियाणवे रुपए किलो",
    "2 kilo chini xyzzy rupay kilo",
    "1 kilo moong daal chain rupay",
  ])("%s -> not read by rule", (t) => {
    expect(parse(t)).toBeNull();
    expect(diagnoseUtterance(t, SEED_PARSER_CATALOG).hit).toBe(false);
  });
  it("a price that IS understood is untouched", () => {
    expect(parse("4 किलो चावल दो सौ अठासी रुपए")![0]).toMatchObject({ qty: 4, total: 28800, priceType: "total" });
    expect(parse("2 kilo chini 56 rupay")![0]).toMatchObject({ qty: 2, total: 5600 });
    expect(parse("एक किलो मूंग दाल")![0]).toMatchObject({ qty: 1, priceType: "default" }); // no price said: the catalog price is right
  });
  it("one unread price word loses only its piece in a multi-item order", () => {
    const t = "1 किलो चीनी 56 रुपए किलो 1 किलो चावल अठाली रुपए किलो";
    expect(parse(t)).toBeNull();
  });
});
