/**
 * KB-317 - fast-path hit rate on REAL transcripts (12-PARKED.md KI-49).
 *
 * eval/voice-cases.json and number-benchmark.json are Roman-script text typed
 * by hand; real input is Whisper Devanagari. This runs the owner's real
 * transcripts (eval/real-transcripts.json, expected lines confirmed by the
 * owner) through the SHIPPED routing - data/voiceBilling.ts resolveUtterance,
 * against the base seed (content-identical to a base-imported shop). Where
 * Gemini would be called, a stub records the miss and returns nothing: this
 * measures Layer 1 only and never spends Gemini quota.
 *
 * Per case: HIT (Layer 1 answered) correct/WRONG, or MISS (-> Gemini) with the
 * reason. A WRONG hit is the dangerous outcome - a confident wrong line.
 *
 * Run: npm run eval:real
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUtterance } from "../src/data/voiceBilling.js";
import { diagnoseUtterance } from "../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../src/domain/seedCatalog.js";

export interface ExpectedLine {
  catalogId: string | null;
  displayName: string;
  qty: number | null;
  unit: string;
  total: number | null;
}

export interface RealTranscriptCase {
  id: string;
  source: string;
  transcript: string;
  expectedLines: ExpectedLine[];
  expectedFlags?: string[];
  /** A recording in eval/real-audio/ this transcript came from (eval/real-audio.ts). */
  audio?: string;
  note?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadRealTranscripts(): RealTranscriptCase[] {
  return JSON.parse(readFileSync(path.join(here, "real-transcripts.json"), "utf8")) as RealTranscriptCase[];
}

export type Outcome = "hit-correct" | "hit-wrong" | "miss";

export interface CaseResult {
  outcome: Outcome;
  detail: string;
}

/** Count units are interchangeable for a line's spoken unit (D14): "packet" vs "piece". */
function sameUnit(a: string, b: string): boolean {
  const count = new Set(["piece", "packet", "pouch", "box", "bottle", "can", "tin", "bag", "dozen"]);
  return a === b || (count.has(a) && count.has(b));
}

/** Layer 1 on one transcript, scored against its expected lines. */
export async function scoreTranscript(transcript: string, expected: ExpectedLine[], expectedFlags: string[] = []): Promise<CaseResult> {
  let geminiCalled = false;
  const r = await resolveUtterance(transcript, {
    shop: SEED_PARSER_CATALOG,
    parse: async () => {
      geminiCalled = true;
      return [];
    },
  });
  if (geminiCalled) {
    const d = diagnoseUtterance(transcript, SEED_PARSER_CATALOG);
    return { outcome: "miss", detail: d.hit ? "parsed, but rejected by the hit rule (unmatched product or a HIGH number flag)" : `bail: ${d.reason}` };
  }
  const got = r.lines.map((l) => l.item);
  const linesOk =
    got.length === expected.length &&
    got.every((g, i) => {
      const e = expected[i]!;
      return g.catalogId === e.catalogId && g.qty === e.qty && sameUnit(g.unit, e.unit) && g.total === e.total;
    });
  const codes = new Set(r.flags.map((f) => f.code));
  const missingFlags = expectedFlags.filter((f) => !codes.has(f as never));
  const shown = got.map((g) => `${g.catalogId}:${g.qty ?? "—"}${g.unit}=${g.total ?? "—"}`).join(" ; ");
  if (linesOk && missingFlags.length === 0) return { outcome: "hit-correct", detail: shown };
  return { outcome: "hit-wrong", detail: `${shown}${missingFlags.length ? ` | missing flags: ${missingFlags.join(", ")}` : ""}` };
}

async function main(): Promise<void> {
  const cases = loadRealTranscripts();
  const counts: Record<Outcome, number> = { "hit-correct": 0, "hit-wrong": 0, miss: 0 };
  console.log(`Real-transcript fast-path eval (KB-317) - ${cases.length} cases\n`);
  for (const c of cases) {
    const r = await scoreTranscript(c.transcript, c.expectedLines, c.expectedFlags);
    counts[r.outcome] += 1;
    const label = r.outcome === "hit-correct" ? "HIT  correct" : r.outcome === "hit-wrong" ? "HIT  WRONG  " : "MISS        ";
    console.log(`  [${label}] ${c.id} "${c.transcript}"\n                 ${r.detail}`);
  }
  const hits = counts["hit-correct"] + counts["hit-wrong"];
  console.log(
    `\nSUMMARY (of ${cases.length}): fast-path hits ${hits} (${((100 * hits) / cases.length).toFixed(1)}%) - correct ${counts["hit-correct"]}, ` +
      `WRONG ${counts["hit-wrong"]} <-- confident wrong lines; misses (-> Gemini) ${counts.miss}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
