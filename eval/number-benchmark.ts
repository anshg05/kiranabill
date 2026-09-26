/**
 * KB-006 - the number benchmark. This is a MEASUREMENT, not a pass/fail
 * test suite: 100 utterances built to stress numbers (Hindi numerals,
 * fractions including paune/sawa compositional forms, wala/ka minimal
 * pairs, two-number utterances, confusable pairs), run through the real
 * parseUtterance() pipeline, and scored into exactly three outcomes:
 *
 *   correct - matches the hand-verified expected answer
 *   bail    - the system declined to commit to a number (null, or a
 *             resolved item with priceType "unknown") when a real answer
 *             existed to find - safe, but incomplete
 *   wrong   - the system confidently produced a number that is NOT the
 *             expected one - the dangerous case the whole product thesis
 *             (docs/01-PRD.md: "never silently get a number wrong") exists
 *             to prevent, and the headline number in this report
 *
 * WER is explicitly out of scope: Phase 0 has no STT call anywhere, so
 * there is no real transcript to compare a transcript against - only
 * written text through a deterministic parser. "Confusable pairs" are
 * therefore tested as minimal-pair correct forms (docs/14-LEGACY-
 * REFERENCE.md-style, same shape as KB-005's ka/wala differentiator) plus
 * adversarial substituted forms (as if a mishearing had already produced
 * that text) - each case's expected.safe flag marks which.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseUtterance, type ParsedItem, type PriceType } from "../src/domain/grammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ExpectedOutcome {
  readonly safe: boolean;
  readonly qty: number | null;
  readonly unit: string | null;
  readonly rate: number | null;
  readonly total: number | null;
  readonly priceType: PriceType | null;
  /** KB-005f: set only on cases where the rate's unit differs from the line's
   * (e.g. 500 gm at a per-kg rate); compared only when present, so the
   * original 100 cases are scored exactly as before. */
  readonly rateUnit?: string | null;
}

interface BenchmarkCase {
  readonly id: string;
  readonly category: string;
  readonly utterance: string;
  readonly expected: ExpectedOutcome;
  readonly note?: string;
}

type Outcome = "correct" | "bail" | "wrong" | "anomaly";

interface CaseResult {
  readonly benchmarkCase: BenchmarkCase;
  readonly outcome: Outcome;
  readonly actualItems: readonly ParsedItem[] | null;
}

function loadCases(): readonly BenchmarkCase[] {
  const raw = readFileSync(path.join(__dirname, "number-benchmark.json"), "utf8");
  const cases = JSON.parse(raw) as BenchmarkCase[];
  // 100 original cases (KB-006) + 10 cross-unit cases (KB-005f, NB101-NB110).
  if (cases.length !== 110) {
    throw new Error(`number-benchmark.json: expected exactly 110 cases, found ${cases.length}`);
  }
  return cases;
}

function isConfident(item: ParsedItem): boolean {
  return item.priceType !== "unknown";
}

function matchesExpected(item: ParsedItem, expected: ExpectedOutcome): boolean {
  return (
    item.qty === expected.qty &&
    item.unit === expected.unit &&
    item.rate === expected.rate &&
    item.total === expected.total &&
    item.priceType === expected.priceType &&
    (expected.rateUnit === undefined || item.rateUnit === expected.rateUnit)
  );
}

function classify(benchmarkCase: BenchmarkCase): CaseResult {
  const actualItems = parseUtterance(benchmarkCase.utterance);
  const { expected } = benchmarkCase;

  if (actualItems === null) {
    const outcome: Outcome = expected.safe || benchmarkCase.category === "bail" ? "correct" : "bail";
    return { benchmarkCase, outcome, actualItems };
  }

  if (actualItems.length !== 1) {
    return { benchmarkCase, outcome: "anomaly", actualItems };
  }

  const item = actualItems[0]!;
  const confident = isConfident(item);

  if (expected.safe) {
    return { benchmarkCase, outcome: confident ? "wrong" : "correct", actualItems };
  }

  if (matchesExpected(item, expected)) {
    return { benchmarkCase, outcome: "correct", actualItems };
  }
  return { benchmarkCase, outcome: confident ? "wrong" : "bail", actualItems };
}

