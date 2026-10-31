/**
 * KB-370 (V1, owner 31 Oct 2026): the voice bake-off - a REPORT ONLY; nothing in the app changes. Each recording goes through each
 * candidate (score.ts CANDIDATE_LABEL) and is scored against the bill the owner wrote (eval/acceptance/sheet.txt).
 *     npm run bakeoff                         declare the calls and the cost - makes NO call
 *     npm run bakeoff -- --go                 run them (only after the owner's OK: D99 item 11, the key shares production's quota)
 *     npm run bakeoff -- --go --only A51,A52 --candidates A,B,C,D --long-runs 3
 * Then:  npm run bakeoff:report   (writes eval/bakeoff/REPORT.md from the results file; offline, free)
 * Keys: GROQ_API_KEY and GEMINI_API_KEY_EVAL from .env.local - read here, never printed. The recordings are never committed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import type { CatalogEntry } from "../../src/domain/catalog.js";
import { ProviderError } from "../../src/voice/deadline.js";
import { DEFAULT_GEMINI_MODEL } from "../../src/voice/geminiModel.js";
import { createGeminiAudioParseProvider } from "../../src/voice/geminiAudioParseProvider.js";
import { createGeminiParseProvider } from "../../src/voice/geminiParseProvider.js";
import { createGeminiTranscriptionProvider, GEMINI_TRANSCRIBE_MODEL } from "../../src/voice/geminiTranscriptionProvider.js";
import { createGroqTranscriptionProvider } from "../../src/voice/groqTranscriptionProvider.js";
import type { ActualBill } from "../acceptance/compare.js";
import { runOrder } from "../acceptance/run.js";
import { parseSheet } from "../acceptance/sheet.js";
import { AUDIO_DIR, SHEET } from "../acceptance/store.js";
import type { ExpectedBill } from "../acceptance/types.js";
import { checkAudioAnswer, hybridItems } from "./pipeline.js";
import { CANDIDATES, candidatesFor, declare, groqUsd, scoreRun, tokensUsd, webmSeconds, type CandidateId, type Recording, type RunResult } from "./score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const go = process.argv.includes("--go");
const only = arg("only")?.split(",");
const chosen = (arg("candidates")?.split(",") ?? [...CANDIDATES]) as CandidateId[];
const longRuns = Number(arg("long-runs") ?? 3);
/** The last RBI reference rate found on 31 Oct 2026: 95.17 (2 Jun 2026, cbonds). Pass today's with --inr-per-usd. */
const inrPerUsd = Number(arg("inr-per-usd") ?? 95.17);
const C2_MODEL = "gemini-3.8-flash";
const A30_TIMEOUT_MS = 30_000;
/** The owner dropped A41 (30 Oct: a spoken "remove the last one" is not needed now); A13 has no written bill. */
const OWNER_DROPPED = new Set(["A41"]);
const LONG_SLOTS = 12;
const shop = SEED_PARSER_CATALOG;

// ---- the orders: every sheet block with a written bill, the 7 Whisper-misheard SKIP blocks included -------------------------------
const sheet = parseSheet(readFileSync(SHEET, "utf8"));
const expectedOf = new Map<string, { expected: ExpectedBill; category: string; setAside: boolean }>();
for (const o of sheet.orders) {
  const expected = o.expected ?? o.skippedExpected;
  if (expected && !OWNER_DROPPED.has(o.id)) expectedOf.set(o.id, { expected, category: o.category, setAside: !o.expected });
}
const audioFiles = existsSync(AUDIO_DIR) ? readdirSync(AUDIO_DIR) : [];
const recordings: (Recording & { file: string })[] = [];
for (const [id, o] of expectedOf) {
  const file = audioFiles.find((f) => f.startsWith(`${id}.`));
  if (!file || (only && !only.includes(id))) continue;
  recordings.push({ id, set: o.category === "long-30-90s" ? "long" : "short", seconds: webmSeconds(readFileSync(path.join(AUDIO_DIR, file))), file });
}
const longHave = recordings.filter((r) => r.set === "long").length;

