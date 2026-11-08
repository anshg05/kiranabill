import { describe, expect, it } from "vitest";
import { CORRECTION_MARKERS, REMOVAL_MARKERS, aiAnswerExemptNumbers, aiAnswerQuantities, aiAnswerRateUnits, aiAnswerRepeatPrices } from "./aiAnswerNumbers";
import type { ParsedItem } from "./grammar";
import type { SettledLine } from "./layer2";
import { checkLayer2AgainstSpoken } from "./layer2Check";
import { checkLayer2NumberOrder, evaluateReviewFlags } from "./reviewFlags";
import { SEED_PARSER_CATALOG } from "./seedCatalog";

// KB-380 (doc 25 §4, owner 7 Nov 2026): six checks adapted for an AI-READ bill ("ai-answer") - the false alarms the regression set showed
// go, every real case still warns. Without the option ("spoken": Layer 1, the Sarvam path) every check is exactly as before.
// The fixtures are the recordings' own transcripts and lines (nocat-D103, results-nocat-2026-11-06.json).

const entries = SEED_PARSER_CATALOG.entries;
const ai = (spokenName: string, qty: number | null, unit: string, priceType: ParsedItem["priceType"], rate: number | null, total: number | null, catalogId: string | null = null): ParsedItem => ({
  spokenName, catalogId, isCustom: catalogId === null, matchStatus: catalogId === null ? "none" : "matched", qty, unit, rate, rateUnit: rate === null ? null : unit, total, priceType,
});
const codes = (transcript: string, items: ParsedItem[], source: "spoken" | "ai-answer") => evaluateReviewFlags(transcript, items, entries, undefined, source).filter((f) => f.severity === "HIGH").map((f) => f.code);

const A59 = "1 किलो आटा ₹40 किलो 5 किलो आटा ₹175 2 किलो चीनी ₹56 किलो नहीं नहीं 3 किलो चीनी ₹56 किलो 5 किलो गेहूं ₹34 किलो 4 किलो चना दाल ₹92 किलो नहीं नहीं 3 किलो करो उसको चना दाल";
const A59_LINES = [ai("आटा", 1, "kg", "rate", 4000, 4000), ai("आटा", 5, "kg", "total", null, 17500), ai("चीनी", 3, "kg", "rate", 5600, 16800), ai("गेहूं", 5, "kg", "rate", 3400, 17000), ai("चना दाल", 3, "kg", "rate", 9200, 27600)];
const A55 = "चना दाल 1 किलो तूर दाल 1 किलो बंसल तेल 1 लीटर एक पैकेट फॉर्च्यून तेल 1 लीटर मूंग दाल 1 किलो";
const A55_LINES = [ai("चना दाल", 1, "kg", "unknown", null, null), ai("तूर दाल", 1, "kg", "unknown", null, null), ai("बंसल तेल", 1, "liter", "unknown", null, null), ai("फॉर्च्यून तेल", 1, "liter", "unknown", null, null), ai("मूंग दाल", 1, "kg", "unknown", null, null)];
const A36 = "आधा किलो मैदा पैकेट ₹22, एक बंसल तेल पैकेट ₹140, एक बंसल 1 लीटर ₹150";
const A36_LINES = [ai("मैदा पैकेट", 0.5, "kg", "total", null, 2200), ai("बंसल तेल पैकेट", 1, "packet", "total", null, 14000), ai("बंसल", 1, "liter", "total", null, 15000)];
const A40 = "गेहूं 10 किलो ₹340 गेहूं 10 किलो ₹34 किलो वाला";
const A40_LINES = [ai("गेहूं", 10, "kg", "rate", 3400, 34000)];

