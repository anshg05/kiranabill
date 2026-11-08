import { describe, expect, it } from "vitest";
import { parseUtterance, type ParsedItem } from "./grammar";
import { billFlags, editRate, pendingChecks, type PlacedFlag } from "./billEdit";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { canFinalize, evaluateReviewFlags } from "./reviewFlags";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-382 (D103 item 3, D105; owner 8-9 Nov 2026): a line wildly out of proportion can never be billed - a flag a "Theek hai" cannot clear
// (severity BLOCK, code total_out_of_proportion). It fires on a line READ FROM SPEECH when:
//   (b) its total is more than 100x what its spoken rate and quantity give (the rate's unit read from the words), or 100x quantity x the
//       shop price of its product;
//   (c) it is priced PER GRAM / PER ML and "ग्राम" / "ml" was not said right after the price (kirana rates are per kg, litre, piece, packet).
// (d) A line with NO reference (no unit word after the price, no shop price) over Rs 10,000 gets a normal, clearable HIGH check.
// A spoken total is never compared. A line the shopkeeper typed (no transcript) is his statement: none of these fire on it.

const entries = SEED_PARSER_CATALOG.entries;
const line = (over: Partial<ParsedItem>): ParsedItem => ({ spokenName: "शक्कर", catalogId: null, isCustom: true, matchStatus: "none", qty: 500, unit: "gm", rate: 5600, rateUnit: "gm", total: 2_800_000, priceType: "rate", ...over });
const flagsOf = (t: string, it: ParsedItem, source: "spoken" | "ai-answer" = "ai-answer") => evaluateReviewFlags(t, [it], entries, undefined, source);
const blocked = (t: string, it: ParsedItem, source: "spoken" | "ai-answer" = "ai-answer") => flagsOf(t, it, source).some((f) => f.code === "total_out_of_proportion" && f.severity === "BLOCK");

describe("(b) more than 100x what the spoken rate or the shop price gives", () => {
  it("A38: 500 g at '₹56 किलो' billed Rs 28,000 (Rs 28 by the words) is blocked - on the AI path and on the spoken path", () => {
    expect(blocked("500 ग्राम शक्कर ₹56 किलो", line({}))).toBe(true);
    expect(blocked("500 ग्राम शक्कर ₹56 किलो", line({}), "spoken")).toBe(true);
  });

  it("the shop price: 2 kg चीनी at a spoken Rs 9,000 a kilo (Rs 18,000; the shop's Rs 45 a kilo gives Rs 90) is blocked", () => {
    expect(blocked("2 किलो चीनी 9000 रुपए किलो", line({ spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: 900_000, rateUnit: "kg", total: 1_800_000 }))).toBe(true);
  });

  it("the right A38 line (Rs 28) and a price 5.6x the shop's (A34 'तेल' Rs 140) are not blocked", () => {
    expect(blocked("500 ग्राम शक्कर ₹56 किलो", line({ rateUnit: "kg", total: 2_800 }))).toBe(false);
    expect(blocked("तेल एक पैकेट 140 वाला", line({ spokenName: "तेल", catalogId: "33", qty: 1, unit: "packet", rate: 14_000, rateUnit: "packet", total: 14_000 }))).toBe(false);
  });

  it("a SPOKEN total is never compared - it is the shopkeeper's statement", () => {
    expect(blocked("500 ग्राम शक्कर 28000 रुपए", line({ rate: null, rateUnit: null, priceType: "total" }))).toBe(false);
  });
});

describe("(c) priced per gram / per ml without 'ग्राम' after the price", () => {
  it("'250 ग्राम जीरा 400 रुपये' as Rs 400 a gram (Rs 1,00,000) is blocked - even with no catalog product and no 'किलो' said", () => {
    expect(blocked("250 ग्राम जीरा 400 रुपये", line({ spokenName: "xyz जीरा", qty: 250, rate: 40_000, total: 10_000_000 }))).toBe(true);
  });

  it("a per-gram price the shopkeeper SAID ('5 ग्राम केसर 300 रुपये ग्राम') stands", () => {
    expect(blocked("5 ग्राम केसर 300 रुपये ग्राम", line({ spokenName: "केसर", qty: 5, rate: 30_000, total: 150_000 }))).toBe(false);
  });
});

