import { describe, expect, it, vi } from "vitest";
import { resolveUtterance } from "./voiceBilling";
import type { ParsedItem } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { checkHeadline } from "@/domain/billEdit";

// KB-368: a weak product match is never silent, from Layer 2 (the AI chose a catalog id) and from Layer 1 (the matcher did).
const ai = (over: Partial<ParsedItem>): ParsedItem => ({
  spokenName: "x", catalogId: null, isCustom: true, matchStatus: "none",
  qty: null, unit: "piece", rate: null, rateUnit: null, total: null, priceType: "unknown", ...over,
});

describe("KB-368 through resolveUtterance", () => {
  it("Layer 2: the AI picks Cake for 'हारपी केक' with a SPOKEN price -> one MEDIUM 'Check this item', the line is NOT changed", async () => {
    const parse = vi.fn(async () => [ai({ spokenName: "हारपी केक", catalogId: "69", matchStatus: "matched", qty: 1, rate: 6000, rateUnit: "piece", total: 6000, priceType: "rate" })]);
    const r = await resolveUtterance("हारपी केक 60 रुपए एक", { shop: SEED_PARSER_CATALOG, parse });
    const weak = r.flags.filter((f) => f.code === "weak_product");
    expect(weak).toMatchObject([{ severity: "MEDIUM", itemIndex: 0 }]);
    expect(r.lines.map((l) => [l.item.catalogId, l.item.total])).toEqual([["69", 6000]]);
  });

  it("Layer 2: the same wrong product with the CATALOG's price is HIGH (a Theek hai), at the right line index after Layer 1 lines", async () => {
    const parse = vi.fn(async () => [ai({ spokenName: "फेना डिटरजन", catalogId: "69", matchStatus: "matched", qty: 1, rate: 2000, rateUnit: "piece", total: 2000, priceType: "default" })]);
    const r = await resolveUtterance("2 किलो चीनी, फेना डिटरजन एक", { shop: SEED_PARSER_CATALOG, parse });
    expect(r.lines.map((l) => l.source)).toEqual(["fastpath", "voice"]);
    expect(r.flags.filter((f) => f.code === "weak_product")).toMatchObject([{ severity: "HIGH", itemIndex: 1 }]);
  });

  it("a right Layer 2 match raises nothing", async () => {
    const parse = vi.fn(async () => [ai({ spokenName: "हार्पिक", catalogId: "199", matchStatus: "matched", qty: 1, rate: 6000, rateUnit: "piece", total: 6000, priceType: "rate" })]);
    const r = await resolveUtterance("हार्पिक 60 रुपए एक", { shop: SEED_PARSER_CATALOG, parse });
    expect(r.flags.filter((f) => f.code === "weak_product")).toEqual([]);
  });

  it("Layer 1: a plain right order stays silent (no new flag on the everyday path)", async () => {
    const r = await resolveUtterance("2 किलो चीनी, 1 किलो बेसन", { shop: SEED_PARSER_CATALOG, parse: vi.fn() });
    expect(r.layer).toBe("fastpath");
    expect(r.flags.filter((f) => f.code === "weak_product")).toEqual([]);
  });

  it("one warning per line: a HIGH weak product leads the headline, ahead of a number reason", () => {
    const weak = { code: "weak_product" as const, message: `Check this item — heard "x", chose "Cake".`, lineId: "L1" };
    const num = { code: "number_unconsumed" as const, message: "n", lineId: "L1" };
    expect(checkHeadline([num, weak])).toBe(weak.message);
    expect(checkHeadline([weak])).toBe(weak.message);
  });
});
