/**
 * KB-370 (V1, owner 31 Oct 2026): the voice bake-off - a REPORT ONLY; nothing in the app changes. Each recording goes through each
 * candidate (score.ts CANDIDATE_LABEL) and is scored against the bill the owner wrote (eval/acceptance/sheet.txt).
 *     npm run bakeoff                         declare the calls and the cost - makes NO call
 *     npm run bakeoff -- --go                 run them (only after the owner's OK: D99 item 11, the key shares production's quota)
 *     npm run bakeoff -- --go --only A51,A52 --candidates A,B,C,D --long-runs 3
 *     npm run bakeoff -- --go --diagnose      ONE gemini-3.5-transcribe call on A01: prints the raw answer's fields (KB-370 fix)
 *     npm run bakeoff -- --go --canary --candidates B,C,D        docs/23 section 8: A01, A61, A62 once each, prints transcript + items, STOPS
 *     npm run bakeoff -- --go --candidates B,C,D --merge eval/bakeoff/results-2026-10-31.json --drop B-novocab --cap-inr 170
 *   --merge replaces those candidates' rows (and --drop's) in an earlier results file; --cap-inr stops the run when its logged spend reaches it;
 *   --pace-transcribe-s spaces gemini-3.5-transcribe calls (default 12: its per-minute limit is not published, 429s on 1 Nov).
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
import { CANDIDATES, candidatesFor, declare, groqUsd, RUN1, scoreRun, tokensUsd, webmSeconds, type CandidateId, type Recording, type RunResult } from "./score.js";
import { geminiUrl, inlineAudio } from "../../src/voice/geminiAudio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const go = process.argv.includes("--go");
const canary = process.argv.includes("--canary");
const diagnose = process.argv.includes("--diagnose");
const mergeFile = arg("merge");
const drop = arg("drop")?.split(",") ?? [];
const capInr = arg("cap-inr") ? Number(arg("cap-inr")) : Infinity;
const pace = { transcribeS: Number(arg("pace-transcribe-s") ?? 12), otherS: 3 };
/** docs/23 section 8: one short order and the two longest. */
const CANARY_IDS = ["A01", "A61", "A62"];
const only = canary ? CANARY_IDS : arg("only")?.split(",");
const chosen = (arg("candidates")?.split(",") ?? [...CANDIDATES]) as CandidateId[];
const longRuns = canary ? 1 : Number(arg("long-runs") ?? 3);
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
const now = declare(recordings, longRuns, chosen, pace);
const projected = declare([...recordings, ...Array.from({ length: LONG_SLOTS - longHave }, (_, i) => ({ id: `A${51 + longHave + i}`, set: "long" as const, seconds: 60 }))], longRuns, chosen, pace);
const audioMin = recordings.reduce((a, r) => a + r.seconds, 0) / 60;
const fmt = (d: ReturnType<typeof declare>) =>
  `${d.total} calls - Groq ${d.calls.groq}, ${GEMINI_TRANSCRIBE_MODEL} ${d.calls.transcribe}, Layer 2 (${DEFAULT_GEMINI_MODEL}, text) at most ${d.calls.layer2Max}, ` +
  `audio ${DEFAULT_GEMINI_MODEL} ${d.calls.audioLite}, audio ${C2_MODEL} ${d.calls.audioFlash}; about Rs ${(d.usd * inrPerUsd).toFixed(0)} ($${d.usd.toFixed(2)} at Rs ${inrPerUsd}/$; ` +
  `the 1 Nov run's real per-call cost x its real bill ratio ${RUN1.billRatio.toFixed(2)}); about ${Math.ceil(d.minutes)} min if the machine stays awake`;
