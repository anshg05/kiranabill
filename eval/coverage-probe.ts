/**
 * KB-009 - THE GATE. Runs the real deterministic parser (Layer 1,
 * domain/grammar.ts, including the KB-005d orphaned-marker fix) over both
 * eval fixtures - eval/voice-cases.json (25) and eval/number-benchmark.json
 * (100), 125 total - and reports fast-path coverage with grouped miss
 * reasons, per docs/06-FEATURE-TICKETS.md's KB-009 row and
 * docs/04-VOICE-PIPELINE.md section 3's "log fastPathHit/fastPathMiss with
 * a reason on every utterance."
 *
 * "Hit" here means exactly what the owner specified: parseUtterance()
 * returned non-null. matchStatus ("matched"/"ambiguous"/"none") is
 * irrelevant to this measurement - an ambiguous-but-resolved item is still
 * a fast-path hit, because Layer 1 didn't need to fall back to an LLM to
 * produce SOME structured line, even an uncertain one.
 *
 * This script measures. It does not decide anything about the 40%/60-70%
 * thresholds - that's the owner's call per 18-AGENT-CONTRACT.md section 11,
 * reported on but not acted on here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseUtterance, diagnoseUtterance, type MissReason } from "../src/domain/grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface FixtureCase {
  readonly id: string;
  readonly utterance: string;
}

function loadCases(filename: string): readonly FixtureCase[] {
  const raw = readFileSync(path.join(__dirname, filename), "utf8");
  return JSON.parse(raw) as FixtureCase[];
}

function main(): void {
  const voiceCases = loadCases("voice-cases.json");
  const numberCases = loadCases("number-benchmark.json");
  const allCases = [...voiceCases, ...numberCases];

  if (voiceCases.length !== 25) throw new Error(`voice-cases.json: expected 25 cases, found ${voiceCases.length}`);
  if (numberCases.length !== 129) throw new Error(`number-benchmark.json: expected 129 cases (100 + KB-005f's 10 + KB-302's 19), found ${numberCases.length}`);

  console.log(`Fast-path coverage probe (KB-009) - ${allCases.length} cases (${voiceCases.length} eval + ${numberCases.length} number-benchmark)\n`);

  let hits = 0;
  const misses: Array<{ readonly source: string; readonly id: string; readonly utterance: string; readonly reason: MissReason | null }> = [];

  for (const [source, cases] of [
    ["eval/voice-cases.json", voiceCases],
    ["eval/number-benchmark.json", numberCases],
  ] as const) {
    for (const c of cases) {
      const actual = parseUtterance(c.utterance);
      const diagnostics = diagnoseUtterance(c.utterance);
      if (actual !== null) {
        hits += 1;
      } else {
        misses.push({ source, id: c.id, utterance: c.utterance, reason: diagnostics.reason });
      }
    }
  }

  const total = allCases.length;
  const missCount = misses.length;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  console.log("Every miss, in full:");
  for (const m of misses) {
    console.log(`  [MISS] ${m.source} ${m.id}  "${m.utterance}"  -> ${m.reason}`);
  }
  if (misses.length === 0) console.log("  (none)");

  console.log("\nMiss reasons grouped:");
  const grouped = new Map<string, number>();
  for (const m of misses) {
    const key = m.reason ?? "(no reason - should not happen)";
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  if (grouped.size === 0) {
    console.log("  (no misses)");
  } else {
    for (const [reason, count] of [...grouped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(3)}  (${pct(count)}%)  ${reason}`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log(`FAST-PATH COVERAGE: ${hits}/${total} = ${pct(hits)}% HIT, ${missCount}/${total} = ${pct(missCount)}% MISS (bail)`);
  console.log("=".repeat(78));

  console.log(`\nTargets, for reference only - this script does not act on them:`);
  console.log(`  01-PRD.md S6 / 04-VOICE-PIPELINE.md section 9 target: 60-70%`);
  console.log(`  18-AGENT-CONTRACT.md section 11 stop-gate: under 40% means stop and report to the owner`);
}

main();
