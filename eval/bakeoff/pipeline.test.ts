import { describe, expect, it } from "vitest";
import { resolveUtterance } from "../../src/data/voiceBilling.js";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { checksOf } from "../acceptance/compare.js";
import { checkAudioAnswer, hybridItems } from "./pipeline.js";

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
