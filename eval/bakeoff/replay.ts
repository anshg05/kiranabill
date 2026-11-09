/**
 * KB-379 (D105, doc 25 §12): the regression set's OFFLINE replay - free, no call. The saved raw answers (the model's items + transcript)
 * go through the CURRENT code (nocatBill: our price fill, the checks, the totals) and are scored under D102 + D103 against the sheet.
 *     npm run bakeoff:replay                                         nocat-D103 from results-nocat-2026-11-06.json, today's sheet
 *     npm run bakeoff:replay -- --sheet <file> --candidate nocat-old --file <results file>
 * Prints short and long orders SEPARATELY (the finish line is >= 90% exact on each), every run whose bill differs from the saved one,
 * and every wrong line.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { parseSheet } from "../acceptance/sheet.js";
import { SHEET } from "../acceptance/store.js";
import { earHeard, scoreRunD102 } from "./d102.js";
import { nocatBill } from "./pipeline.js";
import { summarize, toSaved, type RunResult } from "./score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const file = path.resolve(arg("file") ?? path.join(HERE, "results-nocat-2026-11-06.json"));
const candidate = arg("candidate") ?? "nocat-D103";
const sheetFile = path.resolve(arg("sheet") ?? SHEET);
const shop = SEED_PARSER_CATALOG;

const expectedOf = new Map(parseSheet(readFileSync(sheetFile, "utf8")).orders.map((o) => [o.id, o.expected ?? o.skippedExpected]));
const saved = (JSON.parse(readFileSync(file, "utf8")) as { meta: { inrPerUsd?: number }; results: RunResult[] }).results.filter((r) => r.candidate === candidate);
if (!saved.length) throw new Error(`no ${candidate} rows in ${file}`);

const changed: string[] = [];
const replayed = saved.map((r): RunResult => {
  const expected = expectedOf.get(r.id);
  if (r.error || !r.items || r.transcript === null || !expected) return r; // a failed run stays a failed run (nothing to replay)
  const bill = nocatBill(r.transcript, r.items, shop);
  const lines = toSaved(bill).lines;
  // what changed against the saved run: a line's numbers (name, quantity, unit, price) and / or its Theek hai
  const numbers = (l: (typeof lines)[number]) => JSON.stringify({ ...l, warned: undefined });
  const moved = lines.flatMap((l, k) => (r.lines![k] && numbers(l) !== numbers(r.lines![k]!) ? [`line ${k + 1} "${l.name}": ${r.lines![k]!.priceType} ${r.lines![k]!.total ?? "-"} -> ${l.priceType} ${l.total ?? "-"}`] : []));
  const before = r.lines!.filter((l) => l.warned).length;
  const after = lines.filter((l) => l.warned).length;
  if (moved.length || before !== after || lines.length !== r.lines!.length) changed.push(`${r.id} run ${r.run}: Theek hai ${before} -> ${after} lines${moved.length ? `; ${moved.join("; ")}` : ""}${lines.length !== r.lines!.length ? `; ${r.lines!.length} -> ${lines.length} lines` : ""}`);
  return { ...r, ...toSaved(bill), ...scoreRunD102(r.id, expected, bill, shop) };
});

console.log(`KB-379 replay - ${candidate} from ${path.basename(file)} (${replayed.length} runs), scored D102 + D103 against ${path.relative(process.cwd(), sheetFile)}; no call\n`);
console.log("| Set | Runs | Exact | Wrong lines (silent / warned) | Dropped lines (silent / warned) | Lines with a Theek hai | Price needed lines |\n|---|---|---|---|---|---|---|");
for (const set of ["short", "long"] as const) {
  const s = summarize(replayed.filter((r) => r.set === set), 95.17);
  console.log(`| ${set} | ${s.runs} | ${s.exact}/${s.runs} (${Math.round((100 * s.exact) / Math.max(1, s.runs))}%) | ${s.wrongLines} (${s.silentWrong} / ${s.wrongLines - s.silentWrong}) | ${s.dropped} (${s.silentDropped} / ${s.dropped - s.silentDropped}) | ${s.warnedLines} | ${s.priceNeededLines} |`);
}
console.log(`\nRuns whose bill differs from the saved one (${changed.length}):${changed.length ? `\n  ${changed.join("\n  ")}` : " none"}`);
console.log("\nEvery dropped line (silent = nothing on the bill warns about it):");
for (const r of replayed) if (r.dropped) console.log(`  ${r.id} run ${r.run}: ${r.dropped} dropped, ${r.silentDropped ?? 0} silent`);
// D106 (owner, 9 Nov 2026): the finish line counts silent wrong lines caused by OUR CODE strictly (0); an EAR mis-hearing is counted apart
// (at most 1 per full run). A silent wrong NUMBER is the ear's only when the transcript has that exact number inside THAT item's own segment
// (earHeard: from its name to the next line's name); anywhere else it counts against our code.
const earOrCode = replayed.flatMap((r) =>
  r.wrong
    .filter((w) => w.endsWith("[NO warning]"))
    .map((w) => {
      const billed = /wrong (?:price|total|quantity) (\d+(?:\.\d+)?)/.exec(w)?.[1];
      const value = billed === undefined ? null : w.includes("wrong quantity") ? Number(billed) : Number(billed) / 100;
      const heard = /heard "([^"]*)"/.exec(w)?.[1] ?? "";
      const said = value !== null && earHeard(r.transcript ?? "", heard, value, (r.lines ?? []).map((l) => l.name));
      return `${said ? "EAR " : "CODE"} ${r.id} run ${r.run}: ${w}`;
    }),
);
console.log(`\nSilent wrong lines: ${earOrCode.filter((x) => x.startsWith("CODE")).length} caused by our code (the finish line: 0), ${earOrCode.filter((x) => x.startsWith("EAR")).length} ear mis-hearing(s) (accepted: at most 1 per full run, D106)`);
for (const x of earOrCode) console.log(`  ${x}`);
console.log("\nEvery wrong line:");
for (const r of replayed) for (const w of r.wrong) console.log(`  ${r.id} run ${r.run}: ${w}`);