function formatItem(item: ParsedItem | undefined): string {
  if (!item) return "(no item)";
  return `spokenName="${item.spokenName}" catalogId=${item.catalogId} matchStatus=${item.matchStatus} qty=${item.qty} rateUnit=${item.rateUnit} unit="${item.unit}" rate=${item.rate} total=${item.total} priceType=${item.priceType}`;
}

function formatExpected(expected: ExpectedOutcome): string {
  if (expected.safe) return "(safe - no confident number should be produced)";
  return `qty=${expected.qty} unit="${expected.unit}" rate=${expected.rate} total=${expected.total} priceType=${expected.priceType}`;
}

function main(): void {
  const cases = loadCases();
  const results = cases.map(classify);

  const counts: Record<Outcome, number> = { correct: 0, bail: 0, wrong: 0, anomaly: 0 };
  for (const r of results) counts[r.outcome] += 1;

  const wrongResults = results.filter((r) => r.outcome === "wrong");
  const anomalyResults = results.filter((r) => r.outcome === "anomaly");

  console.log(`Number benchmark - ${cases.length} cases\n`);

  if (wrongResults.length > 0) {
    console.log("=".repeat(78));
    console.log(`FALSE CONFIDENCE - ${wrongResults.length} case(s) produced a confident WRONG number`);
    console.log("This is the failure category the whole benchmark exists to catch.");
    console.log("=".repeat(78));
    for (const r of wrongResults) {
      console.log(`\n[WRONG] ${r.benchmarkCase.id} (${r.benchmarkCase.category}) "${r.benchmarkCase.utterance}"`);
      if (r.benchmarkCase.note) console.log(`  note: ${r.benchmarkCase.note}`);
      console.log(`  expected: ${formatExpected(r.benchmarkCase.expected)}`);
      console.log(`  actual:   ${formatItem(r.actualItems?.[0])}`);
    }
    console.log();
  } else {
    console.log("FALSE CONFIDENCE: 0 cases. No confident wrong numbers found in this run.\n");
  }

  if (anomalyResults.length > 0) {
    console.log(`ANOMALIES - ${anomalyResults.length} case(s) returned an unexpected item count:`);
    for (const r of anomalyResults) {
      console.log(`  ${r.benchmarkCase.id} "${r.benchmarkCase.utterance}" -> ${r.actualItems?.length ?? "null"} items`);
    }
    console.log();
  }

  console.log("Per-case results:");
  for (const r of results) {
    const tag = r.outcome.toUpperCase().padEnd(7);
    console.log(`  [${tag}] ${r.benchmarkCase.id} (${r.benchmarkCase.category})  "${r.benchmarkCase.utterance}"`);
  }

  console.log("\nBy category:");
  const categories = [...new Set(cases.map((c) => c.category))];
  for (const category of categories) {
    const inCategory = results.filter((r) => r.benchmarkCase.category === category);
    const correct = inCategory.filter((r) => r.outcome === "correct").length;
    const bail = inCategory.filter((r) => r.outcome === "bail").length;
    const wrong = inCategory.filter((r) => r.outcome === "wrong").length;
    console.log(`  ${category.padEnd(12)} ${inCategory.length.toString().padStart(3)} total   ${correct} correct / ${bail} bail / ${wrong} wrong`);
  }

  const pct = (n: number) => ((n / cases.length) * 100).toFixed(1);
  console.log("\n" + "=".repeat(78));
  console.log(`SUMMARY (of ${cases.length}):`);
  console.log(`  correct: ${counts.correct} (${pct(counts.correct)}%)`);
  console.log(`  bail:    ${counts.bail} (${pct(counts.bail)}%)`);
  console.log(`  WRONG (false confidence): ${counts.wrong} (${pct(counts.wrong)}%)  <-- headline number`);
  if (counts.anomaly > 0) console.log(`  anomaly: ${counts.anomaly} (${pct(counts.anomaly)}%)`);
  console.log("=".repeat(78));
}

main();
