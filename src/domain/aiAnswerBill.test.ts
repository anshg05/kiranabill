import { describe, expect, it } from "vitest";
import { aiAnswerBill } from "./aiAnswerBill";
import type { ParsedItem } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-385 step 1 (owner, 10 Nov 2026; D106 item 3, doc 25): the bill shows which prices OUR CODE filled - never spoken for that line -
// so the shopkeeper sees them: a shop price for an unsaid price ("shop_price"), or a repeated item's earlier spoken price ("repeat").
// Reported apart from the lines: the lines themselves do not change (aiAnswerBillMove.test.ts's fingerprints).

const ai = (spokenName: string, qty: number | null, unit: string, priceType: ParsedItem["priceType"], rate: number | null, total: number | null): ParsedItem => ({
  spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty, unit, rate, rateUnit: rate === null ? null : unit, total, priceType,
});

describe("aiAnswerBill - which prices our code filled", () => {
  it("a shop price for an unsaid price is 'shop_price'; a spoken price is not marked", () => {
    const b = aiAnswerBill("2 किलो चीनी, 1 किलो चावल 60 रुपए किलो", [ai("चीनी", 2, "kg", "default", null, null), ai("चावल", 1, "kg", "rate", 6000, null)], SEED_PARSER_CATALOG);
    expect(b.lines).toHaveLength(2);
    expect(b.lines[0]!.item.rate).not.toBeNull(); // the seed catalog's sugar price
    expect(b.filled).toEqual([{ index: 0, kind: "shop_price" }]);
  });

  it("a repeated item with no price said takes the earlier spoken price: 'repeat' (D106 item 3)", () => {
    const t = "1 बंसल तेल 1 लीटर 150 रुपए, 1 बंसल तेल 1 लीटर";
    const b = aiAnswerBill(t, [ai("बंसल तेल", 1, "liter", "total", null, 15000), ai("बंसल तेल", 1, "liter", "default", null, null)], SEED_PARSER_CATALOG);
    expect(b.lines.map((l) => l.item.total)).toEqual([15000, 15000]);
    expect(b.filled).toEqual([{ index: 1, kind: "repeat" }]);
  });

  it("the marks follow the LINES: an empty answer item that is dropped does not shift them", () => {
    const b = aiAnswerBill("कुछ, 2 किलो चीनी", [ai("कुछ", null, "", "unknown", null, null), ai("चीनी", 2, "kg", "default", null, null)], SEED_PARSER_CATALOG);
    expect(b.lines.map((l) => l.item.spokenName)).toEqual(["चीनी"]);
    expect(b.filled).toEqual([{ index: 0, kind: "shop_price" }]);
  });

  it("a repeat AFTER a dropped empty item is still found: the mark uses the line's own source item", () => {
    const t = "कुछ, 1 बंसल तेल 1 लीटर 150 रुपए, 1 बंसल तेल 1 लीटर";
    const b = aiAnswerBill(t, [ai("कुछ", null, "", "unknown", null, null), ai("बंसल तेल", 1, "liter", "total", null, 15000), ai("बंसल तेल", 1, "liter", "default", null, null)], SEED_PARSER_CATALOG);
    expect(b.lines).toHaveLength(2);
    expect(b.filled).toEqual([{ index: 1, kind: "repeat" }]);
  });

  it("a line with no price at all (Price needed) is not 'filled'", () => {
    const b = aiAnswerBill("2 किलो अनजाना सामान", [ai("अनजाना सामान", 2, "kg", "default", null, null)], SEED_PARSER_CATALOG);
    expect(b.lines[0]!.item.total).toBeNull();
    expect(b.filled).toEqual([]);
  });
});
