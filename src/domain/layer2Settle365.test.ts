import { describe, expect, it } from "vitest";
import type { ParsedItem } from "./grammar";
import { settleLayer2Items } from "./layer2";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-366 (owner, 30 Oct 2026; A38): Gemini returned "500 g of शक्कर at 5600 (a KILO price)" with its own total 2800. The settle step read the rate
// "per the spoken unit" and billed 500 x 5600 = Rs 28,000. Gemini's total is still never trusted - but when it equals EXACTLY the
// per-kilo reading (and not the literal one), that is the reading that was meant.

const item = (over: Partial<ParsedItem>): ParsedItem => ({ spokenName: "शक्कर", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 500, unit: "gm", rate: 5600, rateUnit: "gm", total: 2800, priceType: "rate", ...over });
const settle = (over: Partial<ParsedItem>) => settleLayer2Items([item(over)], SEED_PARSER_CATALOG).lines[0]!.item;

describe("a gram quantity with a per-kilo rate (Gemini's own total decides between the two exact readings)", () => {
  it("A38: 500 g, rate 5600, Gemini's total 2800 = Rs 28 - the rate is per KILO", () => {
    expect(settle({})).toMatchObject({ qty: 500, unit: "gm", rate: 5600, rateUnit: "kg", total: 2800, priceType: "rate" });
  });
  it("millilitres against a per-litre rate", () => {
    expect(settle({ spokenName: "तेल", catalogId: "33", qty: 250, unit: "ml", rate: 12000, total: 3000 })).toMatchObject({ rate: 12000, rateUnit: "liter", total: 3000 });
  });
  it("a genuine per-GRAM rate (Gemini's total is the literal one) stays literal", () => {
    expect(settle({ qty: 500, unit: "gm", rate: 5, total: 2500 })).toMatchObject({ rate: 5, rateUnit: "gm", total: 2500 });
  });
  it("Gemini's total matches NEITHER reading -> never trusted: the literal reading, as before (the HIGH checks still warn)", () => {
    expect(settle({ total: 99999 })).toMatchObject({ rate: 5600, rateUnit: "gm", total: 2_800_000 });
  });
  it("kg and other units are untouched", () => {
    expect(settle({ qty: 2, unit: "kg", rate: 5600, rateUnit: "kg", total: 11200 })).toMatchObject({ rateUnit: "kg", total: 11200 });
  });
});