describe("1. number_dropped / qty_dropped - a spoken correction and a pack size are not 'dropped' on an AI answer", () => {
  it("A59: the numbers a 'नहीं नहीं' / 'करो उसको' correction replaced are not dropped (and still are on the spoken path)", () => {
    expect(codes(A59, A59_LINES, "ai-answer")).not.toContain("number_dropped");
    expect(codes(A59, A59_LINES, "ai-answer")).not.toContain("qty_dropped");
    expect(codes(A59, A59_LINES, "spoken")).toContain("number_dropped");
  });

  it("A55 / A36: the pack size beside a count ('1 लीटर एक पैकेट', 'एक बंसल 1 लीटर') is not dropped", () => {
    expect(codes(A55, A55_LINES, "ai-answer")).not.toContain("number_dropped");
    expect(codes(A36, A36_LINES, "ai-answer")).not.toContain("number_dropped");
    expect(codes(A55, A55_LINES, "spoken")).toContain("number_dropped");
  });

  it("A40 (a real case): the merged second 'गेहूं 10 किलो' still warns - a price between the two numbers is no pack size", () => {
    expect(codes(A40, A40_LINES, "ai-answer")).toContain("number_dropped");
  });

  it("a whole item spoken AFTER a correction and missing from the bill still warns", () => {
    expect(codes("2 किलो चीनी नहीं नहीं 3 किलो चीनी 5 किलो चावल", [ai("चीनी", 3, "kg", "unknown", null, null)], "ai-answer")).toContain("number_dropped");
  });

  it("owner (7 Nov 2026): an UNKNOWN correction form is never exempted - it warns", () => {
    const t = "2 किलो चीनी ₹56 किलो गलत 3 किलो चीनी ₹56 किलो";
    expect(codes(t, [ai("चीनी", 3, "kg", "rate", 5600, 16800)], "ai-answer")).toContain("number_dropped");
    expect(codes(t.replace("गलत", "नहीं नहीं"), [ai("चीनी", 3, "kg", "rate", 5600, 16800)], "ai-answer")).not.toContain("number_dropped");
  });

  it("the correction words live in ONE list (doc 25 §2: extendable)", () => {
    expect(CORRECTION_MARKERS).toEqual(["नहीं नहीं", "nahi nahi", "sorry", "करो उसको"]);
    expect(aiAnswerExemptNumbers("2 किलो चीनी sorry 3 किलो चीनी", [ai("चीनी", 3, "kg", "unknown", null, null)])).toContain(2);
  });
});

describe("2. number_misaligned - the implied 1 is excused per line on an AI answer", () => {
  const A58 = "मूंग दाल 1 किलो 96 रुपए, चना दाल 1 किलो 92 रुपए, बरबटी दाल 88 रुपए किलो";
  const A58_LINES = [ai("मूंग दाल", 1, "kg", "total", null, 9600), ai("चना दाल", 1, "kg", "total", null, 9200), ai("बरबटी दाल", 1, "kg", "rate", 8800, 8800)];
  it("A58: 'बरबटी दाल 88 रुपए किलो' = 1 kg is not misaligned (it still is on the spoken path)", () => {
    expect(checkLayer2NumberOrder(A58, A58_LINES, "ai-answer")).toBeNull();
    expect(checkLayer2NumberOrder(A58, A58_LINES, "spoken")?.code).toBe("number_misaligned");
  });

  it("A54 (a real case): 'फटका' reusing तुवर दाल's ₹150 is still misaligned", () => {
    const A54 = "तुवर दाल 1 किलो फटका ₹150 किलो मूंग दाल 1 किलो ₹96 किलो";
    const lines = [ai("तुवर दाल", 1, "kg", "rate", 15000, 15000), ai("फटका", 1, "kg", "rate", 15000, 15000), ai("मूंग दाल", 1, "kg", "rate", 9600, 9600)];
    expect(checkLayer2NumberOrder(A54, lines, "ai-answer")?.code).toBe("number_misaligned");
  });
});

describe("3. layer2_disagrees - on an AI answer only when the MONEY differs", () => {
  const settled = (item: ParsedItem): SettledLine => ({ item, displayName: item.spokenName });
  it("A57: Layer 1's '5 piece ₹150' against the AI's '5 packet ₹150' (the same money) is no disagreement on an AI answer", () => {
    const heard = ai("पारले जी बिस्किट", 5, "piece", "total", null, 15000);
    const mine = ai("पारले जी बिस्किट", 5, "packet", "rate", 3000, 15000);
    const parts = [{ text: "5 पीस पारले जी बिस्किट 30 वाला", item: heard }];
    expect(checkLayer2AgainstSpoken(parts, [settled(mine)], "ai-answer").flags).toEqual([]);
    expect(checkLayer2AgainstSpoken(parts, [settled(mine)], "spoken").flags.map((f) => f.code)).toEqual(["layer2_disagrees"]);
  });

  it("A38 (a real case): ₹28 heard, ₹28,000 written - still a disagreement", () => {
    const heard = ai("शक्कर", 500, "gm", "total", null, 2800);
    const mine = ai("शक्कर", 500, "gm", "rate", 5600, 2800000);
    expect(checkLayer2AgainstSpoken([{ text: "500 ग्राम शक्कर ₹56 किलो", item: heard }], [settled(mine)], "ai-answer").flags.map((f) => f.code)).toEqual(["layer2_disagrees"]);
  });
});

