import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapToParsedItem, type GeminiRawItem } from "../../src/voice/geminiParseProvider";
import { expandCompactItem, toCompactItem } from "../../src/voice/geminiAudioParseProvider";
import type { ParsedItem } from "../../src/domain/grammar";

// KB-384a step 1 (owner, 9 Nov 2026) - the OFFLINE proof: every item of all 85 saved V3 answers (nocat-v2, results-v2-2026-11-09.json)
// goes long -> short -> long and through the same mapping; the items are IDENTICAL, so the replay (our price fill, checks, totals) is too.

const saved = JSON.parse(readFileSync(path.join(__dirname, "results-v2-2026-11-09.json"), "utf8")) as { results: { candidate: string; items: ParsedItem[] | null }[] };
const runs = saved.results.filter((r) => r.candidate === "nocat-v2" && r.items);
const rawOf = (i: ParsedItem): GeminiRawItem => ({ spokenName: i.spokenName, catalogId: i.catalogId, qty: i.qty, unit: i.unit, rate: i.rate, total: i.total, priceType: i.priceType });

describe("the compact answer loses nothing on the saved V3 answers", () => {
  it("85 runs, every item identical after long -> short -> long", () => {
    expect(runs.length).toBe(85);
    for (const r of runs) expect(r.items!.map((i) => mapToParsedItem(expandCompactItem(toCompactItem(rawOf(i))), []))).toEqual(r.items);
  });
});
