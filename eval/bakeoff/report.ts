/**
 * KB-370: eval/bakeoff/REPORT.md from a bake-off results file - offline, free, can be re-run.
 *     npm run bakeoff:report                     the newest results-*.json
 *     npm run bakeoff:report -- --file eval/bakeoff/results-2026-11-02.json
 * The plain-language summary between the <!-- summary --> markers is written by hand after a run and is kept when the tables are rebuilt.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_LABEL, CANDIDATES, PRICE_SOURCES, perRecording, summarize, type RunResult } from "./score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT = path.join(HERE, "REPORT.md");
const i = process.argv.indexOf("--file");
const file = i > 0 ? process.argv[i + 1]! : readdirSync(HERE).filter((f) => /^results-.*\.json$/.test(f)).sort().map((f) => path.join(HERE, f)).pop();
if (!file) {
  console.error("No results-*.json in eval/bakeoff - run npm run bakeoff -- --go first.");
  process.exit(1);
}
const { meta, results } = JSON.parse(readFileSync(file, "utf8")) as {
  meta: { date: string; longRuns: number; inrPerUsd: number; vocabulary: string[]; models: Record<string, string>; setAside: string[] };
  results: RunResult[];
};

const rs = (n: number) => `Rs ${n < 1 ? n.toFixed(2) : n.toFixed(0)}`;
const s1 = (n: number) => n.toFixed(1);
function table(rows: RunResult[]): string {
  const head = "| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated | Invented | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = CANDIDATES.filter((c) => rows.some((r) => r.candidate === c)).map((c) => {
    const mine = rows.filter((r) => r.candidate === c);
    const s = summarize(mine, meta.inrPerUsd);
    const orders = new Set(mine.map((r) => r.id)).size;
    return `| **${c}** | ${orders} x ${s.runs / Math.max(1, orders)} | ${s.exact}/${s.runs} (${Math.round((100 * s.exact) / Math.max(1, s.runs))}%) | **${s.wrongLines}** (${s.silentWrong}) | ${s.wrongNumbers} | ${s.wrongProducts} | ${s.dropped} | ${s.duplicated} | ${s.invented} | ${s.warnedLines} | ${s.errors} | ${s1(s.secondsMedian)} / ${s1(s.secondsP90)} / ${s1(s.secondsMax)} | ${rs(s.inrPerBill)} | ${rs(s.inrPerMonth)} |`;
  });
  return [head, ...lines].join("\n");
}

const short = results.filter((r) => r.set === "short");
const long = results.filter((r) => r.set === "long");
const setAside = short.filter((r) => meta.setAside.includes(r.id));
const wrongRows = results.filter((r) => r.wrong.length > 0).flatMap((r) => r.wrong.map((w) => `| ${r.id} | ${r.candidate} | ${r.run} | ${w} | ${(r.transcript ?? "").replace(/\|/g, "/").slice(0, 160)} |`));
const errorRows = results.filter((r) => r.error).map((r) => `| ${r.id} | ${r.candidate} | ${r.run} | ${r.error} |`);
const perRec = perRecording(long).map((p) => `| ${p.id} | ${p.candidate} | ${p.exactRuns}/${p.runs} | ${p.bestWrong} | ${p.worstWrong} | ${p.avgWrong.toFixed(1)} | ${s1(p.avgSeconds)} |`);

const old = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "";
const kept = /<!-- summary -->([\s\S]*?)<!-- \/summary -->/.exec(old)?.[1] ?? "\n_Written by hand after the run: which candidate, why, and what it costs - in plain words._\n";

const md = `# KB-370 — Voice bake-off (V1, report only)

**Run:** ${meta.date.slice(0, 10)} · **Results file:** \`${path.relative(path.join(HERE, "..", ".."), file).replace(/\\/g, "/")}\` · Nothing in the app changed; no deploy.
**Rule for any winner:** 0 wrong numbers on a final line (\`docs/24-ROADMAP.md\` Phase V, D100). "Wrong" = a confident number or product that is not what was said; "silent" = no Theek hai warned about it.

## Summary
<!-- summary -->${kept}<!-- /summary -->

## What was compared
${CANDIDATES.map((c) => `- **${c}** - ${CANDIDATE_LABEL[c]}`).join("\n")}

Models (exact names): ${Object.entries(meta.models).map(([k, v]) => `${k} \`${v}\``).join(", ")}. Vocabulary (A+vocab, B): ${meta.vocabulary.length} terms from \`eval/real-transcripts.json\` - ${meta.vocabulary.join(", ")}.
Prices: ${PRICE_SOURCES}. Rupees at **Rs ${meta.inrPerUsd} per $** (the last RBI reference rate found when the run was set up; re-run \`npm run bakeoff -- --inr-per-usd <today's>\` to change it).
Seconds = the providers' own call times added up on the PC (end of recording -> items), not the phone's upload; D runs B and C side by side (the slower of the two).

## Short orders (A01-A50, once each)
${table(short)}

### The ${meta.setAside.length} orders Whisper mis-heard on 30 Oct (set aside from the gate): ${meta.setAside.join(", ")}
${table(setAside)}

## Long orders (A51-A62, ${meta.longRuns} runs each)
${long.length ? table(long) : "_No long order recorded yet._"}

### Long orders per recording (over the runs)
${perRec.length ? `| Recording | Candidate | Exact runs | Best (fewest wrong lines) | Worst | Average | Avg seconds |\n|---|---|---|---|---|---|---|\n${perRec.join("\n")}` : "_None yet._"}

## Every wrong line
${wrongRows.length ? `| Recording | Candidate | Run | What was wrong | What it heard |\n|---|---|---|---|---|\n${wrongRows.join("\n")}` : "_None._"}

## Errors and timeouts (the order showed nothing, never a wrong line)
${errorRows.length ? `| Recording | Candidate | Run | Error |\n|---|---|---|---|\n${errorRows.join("\n")}` : "_None._"}
`;
writeFileSync(REPORT, md);
console.log(`Wrote ${path.relative(process.cwd(), REPORT)} from ${path.basename(file)} (${results.length} results).`);