describe("4. number_unconsumed - not run on an AI answer (number_dropped is the net)", () => {
  it("A36: not raised on an AI answer; still raised on the spoken path", () => {
    expect(codes(A36, A36_LINES, "ai-answer")).not.toContain("number_unconsumed");
    expect(codes(A36, A36_LINES, "spoken")).toContain("number_unconsumed");
  });
});

describe("KB-381: the quantity check on an AI answer (doc 25 §3.2) - in the transcript in order, or the owner's implied 1", () => {
  const A57_NO_COMMA = "रिन साबुन 10 वाली 5 पीस पारले जी बिस्किट 30 वाला 5 पैकेट बंसल तेल पाउच 1 पैकेट ₹140 फेना साबुन 10 वाली 5 पीस";
  const A57_COMMA = "रिन साबुन 10 वाली 5 पीस, पारले जी बिस्किट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट ₹140, फेना साबुन 10 वाली 5 पीस";
  const A57_ITEMS = [ai("रिन साबुन", 5, "piece", "rate", 1000, null), ai("पारले जी बिस्किट", 5, "packet", "rate", 3000, null), ai("बंसल तेल पाउच", 1, "packet", "total", null, 14000), ai("फेना साबुन", 5, "piece", "rate", 1000, null)];

  it("A57: Rin and Fena keep their 5 pieces whether or not the transcript has a comma", () => {
    for (const t of [A57_NO_COMMA, A57_COMMA]) expect(aiAnswerQuantities(t, A57_ITEMS).map((i) => i.qty)).toEqual([5, 5, 1, 5]);
  });

  it("a quantity spoken nowhere is dropped (a rate line then needs its quantity - never a number nobody said)", () => {
    expect(aiAnswerQuantities("चावल 60 रुपए किलो", [ai("चावल", 3, "kg", "rate", 6000, 18000)])[0]).toMatchObject({ qty: null, total: null });
  });

  it("A49 (owner): an invented 1 on a total-only line is dropped - qty null, the spoken Rs 200 kept (D47), no warning", () => {
    const t = "रिफाइंड सोयाबीन ऑयल ₹170 ग्राउंडनट ऑइल ₹200";
    const items = [ai("रिफाइंड सोयाबीन ऑयल", null, "", "total", null, 17000), ai("ग्राउंडनट ऑइल", 1, "", "total", null, 20000)];
    const fixed = aiAnswerQuantities(t, items);
    expect(fixed[1]).toMatchObject({ qty: null, unit: "", priceType: "total", total: 20000 });
    expect(codes(t, fixed, "ai-answer")).toEqual([]);
  });

  it("D105: a per-kilo price with no quantity = 1 kg; 'X वाला' with no quantity = 1 piece (A42 'दंतकांति 60 वाला')", () => {
    expect(aiAnswerQuantities("बरबटी दाल 88 रुपए किलो", [ai("बरबटी दाल", null, "kg", "rate", 8800, null)])[0]).toMatchObject({ qty: 1, unit: "kg" });
    expect(aiAnswerQuantities("दंतकांति 60 वाला", [ai("दंतकांति", null, "piece", "rate", 6000, null)])[0]).toMatchObject({ qty: 1, unit: "piece" });
  });

  it("owner (8 Nov 2026): 'वाला' that belongs to a NAME is no price - 'पतंजलि पेस्ट बड़ा वाला ₹110' stays a total with no quantity", () => {
    expect(aiAnswerQuantities("पतंजलि पेस्ट बड़ा वाला ₹110", [ai("पतंजलि पेस्ट बड़ा वाला", null, "piece", "total", null, 11000)])[0]).toMatchObject({ qty: null, total: 11000 });
    // and a rate the words do not call per-kilo or "वाला" gets no 1
    expect(aiAnswerQuantities("पतंजलि पेस्ट बड़ा वाला ₹110", [ai("पतंजलि पेस्ट बड़ा वाला", null, "piece", "rate", 11000, null)])[0]!.qty).toBeNull();
  });

  it("an implied 1 does not take another line's spoken 1 (A54: 'फटका ₹150 किलो' must leave मूंग दाल its '1 किलो')", () => {
    const t = "तुवर दाल 1 किलो फटका ₹150 किलो मूंग दाल 1 किलो ₹96 किलो";
    const items = [ai("तुवर दाल", 1, "kg", "rate", 15000, 15000), ai("फटका", 1, "kg", "rate", 15000, 15000), ai("मूंग दाल", 1, "kg", "rate", 9600, 9600)];
    expect(aiAnswerQuantities(t, items).map((i) => i.qty)).toEqual([1, 1, 1]);
  });
});

