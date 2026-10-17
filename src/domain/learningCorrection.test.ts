import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog";
import { EMPTY_LEARNING_STATE, learnFromBill, type LearnLine } from "./learning";

// KB-336 (D83): a voice line whose product the shopkeeper CHANGED is a strong correction - it teaches spoken name -> the
// chosen product (08 section 2's original intent). An edited line with the SAME product still teaches nothing, a line
// added by hand never teaches, and a phrase already an exact alias of the chosen product has nothing to teach.

const entry = (id: string, displayName: string, aliases: string[] = [displayName]): CatalogEntry => ({ id, displayName, aliases, unit: "packet", suggestedPricePaise: 1000, isActive: true, sourceCategory: "", guardCategory: "other" });
const catalog = [entry("p-new", "Parle-G"), entry("p-old", "Tide")];
const line = (over: Partial<LearnLine> = {}): LearnLine => ({ lineNo: 1, shopProductId: "p-new", spokenName: "pale ji", displayName: "Parle-G", unit: "packet", ratePaise: null, rateUnit: null, source: "fastpath", wasEdited: true, originalProductId: "p-old", ...over });
const learn = (lines: LearnLine[]) => learnFromBill(EMPTY_LEARNING_STATE, { lines, discarded: [] }, catalog, Date.now()).decisions;

describe("a corrected line teaches the alias", () => {
  it("fast-path line, product changed: alias_confirmed to the CHOSEN product, source 'correction', remembering where it came from", () => {
    expect(learn([line()])).toEqual([expect.objectContaining({ kind: "alias_confirmed", alias: "pale ji", shopProductId: "p-new", sourceLayer: "correction", correctedFrom: "p-old" })]);
  });
  it("a Gemini line corrected is a correction too (the shopkeeper's own choice is the strongest signal)", () => {
    expect(learn([line({ source: "voice" })])[0]).toMatchObject({ sourceLayer: "correction" });
  });
  it("an unknown spoken name (no product at first) corrected to a real product teaches it", () => {
    expect(learn([line({ originalProductId: null })])[0]).toMatchObject({ kind: "alias_confirmed", shopProductId: "p-new", correctedFrom: null });
  });
  it("a quantity edit as well as the correction does not stop it", () => {
    expect(learn([line({ wasEdited: true })])).toHaveLength(1);
  });
});

describe("what still teaches nothing", () => {
  it("an edited line whose product did NOT change (old rule, KB-307 decision 4)", () => {
    expect(learn([line({ originalProductId: undefined })])).toEqual([]);
  });
  it("a line added by hand, even when its product 'changed'", () => {
    expect(learn([line({ source: "manual" })])).toEqual([]);
  });
  it("a phrase that is already an exact name or alias of the chosen product", () => {
    expect(learn([line({ spokenName: "parle-g" })])).toEqual([]);
    expect(learn([line({ spokenName: "" })])).toEqual([]);
  });
});
