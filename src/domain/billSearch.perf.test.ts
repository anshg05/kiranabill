// KB-310 (owner, 7 Oct 2026): history search per keystroke, REPORTED - no
// budget yet. The "perf" Vitest project (D35: run alone). In-memory only - the
// IndexedDB load times are measured on real IndexedDB by the dev-only
// /__dev/history bench (DevHistoryBench.tsx), on the laptop and on the phone.
//   npx vitest run --project perf src/domain/billSearch.perf.test.ts

import { describe, expect, it } from "vitest";
import { compileQuery, toBillSearchRow, type SearchableBill } from "./billSearch";

const NAMES = ["Chini", "Besan", "Toor Daal", "Parle-G", "Basmati Chawal Premium", "Namak", "Ajwain", "Atta", "Sarson Tel", "Maggi"];
const QUERIES = ["r", "ra", "ram", "ramesh", "ramesh 4/10", "chini", "112.50", "4/10", "142", "basmati chawal", "xyzq"];

function bills(n: number): SearchableBill[] {
  const t0 = Date.parse("2025-10-07T09:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    receiptNumber: `KB-${String(i + 1).padStart(6, "0")}`,
    customerName: i % 7 ? "Cash" : `Ramesh ${i % 50}`,
    totalPaise: 9000 + (i % 400) * 25,
    at: new Date(t0 + i * 864_000).toISOString(),
    items: Array.from({ length: 5 }, (_, l) => ({ displayName: NAMES[(i + l) % NAMES.length]!, spokenName: null })),
  }));
}

function measure(n: number) {
  const b0 = performance.now();
  const entries = bills(n).map((b, i) => toBillSearchRow({ ...b, localId: String(i), shopId: "s" }));
  const buildMs = performance.now() - b0;
  for (const q of QUERIES) entries.filter(compileQuery(q)); // warm-up (D35: steady state)
  const perQuery: Record<string, { medianMs: number; hits: number }> = {};
  for (const q of QUERIES) {
    const ms: number[] = [];
    let hits = 0;
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      hits = entries.filter(compileQuery(q)).length;
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    perQuery[q] = { medianMs: Number(ms[3]!.toFixed(2)), hits };
  }
  return { bills: n, buildEntriesMs: Number(buildMs.toFixed(1)), perQuery };
}

describe("history search - per keystroke (reported, no budget)", () => {
  for (const n of [9_000, 40_000]) {
    it(`${n} bills x 5 items`, () => {
      const r = measure(n);
      console.info(`[perf] history search ${JSON.stringify(r)}`);
      expect(r.perQuery["xyzq"]!.hits).toBe(0);
      expect(r.perQuery["r"]!.hits).toBe(n);
    });
  }
});