describe("KB-382 (a): the price unit is read from the spoken words, whatever the AI labelled (doc 25 §3.3)", () => {
  it("A38: 500 g at '₹56 किलो' labelled per gram becomes a per-kilo rate - the total our code computes is Rs 28", () => {
    const fixed = aiAnswerRateUnits("500 ग्राम शक्कर ₹56 किलो", [ai("शक्कर", 500, "gm", "rate", 5600, null)]);
    expect(fixed[0]).toMatchObject({ qty: 500, unit: "gm", rate: 5600, total: 2800 });
  });

  it("'56 रुपए किलो' and '56 का किलो' too; a kg line and a gram line with no 'किलो' after the price are left alone", () => {
    expect(aiAnswerRateUnits("500 ग्राम शक्कर 56 रुपए किलो", [ai("शक्कर", 500, "gm", "rate", 5600, null)])[0]!.total).toBe(2800);
    expect(aiAnswerRateUnits("500 ग्राम शक्कर 56 का किलो", [ai("शक्कर", 500, "gm", "rate", 5600, null)])[0]!.total).toBe(2800);
    expect(aiAnswerRateUnits("2 किलो शक्कर ₹56 किलो", [ai("शक्कर", 2, "kg", "rate", 5600, null)])[0]!.total).toBeNull();
    expect(aiAnswerRateUnits("500 ग्राम शक्कर ₹56", [ai("शक्कर", 500, "gm", "rate", 5600, null)])[0]!.total).toBeNull();
  });
});

describe("KB-383 (KB-367; owner 9 Nov 2026): 'हटा दो' WITH an item named removes it; WITHOUT one, nothing is removed and the last line asks", () => {
  const A41 = "2 किलो चना दाल, 2 किलो चना दाल, लास्ट वाला चना दाल हटा दो, 1 किलो बेसन, 1 किलो आटा, 1 लीटर बंसल तेल 150 रुपए";
  const A41_LINES = [ai("चना दाल", 2, "kg", "default", null, null), ai("बेसन", 1, "kg", "default", null, null), ai("आटा", 1, "kg", "default", null, null), ai("बंसल तेल", 1, "liter", "total", null, 15000)];

  it("A41: the removed second '2 किलो चना दाल' is not a dropped number (the item was named)", () => {
    expect(codes(A41, A41_LINES, "ai-answer")).not.toContain("number_dropped");
    expect(codes(A41, A41_LINES, "ai-answer")).not.toContain("removal_unclear");
  });

  it("a 'हटा दो' with NO item named never exempts anything - a line the AI dropped still warns - and the last line asks 'हटाना है?'", () => {
    const t = "2 किलो चीनी, 1 किलो चावल, हटा दो";
    const removedByAi = codes(t, [ai("चीनी", 2, "kg", "default", null, null)], "ai-answer");
    expect(removedByAi).toContain("number_dropped");
    const kept = evaluateReviewFlags(t, [ai("चीनी", 2, "kg", "default", null, null), ai("चावल", 1, "kg", "default", null, null)], entries, undefined, "ai-answer");
    expect(kept.find((f) => f.code === "removal_unclear")).toMatchObject({ severity: "HIGH", itemIndex: 1 });
  });

  it("'सब हटा दो' / 'लास्ट वाला हटा दो' name no item - they ask, never remove", () => {
    for (const t of ["2 किलो चीनी सब हटा दो", "2 किलो चीनी लास्ट वाला हटा दो"]) expect(codes(t, [ai("चीनी", 2, "kg", "default", null, null)], "ai-answer")).toContain("removal_unclear");
  });

  it("the removal words are ONE extendable list", () => {
    expect(REMOVAL_MARKERS).toEqual(["हटा दो", "निकाल दो", "cancel"]);
  });
});