// ---- the vocabulary (owner, 31 Oct): the products of eval/real-transcripts.json, most-billed first, name + its Hindi alias, <= 100 terms
const real = JSON.parse(readFileSync(path.join(HERE, "..", "real-transcripts.json"), "utf8")) as { expectedLines?: { catalogId: string | null }[] }[];
const freq = new Map<string, number>();
for (const c of real) for (const l of c.expectedLines ?? []) if (l.catalogId) freq.set(l.catalogId, (freq.get(l.catalogId) ?? 0) + 1);
const vocabulary = [...freq.entries()]
  .sort((a, b) => b[1] - a[1])
  .flatMap(([id]) => {
    const e = shop.byId.get(id);
    const hindi = e?.aliases.find((a) => /[ऀ-ॿ]/.test(a));
    return e ? [e.displayName, ...(hindi ? [hindi] : [])] : [];
  })
  .slice(0, 100);

// ---- the declaration (always printed; nothing is called without --go) -------------------------------------------------------------
const now = declare(recordings, longRuns);
const projected = declare([...recordings, ...Array.from({ length: LONG_SLOTS - longHave }, (_, i) => ({ id: `A${51 + longHave + i}`, set: "long" as const, seconds: 60 }))], longRuns);
const audioMin = recordings.reduce((a, r) => a + r.seconds, 0) / 60;
const fmt = (d: ReturnType<typeof declare>) =>
  `${d.total} calls - Groq ${d.calls.groq}, ${GEMINI_TRANSCRIBE_MODEL} ${d.calls.transcribe}, Layer 2 (${DEFAULT_GEMINI_MODEL}, text) at most ${d.calls.layer2Max}, ` +
  `audio ${DEFAULT_GEMINI_MODEL} ${d.calls.audioLite}, audio ${C2_MODEL} ${d.calls.audioFlash}; about $${d.usd.toFixed(2)} (Rs ${(d.usd * inrPerUsd).toFixed(0)} at Rs ${inrPerUsd}/$)`;
console.log(`KB-370 bake-off - candidates: ${CANDIDATES.join(", ")} (D reuses B's and C's answers: no calls of its own)`);
console.log(`Recordings with a written bill: ${recordings.filter((r) => r.set === "short").length} short (A01-A50, ${[...expectedOf.values()].filter((o) => o.setAside).length} of them the set-aside Whisper-misheard orders), ${longHave} of ${LONG_SLOTS} long (A51-A62); ${audioMin.toFixed(1)} min of audio in all`);
console.log(`Runs: short orders once, long orders ${longRuns} times. Vocabulary: ${vocabulary.length} terms from eval/real-transcripts.json.`);
console.log(`NOW:          ${fmt(now)}`);
if (longHave < LONG_SLOTS) console.log(`WITH A51-A62: ${fmt(projected)}  (the missing long orders estimated at 60 s each)`);
console.log(`Key: GEMINI_API_KEY_EVAL (treated as sharing production's quota - calls are paced). Layer 2 is called only for pieces Layer 1 cannot read, so its count is a ceiling.`);
if (!go) {
  console.log("\nNo call made. Re-run with --go after the owner's OK.");
  process.exit(0);
}

// ---- the live run -----------------------------------------------------------------------------------------------------------------
process.loadEnvFile(".env.local");
const groqKey = process.env.GROQ_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY_EVAL;
if (!groqKey || !geminiKey) throw new Error("GROQ_API_KEY / GEMINI_API_KEY_EVAL not set (.env.local)");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = 3_000;
/** The pause comes BEFORE a call, so it is never counted as the call's seconds. Only a BUSY answer (a quota, Google overloaded) is retried -
 * a timeout is a result (the point of A vs A-30s). */
