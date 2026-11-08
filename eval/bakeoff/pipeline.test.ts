import { describe, expect, it } from "vitest";
import { resolveUtterance } from "../../src/data/voiceBilling.js";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { checksOf } from "../acceptance/compare.js";
import { checkAudioAnswer, d102Fill, fillFromCatalog, flagNotHeardByB, hybridItems, nocatBill } from "./pipeline.js";

// KB-370: candidates C (one audio call: transcript + items) and D (C's items, numbers only if B's ear heard them) get the SAME checks
// a Layer 2 answer gets today.

const shop = SEED_PARSER_CATALOG;
const item = (over: Partial<ParsedItem>): ParsedItem => ({
  spokenName: "चीनी", catalogId: "27", isCustom: false, matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate", ...over,
});

describe("checkAudioAnswer", () => {
  it("gives exactly what the shipped resolver gives when Layer 2 answers the whole order (no drift from the app's checks)", async () => {
    const text = "एक किलो मुँगडाल चैन रुपए किलो"; // Layer 1 reads nothing here (A48): the whole text goes to Layer 2
    const answer = [item({ spokenName: "मुँगडाल", catalogId: null, isCustom: true, matchStatus: "none", qty: 1, rate: 9600, total: 9600 })];
    const shipped = await resolveUtterance(text, { shop, parse: async () => answer });
    expect(shipped.layer).toBe("voice");
    const mine = checkAudioAnswer(text, answer, shop);
    expect(mine.lines.map((l) => l.item)).toEqual(shipped.lines.map((l) => l.item));
    expect(mine.checks).toBe(checksOf(shipped.flags, shipped.lines.length));
    expect(mine.lines[0]!.item.priceType).toBe("unknown"); // the AI's Rs 96 for an unreadable price never reaches the line

  });

  it("a rate that is not in the spoken text never reaches the line - Price needed (KB-366)", () => {
    const r = checkAudioAnswer("दो किलो चीनी", [item({ rate: 4800, total: 9600 })], shop);
    expect(r.lines[0]!.item).toMatchObject({ priceType: "unknown", rate: null, total: null, qty: 2 });
  });

  it("KB-359 check A: Layer 1 read the piece and the AI's numbers differ - they stay, with one Theek hai", () => {
    // Layer 1 reads 2 kg at Rs 45 a kilo (= Rs 90); the AI claims a TOTAL of Rs 45 - a spoken number, so only check A can catch it
    const r = checkAudioAnswer("दो किलो चीनी पैंतालीस रुपए किलो", [item({ priceType: "total", rate: null, rateUnit: null, total: 4500 })], shop);
    expect(r.lines[0]!.item).toMatchObject({ priceType: "total", total: 4500 });
    expect(r.checks).toBe(1);
  });

  it("a spoken rate stays", () => {
    const r = checkAudioAnswer("दो किलो चीनी पैंतालीस रुपए किलो", [item({})], shop);
    expect(r.lines[0]!.item).toMatchObject({ priceType: "rate", rate: 4500, total: 9000 });
  });
});

describe("KB-370 round 2 - Ezy-style candidates", () => {
  it("d102Fill: a shop price stays only when the SAID name clearly matches that one product; otherwise Price needed", () => {
    const [kept, dropped] = d102Fill([item({ spokenName: "चीनी", catalogId: "27", rate: null, rateUnit: null, total: null, priceType: "default" }), item({ spokenName: "पोपट दाल", catalogId: "21", rate: null, rateUnit: null, total: null, priceType: "default" })], shop);
    expect(kept!.priceType).toBe("default");
    expect(dropped).toMatchObject({ priceType: "unknown", catalogId: null, spokenName: "पोपट दाल" });
  });

  it("flagNotHeardByB: a line whose numbers B's transcript does not have gets a Theek hai (the line stays)", () => {
    // the audio answer heard "साठ" (60) for chawal; B, the other ear, heard ₹50
    const bill = checkAudioAnswer("दो किलो चीनी पैंतालीस रुपए किलो, तीन किलो चावल साठ रुपए किलो", [item({}), item({ spokenName: "चावल", catalogId: "11", qty: 3, rate: 6000, rateUnit: "kg", total: 18000 })], shop);
    const flagged = flagNotHeardByB(bill, "2 किलो चीनी ₹45 किलो, 3 किलो चावल ₹50 किलो");
    expect(flagged.lines).toHaveLength(bill.lines.length);
    expect(flagged.warnedLines).toContain(1); // B heard 50 for chawal, not 60
    expect(flagged.warnedLines).not.toContain(0);
    expect(flagged.checks).toBeGreaterThanOrEqual(1);
  });
});

