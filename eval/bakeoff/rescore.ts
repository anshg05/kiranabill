/**
 * KB-370: re-score a bake-off results file from the lines each run SAVED - offline, free, no call (after a scoring fix).
 *     npm run bakeoff:rescore -- eval/bakeoff/results-canary-2026-11-01.json
 *     npm run bakeoff:rescore -- eval/bakeoff/results-2026-10-31.json --rule d102   D102 (names as said): written to <file>-d102.json
 * Rows without saved lines (run 1, before lines were kept) are left as they were. Rows saved before the canary-hole fix carry no
 * "warned" flags: their wrong lines are re-scored as silent, and this says so.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { parseSheet } from "../acceptance/sheet.js";
import { SHEET } from "../acceptance/store.js";
import { aroundWords, scoreRunD102 } from "./d102.js";
import { fromSaved, scoreRun, type RunResult } from "./score.js";

const file = process.argv[2];
if (!file) throw new Error("usage: npm run bakeoff:rescore -- <results file> [--rule d102]");
const d102 = process.argv[process.argv.indexOf("--rule") + 1] === "d102";
const out = d102 ? file.replace(/\.json$/, "-d102.json") : file; // the original scores are kept
const wrongNumbers: string[] = [];
const data = JSON.parse(readFileSync(file, "utf8")) as { meta: Record<string, unknown>; results: RunResult[] };
const expectedOf = new Map(parseSheet(readFileSync(SHEET, "utf8")).orders.map((o) => [o.id, o.expected ?? o.skippedExpected]));
let rescored = 0;
let noWarnFlags = 0;
data.results = data.results.map((r) => {
  const expected = expectedOf.get(r.id);
  if (!r.lines || !expected || r.error) return r;
  if (!r.lines.some((l) => "warned" in l)) noWarnFlags++;
  const bill = fromSaved({ lines: r.lines, unresolved: r.unresolved }, SEED_PARSER_CATALOG, r.checks);
  const s = d102 ? scoreRunD102(r.id, expected, bill, SEED_PARSER_CATALOG) : scoreRun(r.id, expected, bill, SEED_PARSER_CATALOG);
  // every wrong NUMBER (not a wrong product) with the transcript words around it - to tell a mis-hearing from a reading error
  for (const w of s.wrong.filter((x) => !x.includes("wrong product"))) {
    wrongNumbers.push(`${r.id} ${r.candidate} run ${r.run} | ${w}\n          heard: ${aroundWords(r.transcript ?? "", /heard "([^"]*)"/.exec(w)?.[1] ?? "")}`);
  }
  const was = r.exact ? "exact" : r.wrongLines ? `WRONG ${r.wrongLines}` : "inexact";
  const now = s.exact ? "exact" : s.wrongLines ? `WRONG ${s.wrongLines}` : "inexact";
  console.log(`${r.id} ${r.candidate.padEnd(9)} run ${r.run}: ${was} -> ${now}`);
  for (const w of s.wrong) console.log(`          ! ${w}`);
  rescored++;
  return { ...r, ...s };
});
if (d102) data.meta = { ...data.meta, scoring: "D102 - names as said (owner, 4 Nov 2026)" };
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`\nEvery wrong NUMBER (${wrongNumbers.length}), with the words around it:\n${wrongNumbers.join("\n")}`);
console.log(`Re-scored ${rescored} result(s) into ${out}${noWarnFlags ? ` (${noWarnFlags} saved before warnings were kept: their wrong lines count as silent)` : ""}.`);
