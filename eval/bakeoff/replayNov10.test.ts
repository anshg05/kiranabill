import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { nocatBill } from "./pipeline.js";
import { toSaved, type RunResult } from "./score.js";

// Owner, 18 Nov 2026 (closing the gap left by the old voice path's removal): KB-387's FINAL live run (10 Nov 2026, the run behind the
// release figures short 45/49, long 36/36) replayed with no call. Each saved raw answer (the model's transcript + items) goes through
// today's code - nocatBill is aiAnswerBill, the phone's own chain - and must give back exactly the lines the live run saved: names,
// numbers, price types, which lines carried a Theek hai, and the bill's check count. Any difference is a code change to explain, never a silent one.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rows = (JSON.parse(readFileSync(path.join(HERE, "results-v3-2026-11-10.json"), "utf8")) as { results: RunResult[] }).results;

describe("KB-387's final run (10 Nov 2026) - the offline replay", () => {
  it("has all 85 saved answers (49 short, 36 long)", () => {
    const ok = rows.filter((r) => r.candidate === "nocat-v2" && r.items && r.transcript !== null && !r.error);
    expect([ok.length, ok.filter((r) => r.set === "short").length, ok.filter((r) => r.set === "long").length]).toEqual([85, 49, 36]);
  });

  it("replays every saved answer to exactly the bill the live run saved", () => {
    const changed = rows.flatMap((r) => {
      const bill = nocatBill(r.transcript!, r.items!, SEED_PARSER_CATALOG);
      const now = toSaved(bill);
      return JSON.stringify(now.lines) === JSON.stringify(r.lines) && now.unresolved === r.unresolved && bill.checks === r.checks ? [] : [`${r.id} run ${r.run}`];
    });
    expect(changed).toEqual([]);
  });
});