describe("KB-383 follow-up (owner, 9 Nov 2026): a number the line billed as its RATE is not a dropped quantity on an AI answer", () => {
  const A04 = "2 किलो चावल 90 किलो 1 किलो मूंग दाल 96 किलो"; // the price said without "₹" / "रुपए"
  const A04_LINES = [ai("चावल", 2, "kg", "rate", 9000, 18000), ai("मूंग दाल", 1, "kg", "rate", 9600, 9600)];
  it("A04: '90 किलो' billed as Rs 90 a kilo is no dropped quantity (it still is on the spoken path)", () => {
    expect(codes(A04, A04_LINES, "ai-answer")).not.toContain("qty_dropped");
    expect(codes(A04, A04_LINES, "spoken")).toContain("qty_dropped");
  });

  it("a real case: a quantity said and billed nowhere still warns", () => {
    expect(codes("5 किलो चावल 90 किलो", [ai("चावल", null, "kg", "rate", 9000, null)], "ai-answer")).toContain("qty_dropped");
  });
});

describe("KB-383 follow-up (owner, 9 Nov 2026): a repeated item with no price said takes the price said for the SAME name earlier in the bill", () => {
  const A39 = "1 बंसल तेल पैकेट 1 लीटर ₹150 1 बंसल तेल पैकेट 1 लीटर";
  const first = ai("बंसल तेल पैकेट", 1, "liter", "total", null, 15000);
  const repeat = ai("बंसल तेल पैकेट", 1, "liter", "unknown", null, null);

  it("A39: the second 'बंसल तेल पैकेट 1 लीटर' takes Rs 150 from the first - and the 'said twice or heard twice?' warning still shows", () => {
    const filled = aiAnswerRepeatPrices([first, repeat]);
    expect(filled[1]).toMatchObject({ priceType: "total", total: 15000, qty: 1, unit: "liter" });
    const f = evaluateReviewFlags(A39, filled, entries, undefined, "ai-answer");
    expect(f.find((x) => x.code === "duplicate_line")?.itemIndex).toBe(1);
    expect(checkLayer2NumberOrder(A39, filled, "ai-answer")).toBeNull(); // Rs 150 said once is not a misaligned number for the repeat
  });

  it("only the SAME name, only an EARLIER spoken price; a shop price (nothing said) is never copied; a later line never lends", () => {
    expect(aiAnswerRepeatPrices([first, ai("बंसल तेल", 1, "liter", "unknown", null, null)])[1]!.total).toBeNull();
    expect(aiAnswerRepeatPrices([repeat, first])[0]!.total).toBeNull();
    expect(aiAnswerRepeatPrices([ai("शक्कर", 2, "kg", "default", null, null), ai("शक्कर", 2, "kg", "default", null, null)])[1]).toMatchObject({ priceType: "default", total: null });
  });

  it("a TOTAL is copied only to the same quantity and unit; a RATE is copied and our code multiplies it by the repeat's own quantity", () => {
    const total = ai("चीनी", 2, "kg", "total", null, 9000);
    expect(aiAnswerRepeatPrices([total, ai("चीनी", 5, "kg", "unknown", null, null)])[1]!.total).toBeNull(); // never Rs 90 for 5 kg
    const rate = ai("चीनी", 2, "kg", "rate", 4500, 9000);
    expect(aiAnswerRepeatPrices([rate, ai("चीनी", 5, "kg", "unknown", null, null)])[1]).toMatchObject({ priceType: "rate", rate: 4500 });
  });
});

describe("6. duplicate_line - compares the SPOKEN names on an AI answer", () => {
  it("two different names our fill priced from one catalog product (A40: बंसल, मदर डिलाइट) are not duplicates on an AI answer", () => {
    const lines = [ai("बंसल तेल", 1, "liter", "default", 15000, 15000, "33"), ai("मदर डिलाइट तेल", 1, "liter", "default", 15000, 15000, "33")];
    expect(codes("बंसल तेल 1 लीटर मदर डिलाइट तेल 1 लीटर", lines, "ai-answer")).not.toContain("duplicate_line");
  });

  it("a real repeat ('2 किलो शक्कर, 2 किलो शक्कर', D103 item 2) still warns", () => {
    const lines = [ai("शक्कर", 2, "kg", "default", 4500, 9000, "27"), ai("शक्कर", 2, "kg", "default", 4500, 9000, "27")];
    expect(codes("2 किलो शक्कर, 2 किलो शक्कर", lines, "ai-answer")).toContain("duplicate_line");
  });
});
