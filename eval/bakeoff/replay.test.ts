import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { nocatBill } from "./pipeline.js";
import { toSaved, type RunResult } from "./score.js";

// KB-379 (D105, doc 25 §12): the regression set's offline replay. The saved RAW answers (the model's items + transcript) go through the
// CURRENT code path - our price fill, the checks, the totals - so a code change is measured with no call. Before any code change, the
// replay must give back exactly the lines the live run saved: otherwise the replay measures something else than the run did.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rows = (JSON.parse(readFileSync(path.join(HERE, "results-nocat-2026-11-06.json"), "utf8")) as { results: RunResult[] }).results;

describe("the regression set's offline replay", () => {
  it("has a raw answer for every nocat run (84 per variant)", () => {
    for (const c of ["nocat-old", "nocat-D103"]) expect(rows.filter((r) => r.candidate === c && r.items && r.transcript !== null && !r.error)).toHaveLength(84);
  });

  it("replays every saved raw answer to the NUMBERS the live run saved (168 runs) - only KB-380's intended changes differ", () => {
    // KB-379 proved an exact replay before any code change. Since KB-380 the Theek hai may differ (the adapted checks), and ONE number change
    // is intended: a shop price the catalog cannot scale to the line's unit (A19, A20: a "default" line with no total) is now Price needed.
    const numbers = (l: NonNullable<RunResult["lines"]>[number]) => JSON.stringify({ ...l, warned: undefined });
    const intended = (was: NonNullable<RunResult["lines"]>[number], now: NonNullable<RunResult["lines"]>[number]) =>
      was.priceType === "default" && was.total === null && now.priceType === "unknown" && now.catalogId === null && now.qty === was.qty && now.unit === was.unit && now.name === was.name;
    const changed = rows.flatMap((r) => {
      const now = toSaved(nocatBill(r.transcript!, r.items!, SEED_PARSER_CATALOG)).lines;
      if (now.length !== r.lines!.length) return [`${r.candidate} ${r.id} run ${r.run}: ${r.lines!.length} -> ${now.length} lines`];
      return now.flatMap((l, k) => (numbers(l) === numbers(r.lines![k]!) || intended(r.lines![k]!, l) ? [] : [`${r.candidate} ${r.id} run ${r.run} line ${k + 1}`]));
    });
    expect(changed).toEqual([]);
  });
});