console.log(`KB-370 bake-off${canary ? " - CANARY (docs/23 section 8: A01, A61, A62 once each, then STOP)" : ""} - candidates: ${chosen.join(", ")}${chosen.includes("D") ? " (D reuses B's and C's answers: no calls of its own)" : ""}`);
console.log(`Recordings with a written bill: ${recordings.filter((r) => r.set === "short").length} short (A01-A50, ${[...expectedOf.values()].filter((o) => o.setAside).length} of them the set-aside Whisper-misheard orders), ${longHave} of ${LONG_SLOTS} long (A51-A62); ${audioMin.toFixed(1)} min of audio in all`);
console.log(`Runs: short orders once, long orders ${longRuns} times. Vocabulary: ${vocabulary.length} terms from eval/real-transcripts.json.`);
console.log(`NOW:          ${fmt(now)}`);
if (longHave < LONG_SLOTS && !only) console.log(`WITH A51-A62: ${fmt(projected)}  (the missing long orders estimated at 60 s each)`);
console.log(`Pace: ${GEMINI_TRANSCRIBE_MODEL} calls ${pace.transcribeS} s apart, the others ${pace.otherS} s.${Number.isFinite(capInr) ? ` Spend cap: the run stops itself at Rs ${capInr} of logged spend.` : ""}`);
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
const mime = (file: string) => ({ webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" })[path.extname(file).slice(1)] ?? "application/octet-stream";

if (diagnose) {
  // ONE call, the raw answer's SHAPE: which fields the transcribe model fills (KB-370: the first run read "" from it). Never the key.
  const rec = recordings.find((r) => r.id === "A01") ?? recordings[0]!;
  const body = { contents: [{ role: "user", parts: [{ inlineData: await inlineAudio(new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) })) }] }], generationConfig: { audioTranscriptionConfig: { languageCodes: ["hi-IN"] } } };
  const res = await fetch(geminiUrl(GEMINI_TRANSCRIBE_MODEL), { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey }, body: JSON.stringify(body) });
  const raw = (await res.json()) as Record<string, unknown>;
  const shape = (v: unknown, depth = 0): unknown => (depth > 6 ? "..." : Array.isArray(v) ? (v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : []) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)])) : typeof v === "string" ? `string(${v.length})` : v);
  console.log(`HTTP ${res.status} - the answer's fields (strings shown as their length):\n${JSON.stringify(shape(raw), null, 2)}`);
  const parts = ((raw.candidates as { content?: { parts?: Record<string, unknown>[] } }[] | undefined)?.[0]?.content?.parts ?? []);
  for (const p of parts) {
    if (typeof p.text === "string") console.log(`text part: "${p.text.slice(0, 200)}"`);
    const words = (p.audioTranscription as { words?: { word?: string }[] } | undefined)?.words;
    if (words) console.log(`audioTranscription.words (${words.length}): "${words.slice(0, 40).map((w) => w.word).join(" ")}"`);
  }
  console.log(`usageMetadata: ${JSON.stringify(raw.usageMetadata ?? null)}`);
  process.exit(0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The pause comes BEFORE a call, so it is never counted as the call's seconds. Only a BUSY answer (a quota, Google overloaded) is retried -
 * a timeout is a result (the point of A vs A-30s). */
async function paced<T>(call: () => Promise<T>, paceS = pace.otherS): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await sleep(paceS * 1000);
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof ProviderError && e.kind === "busy") || attempt >= 4) throw e;
      await sleep(attempt * 15_000);
    }
  }
}

