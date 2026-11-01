/**
 * KB-370: re-score a bake-off results file from the lines each run SAVED - offline, free, no call (after a scoring fix).
 *     npm run bakeoff:rescore -- eval/bakeoff/results-canary-2026-11-01.json
 * Rows without saved lines (run 1, before lines were kept) are left as they were. Rows saved before the canary-hole fix carry no
 * "warned" flags: their wrong lines are re-scored as silent, and this says so.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { parseSheet } from "../acceptance/sheet.js";
import { SHEET } from "../acceptance/store.js";
import { fromSaved, scoreRun, type RunResult } from "./score.js";

const file = process.argv[2];
if (!file) throw new Error("usage: npm run bakeoff:rescore -- <results file>");
const data = JSON.parse(readFileSync(file, "utf8")) as { meta: Record<string, unknown>; results: RunResult[] };
const expectedOf = new Map(parseSheet(readFileSync(SHEET, "utf8")).orders.map((o) => [o.id, o.expected ?? o.skippedExpected]));
let rescored = 0;
let noWarnFlags = 0;
data.results = data.results.map((r) => {
  const expected = expectedOf.get(r.id);
  if (!r.lines || !expected || r.error) return r;
  if (!r.lines.some((l) => "warned" in l)) noWarnFlags++;
  const s = scoreRun(r.id, expected, fromSaved({ lines: r.lines, unresolved: r.unresolved }, SEED_PARSER_CATALOG, r.checks), SEED_PARSER_CATALOG);
  const was = r.exact ? "exact" : r.wrongLines ? `WRONG ${r.wrongLines}` : "inexact";
  const now = s.exact ? "exact" : s.wrongLines ? `WRONG ${s.wrongLines}` : "inexact";
  console.log(`${r.id} ${r.candidate.padEnd(9)} run ${r.run}: ${was} -> ${now}`);
  for (const w of s.wrong) console.log(`          ! ${w}`);
  rescored++;
  return { ...r, ...s };
});
writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`Re-scored ${rescored} result(s) in ${file}${noWarnFlags ? ` (${noWarnFlags} saved before warnings were kept: their wrong lines count as silent)` : ""}.`);