describe("(d) no reference at all and over Rs 10,000 - a normal, clearable HIGH check", () => {
  const big = line({ spokenName: "abcd", qty: 2, unit: "piece", rate: 600_000, rateUnit: "piece", total: 1_200_000 });
  it("2 x Rs 6,000 of a product the catalog does not know, with no unit word after the price: HIGH, not BLOCK", () => {
    const f = flagsOf("2 abcd 6000 रुपए", big);
    expect(f.find((x) => x.code === "large_total_no_reference")?.severity).toBe("HIGH");
    expect(f.some((x) => x.severity === "BLOCK")).toBe(false);
  });

  it("under Rs 10,000, or with a unit word after the price ('6000 वाला'), it does not fire", () => {
    expect(flagsOf("2 abcd 4000 रुपए", line({ ...big, rate: 400_000, total: 800_000 })).some((x) => x.code === "large_total_no_reference")).toBe(false);
    expect(flagsOf("2 abcd 6000 वाला", big).some((x) => x.code === "large_total_no_reference")).toBe(false);
  });
});

describe("owner (9 Nov 2026): an EDITED or hand-typed line keeps (b) against the SHOP price and (c); only the spoken-words reference is gone", () => {
  // 2 kg चीनी at a spoken Rs 9,000 a kilo (Layer 1: catalog Chini, Rs 45 a kilo) - blocked; then the shopkeeper edits the rate
  const T = "2 किलो चीनी 9000 रुपए किलो";
  const spoken = parseUtterance(T, SEED_PARSER_CATALOG)![0]!;
  const after = (rate: string): PlacedFlag[] => {
    const edited = editRate(spoken, rate);
    if (!edited.ok) throw new Error(edited.error);
    const entries2 = [{ id: "l1", utteranceId: 1, item: edited.item, original: spoken }];
    return billFlags(entries2, [{ id: 1, lineIds: ["l1"], flags: evaluateReviewFlags(T, [spoken], entries), transcript: T }], entries);
  };

  it("before the edit: blocked", () => {
    expect(evaluateReviewFlags(T, [spoken], entries).some((f) => f.severity === "BLOCK")).toBe(true);
  });

  it("edited to a still-absurd Rs 9,001 a kilo: STILL blocked (the shop price gives Rs 90)", () => {
    expect(after("9001").some((f) => f.severity === "BLOCK")).toBe(true);
  });

  it("edited to Rs 45 a kilo: the block clears", () => {
    expect(after("45").some((f) => f.severity === "BLOCK")).toBe(false);
  });

  it("a hand-added line far above the shop price is blocked too; a typed AMOUNT (a total) never is", () => {
    const typed = { ...spoken, rate: 900_100, total: 1_800_200 };
    expect(evaluateReviewFlags("", [typed], entries).some((f) => f.severity === "BLOCK")).toBe(true);
    expect(evaluateReviewFlags("", [{ ...typed, rate: null, rateUnit: null, priceType: "total" as const }], entries).some((f) => f.severity === "BLOCK")).toBe(false);
  });

  it("(d) needs the spoken words, so it does not fire on a typed line (the shopkeeper's own number)", () => {
    expect(evaluateReviewFlags("", [line({ spokenName: "abcd", qty: 2, unit: "piece", rate: 600_000, rateUnit: "piece", total: 1_200_000 })], entries).some((f) => f.code === "large_total_no_reference")).toBe(false);
  });
});

describe("the bill-finalise path: a BLOCK flag can never be cleared by Theek hai", () => {
  const block = flagsOf("500 ग्राम शक्कर ₹56 किलो", line({})).find((f) => f.severity === "BLOCK")!;
  const placed: PlacedFlag = { ...block, lineId: "l1", utteranceId: 1, anchorLineId: "l1", transcript: "500 ग्राम शक्कर ₹56 किलो", key: "k1" };

  it("canFinalize refuses it even when acknowledged; pendingChecks still counts it", () => {
    expect(canFinalize([block], new Set([block.id]))).toBe(false);
    expect(pendingChecks([placed], new Set(["k1"]))).toBe(1);
  });

  it("buildFinalBill refuses a bill carrying it, acknowledged or not - nothing becomes a receipt", () => {
    const item = line({});
    const final: FinalLine = { id: "l1", utteranceId: 1, item, original: item, displayName: "शक्कर", source: "voice" };
    const built = buildFinalBill([final], [{ ...placed, acknowledged: true }]);
    expect(built.ok).toBe(false);
  });
});
