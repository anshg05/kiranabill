import { describe, it, expect, vi } from "vitest";
import { resolveUtterance } from "./voiceBilling";
import type { ParsedItem } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import voiceCases from "../../eval/voice-cases.json";

// KB-302: steps 3-6 of the one-turn flow. Layer 1 is the REAL parser (D39);
// Layer 2 (Gemini) is a fake returning Gemini-shaped items - the real Gemini
// round trip is VERIFY's job (D32).

const utterance = (id: string) => voiceCases.find((c) => c.id === id)!.utterance;
const gemini = (over: Partial<ParsedItem>): ParsedItem => ({
  spokenName: "x", catalogId: null, isCustom: true, matchStatus: "none",
  qty: null, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "unknown", ...over,
});

describe("resolveUtterance", () => {
  it("Layer 1 hit (VC023): fastpath lines, Gemini never called", async () => {
    const parse = vi.fn();
    const r = await resolveUtterance(utterance("VC023"), { shop: SEED_PARSER_CATALOG, parse });
    expect(parse).not.toHaveBeenCalled();
    expect(r.layer).toBe("fastpath");
    expect(r.lines.map((l) => [l.source, l.item.catalogId, l.item.total])).toEqual([
      ["fastpath", "16", 60000],
      ["fastpath", "27", 9000],
    ]);
  });

  // KB-317 (a): per-stage timings for the dev [voice] log.
  it("reports its own timings: Layer 1 always; Gemini only when it was called", async () => {
    const hit = await resolveUtterance(utterance("VC023"), { shop: SEED_PARSER_CATALOG, parse: vi.fn() });
    expect(hit.timings.layer1Ms).toBeGreaterThanOrEqual(0);
    expect(hit.timings.layer2Ms).toBeNull();
    // KB-317 commit 2: RT07 - no separator at all, stays a Layer 1 miss.
    const miss = await resolveUtterance("2 किलो चीनी 3 पालेजी 10 वाला 1 किलो बेसन", { shop: SEED_PARSER_CATALOG, parse: vi.fn(async () => []) });
    expect(miss.timings.layer2Ms).toBeGreaterThanOrEqual(0);
  });

  // KB-317 commit 2: a comma now separates items in Layer 1 (see the next
  // test); an order with NO separator is what Layer 1 can't split.
  it("Q3: an order Layer 1 can't split (no separator, HIGH number flags) goes to Layer 2 instead", async () => {
    const transcript = "2 kilo chini teen Parle-G 10 wala";
    const parse = vi.fn(async () => [
      gemini({ spokenName: "chini", catalogId: "27", matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "default" }),
      gemini({ spokenName: "Parle-G", catalogId: "52", matchStatus: "matched", qty: 3, unit: "piece", rate: 1000, rateUnit: "piece", total: 3000, priceType: "rate" }),
    ]);
    const r = await resolveUtterance(transcript, { shop: SEED_PARSER_CATALOG, parse });
    expect(r.layer).toBe("voice");
    const [, slice] = parse.mock.calls[0]! as unknown as [string, { id: string }[]];
    expect(slice.map((e) => e.id)).toEqual(expect.arrayContaining(["27", "52"]));
    expect(r.lines.map((l) => [l.source, l.displayName, l.item.total])).toEqual([
      ["voice", "Chini", 9000],
      ["voice", "Parle-G 10", 3000],
    ]);
    expect(r.flags.filter((f) => f.severity === "HIGH")).toEqual([]);
  });

  it("KB-317: a comma order splits in Layer 1 - two fastpath lines, Gemini never called", async () => {
    const parse = vi.fn();
    const r = await resolveUtterance("2 kilo chini, teen Parle-G 10 wala", { shop: SEED_PARSER_CATALOG, parse });
    expect(parse).not.toHaveBeenCalled();
    expect(r.layer).toBe("fastpath");
    expect(r.lines.map((l) => [l.source, l.displayName, l.item.qty, l.item.total])).toEqual([
      ["fastpath", "Chini", 2, 9000],
      ["fastpath", "Parle-G 10", 3, 3000],
    ]);
  });

  // KB-317 commit 2 (owner): the bill shows the SHOP's catalog name, never the
  // spoken words - "चावल का" reached the bill as the item name.
  it("a Layer 1 line shows the shop catalog's display name, not the spoken words", async () => {
    const r = await resolveUtterance("5 किलो चावल 30 का", { shop: SEED_PARSER_CATALOG, parse: vi.fn() });
    expect(r.layer).toBe("fastpath");
    expect(r.lines.map((l) => [l.displayName, l.item.spokenName, l.item.total])).toEqual([["Chawal", "चावल", 3000]]);
  });

  it("the display name is THIS shop's own name for the product (D4), not the seed's", async () => {
    const shop = prepareParserCatalog([
      { id: "shop-chawal", displayName: "Sona Masoori", sourceCategory: "", guardCategory: "grain", unit: "kg", suggestedPricePaise: 6000, aliases: ["चावल", "chawal"], isActive: true },
    ]);
    const r = await resolveUtterance("2 किलो चावल", { shop, parse: vi.fn() });
    expect(r.lines.map((l) => [l.displayName, l.item.catalogId, l.item.total])).toEqual([["Sona Masoori", "shop-chawal", 12000]]);
  });

  it("Q3: Layer 1 turning a garbled transcript into one unknown line is a miss -> Layer 2", async () => {
    const parse = vi.fn(async () => []);
    const r = await resolveUtterance(" दुकीलोचीनी, टीन पारल जी दास वाला", { shop: SEED_PARSER_CATALOG, parse });
    expect(parse).toHaveBeenCalledOnce();
    expect(r.layer).toBe("voice");
    expect(r.lines).toEqual([]);
  });

  it("Layer 1 bail (null) -> Layer 2", async () => {
    const parse = vi.fn(async () => []);
    // KB-317 commit 2: RT07 - no separator; the और/comma forms now hit Layer 1.
    await resolveUtterance("2 किलो चीनी 3 पालेजी 10 वाला 1 किलो बेसन", { shop: SEED_PARSER_CATALOG, parse });
    expect(parse).toHaveBeenCalledOnce();
  });

  it("KI-34 end to end: Gemini's '500 gram chini' reaches the bill as ₹45/kg, ₹22.50", async () => {
    const parse = vi.fn(async () => [
      gemini({ spokenName: "चीनी", catalogId: "27", matchStatus: "matched", qty: 500, unit: "gm", rate: 4500, rateUnit: "gm", total: 2250000, priceType: "default" }),
    ]);
    const r = await resolveUtterance("पांच सौ ग्राम चीनी", { shop: SEED_PARSER_CATALOG, parse });
    expect(r.lines[0]!.item).toMatchObject({ rate: 4500, rateUnit: "kg", total: 2250 });
  });

  // Added after the compound-number fix (2b8dfa4): the test above is now served
  // by Layer 1 (it reads पांच सौ = 500), so this one keeps KI-34 covered through
  // the orchestrator with a transcript Layer 1 genuinely bails on (two bare numbers).
  it("KI-34 through Layer 2: a Layer 1 bail -> Gemini's per-gm-labelled chini line settles to ₹45/kg, ₹22.50", async () => {
    const parse = vi.fn(async () => [
      gemini({ spokenName: "chini", catalogId: "27", matchStatus: "matched", qty: 500, unit: "gm", rate: 4500, rateUnit: "gm", total: 2250000, priceType: "default" }),
    ]);
    const r = await resolveUtterance("500 gram chini 30 40", { shop: SEED_PARSER_CATALOG, parse });
    expect(parse).toHaveBeenCalledOnce();
    expect(r.layer).toBe("voice");
    expect(r.lines[0]!.item).toMatchObject({ rate: 4500, rateUnit: "kg", total: 2250 });
  });

  it("Q7: Gemini attaching numbers to the wrong items -> one HIGH number_misaligned flag", async () => {
    const parse = vi.fn(async () => [
      gemini({ spokenName: "chini", catalogId: "27", matchStatus: "matched", qty: 3, unit: "kg", priceType: "default" }),
      gemini({ spokenName: "Parle-G", catalogId: "52", matchStatus: "matched", qty: 2, unit: "piece", rate: 1000, priceType: "rate" }),
    ]);
    // KB-317 commit 2: no comma - the comma form now splits in Layer 1.
    const r = await resolveUtterance("2 kilo chini teen Parle-G 10 wala", { shop: SEED_PARSER_CATALOG, parse });
    expect(r.flags.filter((f) => f.code === "number_misaligned")).toHaveLength(1);
  });

  it("a 'start empty' shop: an unknown product still lands (never blocked), flagged, unpriced", async () => {
    const parse = vi.fn(async () => [gemini({ spokenName: "ajwain", qty: 1, unit: "piece", total: 1000, priceType: "total" })]);
    const r = await resolveUtterance(utterance("VC005"), { shop: prepareParserCatalog([]), parse });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.item).toMatchObject({ catalogId: null, total: 1000 });
    expect(r.flags.map((f) => f.code)).toContain("unknown_product");
  });

  // KB-317 commit 3 (KI-46): the real case - Whisper repeated "दो किलो शक्कर",
  // Layer 1 missed (no separator), and Gemini returned the line twice. Every
  // number was consumed, so no number check fired; duplicate_line does.
  it("KI-46 on the Gemini path: a repeated line -> HIGH duplicate_line, both lines kept", async () => {
    const chini = () => gemini({ spokenName: "शक्कर", catalogId: "27", matchStatus: "matched", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "default" });
    const parle = gemini({ spokenName: "पांगलेजी", catalogId: "52", matchStatus: "matched", qty: 3, unit: "piece", rate: 1000, rateUnit: "piece", total: 3000, priceType: "rate" });
    const parse = vi.fn(async () => [chini(), chini(), parle]);
    const r = await resolveUtterance("दो किलो शक्कर दो किलो शक्कर पांगलेजी तीन दस वाला", { shop: SEED_PARSER_CATALOG, parse });
    expect(r.layer).toBe("voice");
    expect(r.lines.map((l) => l.displayName)).toEqual(["Chini", "Chini", "Parle-G 10"]);
    expect(r.flags.filter((f) => f.code === "duplicate_line")).toEqual([expect.objectContaining({ severity: "HIGH", itemIndex: 1 })]);
  });

  it("KB-317 commit 3: a Layer 1 comma order said twice (RT22) -> fastpath, both lines, HIGH duplicate_line", async () => {
    const r = await resolveUtterance("दो किलो चीनी, दो किलो चीनी", { shop: SEED_PARSER_CATALOG, parse: vi.fn() });
    expect(r.layer).toBe("fastpath");
    expect(r.lines).toHaveLength(2);
    expect(r.flags.filter((f) => f.code === "duplicate_line").map((f) => [f.severity, f.itemIndex])).toEqual([["HIGH", 1]]);
  });
});
