// KB-005e / docs/07-DECISIONS.md D35: this file is the "perf" Vitest project
// (vite.config.ts). `npm test` runs it alone, after every other test file has
// finished, so it never shares the CPU with them - full-suite timings were ~2x
// isolated ones (docs/12-PARKED.md KI-23). Run it on its own with:
//   npx vitest run --project perf
// Any future performance-budget test belongs in a *.perf.test.ts file.

import { describe, expect, it } from "vitest";
import { catalog, type CatalogEntry } from "./catalog";
import { buildCatalogIndex, lookupCandidates } from "./catalogIndex";

describe("catalogIndex - performance (docs/18-AGENT-CONTRACT.md section 8: under 16ms at 10,000 products)", () => {
  it("a single lookup stays under 16ms against a synthetic 10,000-product catalog", () => {
    // Vary alias text per copy, not just the id - an exact-text duplicate
    // 21x over is a pathological trigram-index case no real 10,000-product
    // catalog would produce (real catalogs have distinct product names).
    const scaled: CatalogEntry[] = [];
    const copies = Math.ceil(10_000 / catalog.length);
    for (let copy = 0; copy < copies; copy++) {
      for (const entry of catalog) {
        const suffix = copy === 0 ? "" : ` v${copy}`;
        scaled.push({
          ...entry,
          id: `${entry.id}-dup${copy}`,
          displayName: `${entry.displayName}${suffix}`,
          aliases: entry.aliases.map((alias) => `${alias}${suffix}`),
        });
      }
    }
    expect(scaled.length).toBeGreaterThanOrEqual(10_000);

    const index = buildCatalogIndex(scaled); // build is a one-time startup cost, not timed

    // The 16ms budget is a STEADY-STATE requirement (docs/07-DECISIONS.md
    // D35): it is the per-keystroke budget for continuous type-ahead, so it
    // is asserted on warmed-up lookups only. The cold first lookup of a
    // session is deliberately NOT asserted - its cost is accepted (D35).
    //
    // Why the warm-up exists (docs/12-PARKED.md KI-23): timing cold lookups
    // measured JIT warm-up of whichever heavy query ran first, not the
    // lookup itself. The 26 Sep 2026 diagnostic: one untimed call did not
    // settle it; the heaviest queries settled after ~16-20 prior mixed
    // lookups (besan 4th with a chawal warm-up; chawal 5th in reversed
    // order - one run still 13.49ms after 20), and JIT tier-up timing
    // varies with load. WARMUP_ROUNDS = 10 (50 untimed lookups) is 2.5x
    // that observed threshold, chosen before verification. If this test
    // fails in isolation again, reopen KI-23 - don't tune WARMUP_ROUNDS.
    //
    // Averaging RUNS_PER_QUERY runs per query still measures typical
    // performance rather than one noisy sample; the budget is unchanged.
    const WARMUP_ROUNDS = 10;
    const RUNS_PER_QUERY = 5;
    const queries = ["chawal", "toor daal", "wim", "besan 500 gram", "ajwain"];
    for (let round = 0; round < WARMUP_ROUNDS; round++) {
      for (const query of queries) lookupCandidates(index, query); // untimed
    }
    for (const query of queries) {
      let totalMs = 0;
      for (let i = 0; i < RUNS_PER_QUERY; i++) {
        const start = performance.now();
        lookupCandidates(index, query);
        totalMs += performance.now() - start;
      }
      const averageMs = totalMs / RUNS_PER_QUERY;
      expect(averageMs).toBeLessThan(16);
    }
  });
});