const layer2 = createGeminiParseProvider(geminiKey);
/** Layer 2 through the SHIPPED provider and prompt, counting its cost (thinking tokens included: total - prompt) and its seconds. */
const parseWith = (cost: { usd: number; ms: number }) => async (text: string, slice: readonly CatalogEntry[]): Promise<ParsedItem[]> => {
  const r = await paced(() => layer2.parse(text, { catalogSlice: [...slice] }));
  cost.usd += tokensUsd(DEFAULT_GEMINI_MODEL, { ...r.usage, completionTokens: r.usage.totalTokens - r.usage.promptTokens });
  cost.ms += r.latencyMs;
  return r.items;
};
const entries = [...shop.entries];
const out = canary ? path.join(HERE, `results-canary-${new Date().toISOString().slice(0, 10)}.json`) : mergeFile ? path.resolve(mergeFile) : path.join(HERE, `results-${new Date().toISOString().slice(0, 10)}.json`);
// --merge: keep every earlier row except the candidates re-run now and those dropped (e.g. B-novocab, measured as "" on 1 Nov)
const earlier = mergeFile ? (JSON.parse(readFileSync(path.resolve(mergeFile), "utf8")) as { meta: Record<string, unknown>; results: RunResult[] }) : null;
const kept = (earlier?.results ?? []).filter((r) => !chosen.includes(r.candidate) && !drop.includes(r.candidate));
const results: RunResult[] = [];
let spentUsd = 0;
const save = () =>
  writeFileSync(out, JSON.stringify({ meta: { ...(earlier?.meta ?? {}), date: new Date().toISOString(), longRuns: earlier ? earlier.meta.longRuns : longRuns, inrPerUsd, vocabulary, models: { groq: "whisper-large-v3", transcribe: GEMINI_TRANSCRIBE_MODEL, layer2: DEFAULT_GEMINI_MODEL, c: DEFAULT_GEMINI_MODEL, c2: C2_MODEL }, setAside: [...expectedOf].filter(([, o]) => o.setAside).map(([id]) => id), ...(mergeFile ? { rerun: { candidates: chosen, dropped: drop, at: new Date().toISOString() } } : {}) }, results: [...kept, ...results] }, null, 2) + "\n");
const compact = (bill: ActualBill) => bill.lines.map(({ item: i }) => ({ name: i.spokenName, catalogId: i.catalogId, qty: i.qty, unit: i.unit, rate: i.rate, total: i.total, priceType: i.priceType }));

outer: for (const rec of recordings) {
  const { expected } = expectedOf.get(rec.id)!;
  const blob = () => new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) });
  const runs = rec.set === "long" ? longRuns : 1;
  for (let run = 1; run <= runs; run++) {
    const answers: Partial<Record<"B" | "C", { transcript: string; items?: ParsedItem[]; seconds: number; usd: number }>> = {};
    for (const candidate of candidatesFor(rec.set).concat("D").filter((c) => chosen.includes(c))) {
      if (spentUsd * inrPerUsd >= capInr) {
        console.log(`\nSPEND CAP reached: Rs ${(spentUsd * inrPerUsd).toFixed(1)} logged >= Rs ${capInr} - the run stops here (results so far are saved).`);
        break outer;
      }
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
          const r = await paced(() => b.transcribe(blob(), { language: "hi", ...(candidate === "B" ? { vocabulary } : {}) }), pace.transcribeS);
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
      if (candidate !== "D") spentUsd += cost.usd; // D's cost is B's and C's, already counted
      results.push({ candidate, id: rec.id, set: rec.set, run, transcript, seconds, usd: cost.usd, audioSeconds: rec.seconds, lines: compact(actual), ...(candidate === "C" && answers.C?.items ? { items: answers.C.items } : {}), ...(error ? { error } : {}), ...score });
      console.log(`${(error ? "ERR" : score.wrongLines ? "WRONG" : score.exact ? "exact" : "inexact").padEnd(7)} ${rec.id} run ${run} ${candidate.padEnd(9)} ${seconds.toFixed(1)} s${error ? `  ${error}` : ""}`);
      for (const w of score.wrong) console.log(`          ! ${w}`);
      if (canary) {
        // docs/23 section 8: the owner sees each candidate's transcript and items side by side before the full run
        console.log(`          heard: "${transcript ?? ""}"`);
        for (const l of compact(actual)) console.log(`          - ${l.qty ?? "?"} ${l.unit} ${l.name}${l.catalogId ? ` [${shop.byId.get(l.catalogId)?.displayName}]` : " [custom]"} ${l.priceType}${l.rate !== null ? ` rate Rs ${l.rate / 100}` : ""}${l.total !== null ? ` total Rs ${l.total / 100}` : ""}`);
      }
    }
    save();
  }
}
console.log(`\nDone: ${results.length} results in ${path.relative(process.cwd(), out)}; logged spend Rs ${(spentUsd * inrPerUsd).toFixed(1)}.${canary ? " CANARY: STOP here - the owner looks before the full run (docs/23 section 8)." : " Next: npm run bakeoff:report"}`);
