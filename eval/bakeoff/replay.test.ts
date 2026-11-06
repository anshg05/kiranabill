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

  it("replays every saved raw answer to exactly the lines the live run saved (168 runs)", () => {
    const changed = rows.filter((r) => JSON.stringify(toSaved(nocatBill(r.transcript!, r.items!, SEED_PARSER_CATALOG)).lines) !== JSON.stringify(r.lines));
    expect(changed.map((r) => `${r.candidate} ${r.id} run ${r.run}`)).toEqual([]);
  });
});