describe("KB-370 nocat (owner, 6 Nov 2026): the model never sees the catalog; OUR code fills an unspoken price (D102's one-clear-match rule)", () => {
  const unpriced = (spokenName: string) => item({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", rate: null, rateUnit: null, total: null, priceType: "default" });

  it("a name that clearly matches ONE catalog product gets that product's shop price - computed by our code, the name kept as said", () => {
    const [line] = checkAudioAnswer("दो किलो शक्कर", fillFromCatalog([unpriced("शक्कर")], shop), shop).lines;
    expect(line!.item).toMatchObject({ spokenName: "शक्कर", catalogId: "27", priceType: "default", rate: shop.byId.get("27")!.suggestedPricePaise, total: 2 * shop.byId.get("27")!.suggestedPricePaise });
  });

  it("a name that matches nothing is Price needed - never a guess", () => {
    expect(fillFromCatalog([unpriced("पोपट दाल")], shop)[0]).toMatchObject({ spokenName: "पोपट दाल", catalogId: null, priceType: "unknown", rate: null, total: null });
  });

  it("KB-380 (A19, A20): a unit the catalog's price cannot be scaled to is Price needed - no shop price, so no missing_total Theek hai", () => {
    // Lal Mirch is priced per kg (a packet is not a kg); Garam Masala per piece (a kg is not a piece)
    for (const [name, unit, t] of [["लाल मिर्ची", "packet", "एक किलो लाल मिर्ची पैकेट"], ["गरम मसाला पैकेट", "kg", "1 किलो गरम मसाला पैकेट"]] as const) {
      const it0 = item({ spokenName: name, catalogId: null, isCustom: true, matchStatus: "none", qty: 1, unit, rate: null, rateUnit: null, total: null, priceType: "default" });
      expect(fillFromCatalog([it0], shop)[0]).toMatchObject({ spokenName: name, catalogId: null, priceType: "unknown", rate: null, total: null });
      const bill = nocatBill(t, [it0], shop);
      expect(bill.warnedLines ?? []).toEqual([]);
    }
  });

  it("KB-381 (A42, owner): 'दंतकांति 60 वाला' with no quantity = 1 piece at Rs 60 - our code computes the total, no warning", () => {
    const bill = nocatBill("दंतकांति 60 वाला", [item({ spokenName: "दंतकांति", catalogId: null, isCustom: true, matchStatus: "none", qty: null, unit: "piece", rate: 6000, rateUnit: "piece", total: null, priceType: "rate" })], shop);
    expect(bill.lines[0]!.item).toMatchObject({ qty: 1, unit: "piece", rate: 6000, total: 6000 });
    expect(bill.warnedLines).toEqual([]);
  });

  it("a spoken rate with NO quantity and nothing that implies one still warns (missing_total) - nothing can be billed", () => {
    const bill = nocatBill("दंतकांति ₹60", [item({ spokenName: "दंतकांति", catalogId: null, isCustom: true, matchStatus: "none", qty: null, unit: "piece", rate: 6000, rateUnit: "piece", total: null, priceType: "rate" })], shop);
    expect(bill.warnedLines).toEqual([0]);
  });

  it("KB-382 (A38, end to end): 500 g at '₹56 किलो' is billed Rs 28 / 48 / 44 - per kilo, our arithmetic - and nothing is blocked", () => {
    const t = "500 ग्राम शक्कर ₹56 किलो 500 ग्राम मूंग दाल ₹96 किलो 500 ग्राम बरबटी दाल ₹88 किलो";
    const raw = (spokenName: string, rate: number) => item({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 500, unit: "gm", rate, rateUnit: "gm", total: null, priceType: "rate" });
    const bill = nocatBill(t, [raw("शक्कर", 5600), raw("मूंग दाल", 9600), raw("बरबटी दाल", 8800)], shop);
    expect(bill.lines.map((l) => l.item.total)).toEqual([2800, 4800, 4400]);
    expect(bill.warnedLines).toEqual([]);
  });

  it("KB-381 (A57, end to end): Rin keeps its 5 pieces with NO comma in the transcript - Layer 1's cut no longer strips it", () => {
    const t = "रिन साबुन 10 वाली 5 पीस पारले जी बिस्किट 30 वाला 5 पैकेट";
    const rin = item({ spokenName: "रिन साबुन", catalogId: null, isCustom: true, matchStatus: "none", qty: 5, unit: "piece", rate: 1000, rateUnit: "piece", total: null, priceType: "rate" });
    const parle = item({ spokenName: "पारले जी बिस्किट", catalogId: null, isCustom: true, matchStatus: "none", qty: 5, unit: "packet", rate: 3000, rateUnit: "packet", total: null, priceType: "rate" });
    const bill = nocatBill(t, [rin, parle], shop);
    expect(bill.lines.map((l) => [l.item.qty, l.item.total])).toEqual([[5, 5000], [5, 15000]]);
  });

  it("a line with a SPOKEN price is never touched (the catalog only fills a price that was not said)", () => {
    const said = item({ spokenName: "शक्कर", catalogId: null, isCustom: true, matchStatus: "none", rate: 5600, total: 11200 });
    expect(fillFromCatalog([said], shop)[0]).toEqual(said);
  });
});

describe("hybridItems (candidate D): C's numbers count only if B's transcript has them", () => {
  it("drops a quantity B did not hear and keeps one it did", () => {
    const [heard, notHeard] = hybridItems("दो किलो चीनी, चावल", [item({}), item({ spokenName: "चावल", catalogId: "11", qty: 5, rate: null, rateUnit: null, total: null, priceType: "default" })]);
    expect(heard!.qty).toBe(2);
    expect(notHeard!.qty).toBeNull();
  });

  it("a quantity of 1 with a per-kilo price stays (the owner's ruling), even though B never heard a '1'", () => {
    const [line] = hybridItems("चीनी पैंतालीस रुपए किलो", [item({ qty: 1, total: 4500 })]);
    expect(line!.qty).toBe(1);
  });

  it("then the price check runs on B's transcript: a rate only C heard is dropped", () => {
    const b = "दो किलो चीनी"; // B heard no price; C claims Rs 45 a kilo
    const r = checkAudioAnswer(b, hybridItems(b, [item({})]), shop);
    expect(r.lines[0]!.item).toMatchObject({ priceType: "unknown", rate: null, qty: 2 });
  });
});