async function paced<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await sleep(PACE_MS);
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof ProviderError && e.kind === "busy") || attempt >= 4) throw e;
      await sleep(attempt * 15_000);
    }
  }
}
const mime = (file: string) => ({ webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" })[path.extname(file).slice(1)] ?? "application/octet-stream";

const layer2 = createGeminiParseProvider(geminiKey);
/** Layer 2 through the SHIPPED provider and prompt, counting its cost and its seconds. */
const parseWith = (cost: { usd: number; ms: number }) => async (text: string, slice: readonly CatalogEntry[]): Promise<ParsedItem[]> => {
  const r = await paced(() => layer2.parse(text, { catalogSlice: [...slice] }));
  cost.usd += tokensUsd(DEFAULT_GEMINI_MODEL, r.usage);
  cost.ms += r.latencyMs;
  return r.items;
};
const entries = [...shop.entries];
const out = path.join(HERE, `results-${new Date().toISOString().slice(0, 10)}.json`);
const results: RunResult[] = [];
const save = () => writeFileSync(out, JSON.stringify({ meta: { date: new Date().toISOString(), longRuns, inrPerUsd, vocabulary, models: { groq: "whisper-large-v3", transcribe: GEMINI_TRANSCRIBE_MODEL, layer2: DEFAULT_GEMINI_MODEL, c: DEFAULT_GEMINI_MODEL, c2: C2_MODEL }, setAside: [...expectedOf].filter(([, o]) => o.setAside).map(([id]) => id) }, results }, null, 2) + "\n");

for (const rec of recordings) {
  const { expected } = expectedOf.get(rec.id)!;
  const blob = () => new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) });
  const runs = rec.set === "long" ? longRuns : 1;
  for (let run = 1; run <= runs; run++) {
    const answers: Partial<Record<"B" | "C", { transcript: string; items?: ParsedItem[]; seconds: number; usd: number }>> = {};
    for (const candidate of candidatesFor(rec.set).concat("D").filter((c) => chosen.includes(c))) {
      // seconds = the providers' own call times added up (stop -> items on the PC; the pacing pause and busy retries are not counted)
      const cost = { usd: 0, ms: 0 };
      let transcript: string | null = null;
      let actual: ActualBill;
      let error: string | undefined;
      try {
        if (candidate.startsWith("A")) {
          const groq = createGroqTranscriptionProvider(groqKey, undefined, candidate === "A-30s" ? A30_TIMEOUT_MS : undefined);
          const r = await paced(() => groq.transcribe(blob(), { language: "hi", ...(candidate === "A+vocab" ? { vocabulary } : {}) }));
          transcript = r.text;
          cost.usd += groqUsd(rec.seconds);
          cost.ms += r.latencyMs;
          actual = await runOrder(transcript, parseWith(cost));
        } else if (candidate.startsWith("B")) {
          const b = createGeminiTranscriptionProvider(geminiKey);
          const r = await paced(() => b.transcribe(blob(), { language: "hi", ...(candidate === "B" ? { vocabulary } : {}) }));
          transcript = r.text;
          cost.usd += tokensUsd(GEMINI_TRANSCRIBE_MODEL, r.usage);
          cost.ms += r.latencyMs;
          if (candidate === "B") answers.B = { transcript, seconds: r.latencyMs / 1000, usd: cost.usd };
          actual = await runOrder(transcript, parseWith(cost));
        } else if (candidate === "C" || candidate === "C2") {
          const model = candidate === "C" ? DEFAULT_GEMINI_MODEL : C2_MODEL;
          const r = await paced(() => createGeminiAudioParseProvider(geminiKey, { model }).parseAudio(blob(), { catalog: entries }));
          transcript = r.transcript;
          cost.usd += tokensUsd(model, r.usage);
          cost.ms += r.latencyMs;
          if (candidate === "C") answers.C = { transcript, items: r.items, seconds: r.latencyMs / 1000, usd: cost.usd };
          actual = checkAudioAnswer(transcript, r.items, shop);
        } else {
          const b = answers.B;
          const c = answers.C;
          if (!b || !c) throw new Error("D needs B's and C's answers for this run (one of them failed or was not run)");
          transcript = b.transcript;
          actual = checkAudioAnswer(b.transcript, hybridItems(b.transcript, c.items!), shop);
          cost.usd = b.usd + c.usd;
        }
      } catch (e) {
        error = e instanceof ProviderError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : (e as Error).message.slice(0, 160);
        actual = { lines: [], unresolved: 1, checks: 0 };
      }
      // D runs B and C side by side: its seconds are the slower of the two
      const seconds = candidate === "D" && answers.B && answers.C ? Math.max(answers.B.seconds, answers.C.seconds) : cost.ms / 1000;
      const score = scoreRun(rec.id, expected, actual, shop);
      results.push({ candidate, id: rec.id, set: rec.set, run, transcript, seconds, usd: cost.usd, ...(error ? { error } : {}), ...score });
      console.log(`${(error ? "ERR" : score.wrongLines ? "WRONG" : score.exact ? "exact" : "inexact").padEnd(7)} ${rec.id} run ${run} ${candidate.padEnd(9)} ${seconds.toFixed(1)} s${error ? `  ${error}` : ""}`);
      for (const w of score.wrong) console.log(`          ! ${w}`);
    }
    save();
  }
}
console.log(`\nDone: ${results.length} results in ${path.relative(process.cwd(), out)}. Next: npm run bakeoff:report`);
