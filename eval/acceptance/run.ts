import { resolveUtterance } from "../../src/data/voiceBilling.js";
import type { CatalogEntry } from "../../src/domain/catalog.js";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { checksOf, type ActualBill } from "./compare.js";
import type { Recorded } from "./store.js";

// KB-364: one order through the SHIPPED resolver (data/voiceBilling.ts), against the base seed catalog - the same shop eval:real uses.

export type Layer2 = (text: string, slice: readonly CatalogEntry[]) => Promise<ParsedItem[]>;

/** Layer 2 replayed from what Gemini really answered; a text it was never recorded for is an error that says how to record it. */
export function replayLayer2(recorded: Recorded): Layer2 {
  return async (text) => {
    if (!(text in recorded)) throw new Error(`no recorded Layer 2 answer for "${text}" - run npm run accept:live -- --freeze`);
    const items = recorded[text];
    if (items === null) throw new Error("Layer 2 failed when this was recorded");
    return [...items!];
  };
}

export async function runOrder(transcript: string, parse: Layer2): Promise<ActualBill> {
  try {
    const r = await resolveUtterance(transcript, { shop: SEED_PARSER_CATALOG, parse });
    return { lines: r.lines, unresolved: r.unresolved.length, checks: checksOf(r.flags, r.lines.length) };
  } catch {
    // a one-piece text whose Layer 2 failed: the screen lists it as ONE "Not added" entry
    return { lines: [], unresolved: 1, checks: 0 };
  }
}
