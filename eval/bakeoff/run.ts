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
 *     npm run bakeoff -- --round2 [--canary] [--go] --cap-inr N   KB-370 round 2: B-smart, E-lite, E-flash, S - scored under D102;
 *       E-* need B's saved transcripts (--b-from, default eval/bakeoff/results-2026-10-31.json); B-smart runs on SMART_IDS once each.
 *     npm run bakeoff -- --round3 [--canary] [--go] --cap-inr N [--out FILE]   KB-370 nocat (6 Nov 2026): nocat-old, nocat-D103 - E-flash's call
 *       WITHOUT the catalog (our code fills an unspoken price), scored under D102 + D103; every audio answer's RAW items are saved.
 *     --out FILE writes the results there (two runs on one day must not overwrite each other).
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
import { checkAudioAnswer, d102Fill, flagNotHeardByB, hybridItems, nocatBill } from "./pipeline.js";
import { scoreRunD102 } from "./d102.js";
import { EZY_D102_NOCAT_PROMPT, EZY_D102_PROMPT, EZY_D103_NOCAT_PROMPT } from "./ezyPrompt.js";
import { createSarvamTranscriptionProvider } from "../../src/voice/sarvamTranscriptionProvider.js";
import { candidatesFor, declare, GST, groqUsd, ROUND1_CANDIDATES, SARVAM_INR_PER_MINUTE, scoreRun, toSaved, tokensUsd, webmSeconds, type CandidateId, type Recording, type RunResult } from "./score.js";
import { geminiUrl, inlineAudio } from "../../src/voice/geminiAudio.js";
import { AUDIO_PARSE_ADDENDUM } from "../../src/voice/geminiAudioParseProvider.js";
import { PRICING_GRAMMAR_PROMPT } from "../../src/voice/pricingGrammarPrompt.js";
import { DAILY_STOP, pacificDay, transcribeTokens, waitMs, type Sent } from "./quota.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const go = process.argv.includes("--go");
const canary = process.argv.includes("--canary");
const diagnose = process.argv.includes("--diagnose");
const diagnoseSarvam = process.argv.includes("--diagnose-sarvam");
const mergeFile = arg("merge");
const drop = arg("drop")?.split(",") ?? [];
const capInr = arg("cap-inr") ? Number(arg("cap-inr")) : Infinity;
/** gemini-3.5-transcribe: 10 RPM less 10% = one call every 6.7 s at most; long clips wait longer for the 10K TPM (quota.ts). */
const pace = { transcribeS: Number(arg("pace-transcribe-s") ?? 60 / 9), otherS: 3 };
/** docs/23 section 8: one short order and the two longest. */
const CANARY_IDS = ["A01", "A61", "A62"];
const only = canary ? CANARY_IDS : arg("only")?.split(",");
/** KB-370 round 2 (owner, 5 Nov 2026): the new candidates, scored under D102. */
const round2 = process.argv.includes("--round2");
// owner, 5 Nov 2026 (after the canary): B-smart (its reformatting breaks our reader) and E-lite (the "12 ... 110 rupees" line total) dropped
const ROUND2: CandidateId[] = ["E-flash", "E-flash-1ear", "S"];
/** KB-370 nocat (owner, 6 Nov 2026): E-flash's call without the catalog, the D102 prompt as it was and rewritten to D103 - scored D102 + D103. */
const round3 = process.argv.includes("--round3");
const ROUND3: CandidateId[] = ["nocat-old", "nocat-D103"];
const NOCAT_PROMPT: Partial<Record<CandidateId, string>> = { "nocat-old": EZY_D102_NOCAT_PROMPT, "nocat-D103": EZY_D103_NOCAT_PROMPT };
const d102Scoring = round2 || round3;
const chosen = (arg("candidates")?.split(",") ?? (round3 ? ROUND3 : round2 ? ROUND2 : [...ROUND1_CANDIDATES])) as CandidateId[];
/** B-smart (owner): the correction orders A39, A40, A59, all 12 long orders, and 10 short ones - once each. The 10 short: one or two from
 * each coverage group of A01-A50 (A13 has no written bill). */
const SMART_IDS = new Set(["A39", "A40", "A59", ...Array.from({ length: 12 }, (_, i) => `A${51 + i}`), "A01", "A02", "A07", "A14", "A18", "A23", "A28", "A34", "A42", "A47"]);
/** The lowest gemini-3.8-flash allows (docs/thinking); the canary confirms from the thinking tokens that it took effect. */
const E_FLASH_THINKING = { thinkingLevel: "low" };
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
// Prompt tokens estimated from the characters actually sent (about 3 characters a token for this mix of English, JSON and Devanagari).
const sliceChars = JSON.stringify(shop.entries.slice(0, 30).map((e) => ({ id: e.id, displayName: e.displayName, unit: e.unit, suggestedPricePaise: e.suggestedPricePaise }))).length;
const catalogChars = JSON.stringify(shop.entries.map((e) => ({ id: e.id, displayName: e.displayName, unit: e.unit, suggestedPricePaise: e.suggestedPricePaise }))).length;
const est = { layer2In: Math.ceil((PRICING_GRAMMAR_PROMPT.length + sliceChars + 300) / 3), cIn: Math.ceil((PRICING_GRAMMAR_PROMPT.length + AUDIO_PARSE_ADDENDUM.length + catalogChars) / 3), nocatIn: Math.ceil((EZY_D103_NOCAT_PROMPT.length + 30) / 3) };
// round 2: B-smart only on its recordings, once; the others on every recording, long ones `longRuns` times
const sum = (a: ReturnType<typeof declare>, b: ReturnType<typeof declare>): ReturnType<typeof declare> => ({
  calls: Object.fromEntries(Object.entries(a.calls).map(([k, v]) => [k, v + b.calls[k as keyof typeof a.calls]])) as typeof a.calls,
  total: a.total + b.total,
  usd: a.usd + b.usd,
  minutes: a.minutes + b.minutes,
});
const now = round2
  ? sum(declare(recordings.filter((r) => SMART_IDS.has(r.id)), 1, chosen.filter((c) => c === "B-smart"), pace, est, inrPerUsd), declare(recordings, longRuns, chosen.filter((c) => c !== "B-smart"), pace, est, inrPerUsd))
  : declare(recordings, longRuns, chosen, pace, est);
const projected = declare([...recordings, ...Array.from({ length: LONG_SLOTS - longHave }, (_, i) => ({ id: `A${51 + longHave + i}`, set: "long" as const, seconds: 60 }))], longRuns, chosen, pace, est);
const audioMin = recordings.reduce((a, r) => a + r.seconds, 0) / 60;
const fmt = (d: ReturnType<typeof declare>) =>
  `${d.total} calls - Groq ${d.calls.groq}, ${GEMINI_TRANSCRIBE_MODEL} ${d.calls.transcribe}, Layer 2 (${DEFAULT_GEMINI_MODEL}, text) at most ${d.calls.layer2Max}, ` +
  `audio ${DEFAULT_GEMINI_MODEL} ${d.calls.audioLite}, audio ${C2_MODEL} ${d.calls.audioFlash}, Sarvam ${d.calls.sarvam}; about Rs ${(d.usd * inrPerUsd).toFixed(0)} ($${d.usd.toFixed(2)} at Rs ${inrPerUsd}/$: ` +
  `list prices x estimated tokens (prompts from their characters: Layer 2 ${est.layer2In}, C ${est.cIn} + audio) + a thinking allowance + ${GST * 100}% GST); ` +
  `about ${Math.ceil(d.minutes)} min if the machine stays awake` +
  (d.calls.transcribe ? `; ${GEMINI_TRANSCRIBE_MODEL} ${d.calls.transcribe} calls at most ${DAILY_STOP} a Pacific day = ${Math.ceil(d.calls.transcribe / DAILY_STOP)} day(s) (the run stops at ${DAILY_STOP} and resumes with the same command)` : "");
console.log(`KB-370 bake-off${canary ? " - CANARY (docs/23 section 8: A01, A61, A62 once each, then STOP)" : ""} - candidates: ${chosen.join(", ")}${chosen.includes("D") ? " (D reuses B's and C's answers: no calls of its own)" : ""}`);
console.log(`Recordings with a written bill: ${recordings.filter((r) => r.set === "short").length} short (A01-A50, ${[...expectedOf.values()].filter((o) => o.setAside).length} of them the set-aside Whisper-misheard orders), ${longHave} of ${LONG_SLOTS} long (A51-A62); ${audioMin.toFixed(1)} min of audio in all`);
console.log(`Runs: short orders once, long orders ${longRuns} times. Vocabulary: ${vocabulary.length} terms from eval/real-transcripts.json.`);
console.log(`NOW:          ${fmt(now)}`);
for (const c of (["E-flash", "nocat-old", "nocat-D103"] as const).filter((x) => chosen.includes(x))) {
  // per bill: gemini-3.8-flash doubles BOTH rates on 1 Jan 2027 (the pricing page, 30 Oct 2026), so the bill doubles
  const e = declare(recordings, longRuns, [c], pace, est, inrPerUsd);
  const bills = recordings.reduce((a, r) => a + (r.set === "long" ? longRuns : 1), 0);
  const perBill = (e.usd / Math.max(1, bills)) * inrPerUsd;
  console.log(`${c} per bill (estimate, GST included): today Rs ${perBill.toFixed(2)} (Rs ${(perBill * 3000).toFixed(0)} a month at 100 bills a day); from 1 Jan 2027 Rs ${(perBill * 2).toFixed(2)} (Rs ${(perBill * 6000).toFixed(0)} a month)`);
}
if (longHave < LONG_SLOTS && !only) console.log(`WITH A51-A62: ${fmt(projected)}  (the missing long orders estimated at 60 s each)`);
console.log(`Pace: ${GEMINI_TRANSCRIBE_MODEL} kept within 90% of 10 RPM and 10K TPM (quota.ts), stopping at ${DAILY_STOP} calls a Pacific day (production shares the 100); the others ${pace.otherS} s apart.${Number.isFinite(capInr) ? ` Spend cap: the run stops itself at Rs ${capInr} of logged spend.` : ""}`);
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

// ---- the transcribe quota: every gemini-3.5-transcribe request is counted here (this machine's; production's own calls are not visible) ----
const QUOTA_FILE = path.join(HERE, ".transcribe-quota.json");
class StopRun extends Error {}
interface QuotaState { day: string; count: number; sent: { at: string; tokens: number }[] }
async function transcribeGate(audioSeconds: number): Promise<void> {
  const state: QuotaState = existsSync(QUOTA_FILE) ? JSON.parse(readFileSync(QUOTA_FILE, "utf8")) : { day: "", count: 0, sent: [] };
  const today = pacificDay(new Date());
  if (state.day !== today) Object.assign(state, { day: today, count: 0 });
  if (state.count >= DAILY_STOP) throw new StopRun(`${state.count} ${GEMINI_TRANSCRIBE_MODEL} calls today (Pacific ${today}) - the daily stop is ${DAILY_STOP}: run the same command again after midnight Pacific (13:30 IST); finished rows are skipped`);
  const tokens = transcribeTokens(audioSeconds);
  const sent: Sent[] = state.sent.map((s) => ({ at: new Date(s.at), tokens: s.tokens }));
  const wait = waitMs(sent, new Date(), tokens);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const stamp = new Date();
  state.count++;
  state.sent = [...state.sent.filter((s) => stamp.getTime() - new Date(s.at).getTime() < 60_000), { at: stamp.toISOString(), tokens }];
  writeFileSync(QUOTA_FILE, JSON.stringify(state, null, 2) + "\n");
}

if (diagnoseSarvam) {
  // ONE Sarvam REST call on A01 through the real provider; on a refusal it prints Sarvam's FULL error body (KB-370 round 2)
  const rec = recordings.find((r) => r.id === "A01")!;
  if (!process.env.SARVAM_API_KEY) throw new Error("SARVAM_API_KEY not set (.env.local)");
  try {
    const r = await createSarvamTranscriptionProvider(process.env.SARVAM_API_KEY).transcribe(new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) }), { language: "hi", vocabulary, audioSeconds: rec.seconds });
    console.log(`OK in ${(r.latencyMs / 1000).toFixed(1)} s - transcript: "${r.text}"`);
  } catch (e) {
    console.log(`REFUSED - ${(e as Error).message}`);
  }
  process.exit(0);
}

if (diagnose) {
  // ONE call, the raw answer's SHAPE: which fields the transcribe model fills (KB-370: the first run read "" from it). Never the key.
  const rec = recordings.find((r) => r.id === "A01") ?? recordings[0]!;
  const body = { contents: [{ role: "user", parts: [{ inlineData: await inlineAudio(new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) })) }] }], generationConfig: { audioTranscriptionConfig: { languageCodes: ["hi-IN"] } } };
  await transcribeGate(rec.seconds);
  const res = await fetch(geminiUrl(GEMINI_TRANSCRIBE_MODEL), { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey }, body: JSON.stringify(body) });
  const raw = (await res.json()) as Record<string, unknown>;
  const shape = (v: unknown, depth = 0): unknown => (depth > 6 ? "..." : Array.isArray(v) ? (v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : []) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)])) : typeof v === "string" ? `string(${v.length})` : v);
  console.log(`HTTP ${res.status} - the answer's fields (strings shown as their length):\n${JSON.stringify(shape(raw), null, 2)}`);
  const parts = ((raw.candidates as { content?: { parts?: Record<string, unknown>[] } }[] | undefined)?.[0]?.content?.parts ?? []);
  for (const p of parts) {
    if (typeof p.text === "string") console.log(`text part: "${p.text.slice(0, 200)}"`);
    const at = p.audioTranscription as { text?: string } | undefined;
    if (typeof at?.text === "string") console.log(`audioTranscription.text: "${at.text.slice(0, 300)}"`);
    const words = (p.audioTranscription as { words?: { word?: string }[] } | undefined)?.words;
    if (words) console.log(`audioTranscription.words (${words.length}): "${words.slice(0, 40).map((w) => w.word).join(" ")}"`);
  }
  console.log(`usageMetadata: ${JSON.stringify(raw.usageMetadata ?? null)}`);
  const u = (raw.usageMetadata ?? {}) as { promptTokenCount?: number; totalTokenCount?: number };
  const usd = tokensUsd(GEMINI_TRANSCRIBE_MODEL, { promptTokens: u.promptTokenCount ?? 0, completionTokens: (u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), totalTokens: u.totalTokenCount ?? 0 });
  console.log(`logged cost of this call: Rs ${(usd * inrPerUsd).toFixed(3)} at list price (+${GST * 100}% GST = Rs ${(usd * (1 + GST) * inrPerUsd).toFixed(3)})`);
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
// round 2: B's saved transcripts (the second ear for E-*), and Sarvam
const bFrom = arg("b-from") ?? path.join(HERE, "results-2026-10-31.json");
const bTranscripts = new Map<string, string>();
if (round2 && existsSync(bFrom)) {
  for (const r of (JSON.parse(readFileSync(bFrom, "utf8")) as { results: RunResult[] }).results) if (r.candidate === "B" && r.rerun && !r.error && r.transcript) bTranscripts.set(`${r.id}|${r.run}`, r.transcript);
}
const sarvamKey = process.env.SARVAM_API_KEY;
if (chosen.includes("S") && !sarvamKey) throw new Error("SARVAM_API_KEY not set (.env.local)");
const sarvam = createSarvamTranscriptionProvider(sarvamKey ?? "");
/** Layer 2 through the SHIPPED provider and prompt, counting its cost (thinking tokens included: total - prompt) and its seconds. */
const parseWith = (cost: { usd: number; ms: number }) => async (text: string, slice: readonly CatalogEntry[]): Promise<ParsedItem[]> => {
  const r = await paced(() => layer2.parse(text, { catalogSlice: [...slice] }));
  cost.usd += tokensUsd(DEFAULT_GEMINI_MODEL, { ...r.usage, completionTokens: r.usage.totalTokens - r.usage.promptTokens });
  cost.ms += r.latencyMs;
  return r.items;
};
const entries = [...shop.entries];
const out = arg("out") ? path.resolve(arg("out")!) : canary ? path.join(HERE, `results-canary-${new Date().toISOString().slice(0, 10)}.json`) : mergeFile ? path.resolve(mergeFile) : path.join(HERE, `results-${new Date().toISOString().slice(0, 10)}.json`);
// --merge: keep every earlier row except the candidates re-run now and those dropped (e.g. B-novocab, measured as "" on 1 Nov). Rows a
// re-run already produced (`rerun`) are kept and skipped: running the same command again after a stop RESUMES it.
const earlier = mergeFile ? (JSON.parse(readFileSync(path.resolve(mergeFile), "utf8")) as { meta: Record<string, unknown>; results: RunResult[] }) : null;
const kept = (earlier?.results ?? []).filter((r) => (!chosen.includes(r.candidate) || r.rerun) && !drop.includes(r.candidate));
const done = new Map(kept.filter((r) => r.rerun && !r.error).map((r) => [`${r.candidate}|${r.id}|${r.run}`, r]));
const results: RunResult[] = [];
let spentUsd = 0;
const save = () =>
  writeFileSync(out, JSON.stringify({ meta: { ...(earlier?.meta ?? {}), date: new Date().toISOString(), longRuns: earlier ? earlier.meta.longRuns : longRuns, inrPerUsd, vocabulary, models: { groq: "whisper-large-v3", transcribe: GEMINI_TRANSCRIBE_MODEL, layer2: DEFAULT_GEMINI_MODEL, c: DEFAULT_GEMINI_MODEL, c2: C2_MODEL }, setAside: [...expectedOf].filter(([, o]) => o.setAside).map(([id]) => id), ...(mergeFile ? { rerun: { candidates: chosen, dropped: drop, at: new Date().toISOString() } } : {}), ...(round3 ? { scoring: "D102 + D103 - names and units as said (owner, 4 and 5 Nov 2026)", round: 3 } : round2 ? { scoring: "D102 - names as said (owner, 4 Nov 2026)", round: 2 } : {}) }, results: [...kept, ...results] }, null, 2) + "\n");

outer: for (const rec of recordings) {
  const { expected } = expectedOf.get(rec.id)!;
  const blob = () => new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) });
  const runs = rec.set === "long" ? longRuns : 1;
  for (let run = 1; run <= runs; run++) {
    const answers: Partial<Record<"B" | "C" | "E", { transcript: string; items?: ParsedItem[]; seconds: number; usd: number }>> = {};
    for (const candidate of candidatesFor(rec.set).concat("D").filter((c) => chosen.includes(c))) {
      if (candidate === "B-smart" && (!SMART_IDS.has(rec.id) || run > 1)) continue;
      const prior = done.get(`${candidate}|${rec.id}|${run}`);
      if (prior) {
        // resumed: this row exists - give D the saved B transcript and C items, call nothing
        if (candidate === "B" && prior.transcript !== null) answers.B = { transcript: prior.transcript, seconds: prior.seconds, usd: prior.usd };
        if (candidate === "C" && prior.items) answers.C = { transcript: prior.transcript ?? "", items: [...prior.items], seconds: prior.seconds, usd: prior.usd };
        continue;
      }
      if (spentUsd * inrPerUsd >= capInr) {
        console.log(`\nSPEND CAP reached: Rs ${(spentUsd * inrPerUsd).toFixed(1)} logged >= Rs ${capInr} - the run stops here (results so far are saved).`);
        break outer;
      }
      // seconds = the providers' own call times added up (stop -> items on the PC; the pacing pause and busy retries are not counted)
      const cost = { usd: 0, ms: 0 };
      let transcript: string | null = null;
      let actual: ActualBill;
      let error: string | undefined;
      let thoughts: number | null | undefined;
      let errorDetail: string | undefined;
      let waits: RunResult["waits"];
      let rawItems: ParsedItem[] | undefined; // the model's items before any of our checks (C, E-flash, nocat-*)
      let usage: { promptTokens: number; totalTokens: number } | undefined;
      try {
        if (candidate.startsWith("A")) {
          const groq = createGroqTranscriptionProvider(groqKey, undefined, candidate === "A-30s" ? A30_TIMEOUT_MS : undefined);
          const r = await paced(() => groq.transcribe(blob(), { language: "hi", ...(candidate === "A+vocab" ? { vocabulary } : {}) }));
          transcript = r.text;
          cost.usd += groqUsd(rec.seconds);
          cost.ms += r.latencyMs;
          actual = await runOrder(transcript, parseWith(cost));
        } else if (candidate.startsWith("B")) {
          const b = createGeminiTranscriptionProvider(geminiKey, candidate === "B-smart" ? { mode: "SMART" } : {});
          // one request through the quota; a 429 stops the run (on 1 Nov it was the shared DAILY cap - retrying only burns production's)
          await transcribeGate(rec.seconds);
          const r = await b.transcribe(blob(), { language: "hi", ...(candidate === "B" || candidate === "B-smart" ? { vocabulary } : {}) }).catch((e: unknown) => {
            if (e instanceof ProviderError && e.status === 429) throw new StopRun(`${GEMINI_TRANSCRIBE_MODEL} answered 429 (most likely the shared 100-a-day cap) - stopped; run the same command again after midnight Pacific (13:30 IST)`);
            throw e;
          });
          transcript = r.text;
          cost.usd += tokensUsd(GEMINI_TRANSCRIBE_MODEL, r.usage);
          cost.ms += r.latencyMs;
          if (candidate === "B") answers.B = { transcript, seconds: r.latencyMs / 1000, usd: cost.usd };
          actual = await runOrder(transcript, parseWith(cost));
        } else if (candidate === "E-lite" || candidate === "E-flash") {
          // Ezy-style (round 2): the D102 prompt; the catalog fills only an unspoken price on one clear match; our checks; then B must agree
          const bTranscript = bTranscripts.get(`${rec.id}|${run}`) ?? bTranscripts.get(`${rec.id}|1`);
          if (bTranscript === undefined) throw new Error(`no saved B transcript for ${rec.id} run ${run} - E needs B as its second ear`);
          const model = candidate === "E-lite" ? DEFAULT_GEMINI_MODEL : C2_MODEL;
          const r = await paced(() => createGeminiAudioParseProvider(geminiKey, { model, systemPrompt: EZY_D102_PROMPT, ...(candidate === "E-flash" ? { thinkingConfig: E_FLASH_THINKING } : {}) }).parseAudio(blob(), { catalog: entries }));
          transcript = r.transcript;
          cost.usd += tokensUsd(model, r.usage);
          cost.ms += r.latencyMs;
          thoughts = r.thoughts;
          if (candidate === "E-flash") ((answers.E = { transcript, items: r.items, seconds: r.latencyMs / 1000, usd: cost.usd }), (rawItems = r.items));
          usage = r.usage;
          actual = flagNotHeardByB(checkAudioAnswer(transcript, d102Fill(r.items, shop), shop), bTranscript);
        } else if (candidate === "E-flash-1ear") {
          // the same call, one ear: only E-flash's own transcript checks its numbers (no call of its own)
          const e = answers.E;
          if (!e) throw new Error("E-flash-1ear needs E-flash's answer for this run (it failed or was not run)");
          transcript = e.transcript;
          actual = checkAudioAnswer(e.transcript, d102Fill(e.items!, shop), shop);
          cost.usd = e.usd;
          cost.ms = e.seconds * 1000;
        } else if (candidate === "nocat-old" || candidate === "nocat-D103") {
          // E-flash's call with an EMPTY catalog: the model never sees a product; our code fills an unspoken price (D102); our checks; one ear
          const r = await paced(() => createGeminiAudioParseProvider(geminiKey, { model: C2_MODEL, systemPrompt: NOCAT_PROMPT[candidate]!, thinkingConfig: E_FLASH_THINKING }).parseAudio(blob(), { catalog: [] }));
          transcript = r.transcript;
          cost.usd += tokensUsd(C2_MODEL, r.usage);
          cost.ms += r.latencyMs;
          thoughts = r.thoughts;
          rawItems = r.items;
          usage = r.usage;
          actual = nocatBill(transcript, r.items, shop);
        } else if (candidate === "S") {
          const r = await paced(() => sarvam.transcribe(blob(), { language: "hi", vocabulary, audioSeconds: rec.seconds }));
          transcript = r.text;
          cost.usd += ((rec.seconds / 60) * SARVAM_INR_PER_MINUTE) / inrPerUsd; // billed per second, before GST
          cost.ms += r.latencyMs;
          waits = r.waits;
          actual = await runOrder(transcript, parseWith(cost));
        } else if (candidate === "C" || candidate === "C2") {
          const model = candidate === "C" ? DEFAULT_GEMINI_MODEL : C2_MODEL;
          const r = await paced(() => createGeminiAudioParseProvider(geminiKey, { model }).parseAudio(blob(), { catalog: entries }));
          transcript = r.transcript;
          cost.usd += tokensUsd(model, r.usage);
          cost.ms += r.latencyMs;
          if (candidate === "C") ((answers.C = { transcript, items: r.items, seconds: r.latencyMs / 1000, usd: cost.usd }), (rawItems = r.items));
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
        if (e instanceof StopRun) {
          console.log(`\nSTOPPED: ${e.message}.`);
          break outer;
        }
        error = e instanceof ProviderError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : (e as Error).message.slice(0, 160);
        errorDetail = (e as Error).message; // the provider's own message, saved on every failure (KB-370 round 2: a bare "failed 400" hid Sarvam's reason)
        actual = { lines: [], unresolved: 1, checks: 0 };
      }
      // D runs B and C side by side: its seconds are the slower of the two
      const seconds = candidate === "D" && answers.B && answers.C ? Math.max(answers.B.seconds, answers.C.seconds) : cost.ms / 1000;
      const score = d102Scoring ? scoreRunD102(rec.id, expected, actual, shop) : scoreRun(rec.id, expected, actual, shop);
      if (candidate !== "D" && candidate !== "E-flash-1ear") spentUsd += cost.usd; // D and E-flash-1ear reuse calls already counted
      results.push({ candidate, id: rec.id, set: rec.set, run, transcript, seconds, usd: cost.usd, audioSeconds: rec.seconds, ...toSaved(actual), ...(mergeFile ? { rerun: true } : {}), ...(rawItems ? { items: rawItems } : {}), ...(thoughts !== undefined ? { thoughts } : {}), ...(waits ? { waits } : {}), ...(error ? { error, errorDetail } : {}), ...score });
      console.log(`${(error ? "ERR" : score.wrongLines ? "WRONG" : score.exact ? "exact" : "inexact").padEnd(7)} ${rec.id} run ${run} ${candidate.padEnd(9)} ${seconds.toFixed(1)} s${error ? `  ${error}: ${errorDetail}` : ""}`);
      for (const w of score.wrong) console.log(`          ! ${w}`);
      if (canary) {
        // docs/23 section 8: the owner sees each candidate's transcript and items side by side before the full run
        console.log(`          heard: "${transcript ?? ""}"`);
        if (thoughts !== undefined) console.log(`          thinking tokens: ${thoughts === null ? "ABSENT from the answer (not 0)" : thoughts}`);
        if (usage) console.log(`          cost of this call: Rs ${(cost.usd * inrPerUsd).toFixed(3)} at list price, Rs ${(cost.usd * inrPerUsd * (1 + GST)).toFixed(3)} with GST (tokens: ${usage.promptTokens} in, ${usage.totalTokens - usage.promptTokens} out incl. thinking)`);
        if (rawItems) for (const l of rawItems) console.log(`          RAW (before our checks): ${l.qty ?? "?"} ${l.unit} ${l.spokenName} ${l.priceType}${l.rate !== null ? ` rate Rs ${l.rate / 100}` : ""}${l.total !== null ? ` total Rs ${l.total / 100}` : ""}`);
        if (waits) console.log(`          Sarvam waits: upload ${(waits.uploadMs / 1000).toFixed(1)} s, queue + processing ${(waits.queueMs / 1000).toFixed(1)} s (${waits.polls} polls), download ${(waits.downloadMs / 1000).toFixed(1)} s`);
        for (const l of toSaved(actual).lines) console.log(`          - ${l.qty ?? "?"} ${l.unit} ${l.name}${l.catalogId ? ` [${shop.byId.get(l.catalogId)?.displayName}]` : " [custom]"} ${l.priceType}${l.rate !== null ? ` rate Rs ${l.rate / 100}` : ""}${l.total !== null ? ` total Rs ${l.total / 100}` : ""}`);
      }
    }
    save();
  }
}
console.log(`\nDone: ${results.length} results in ${path.relative(process.cwd(), out)}; logged spend Rs ${(spentUsd * inrPerUsd).toFixed(1)}.${canary ? " CANARY: STOP here - the owner looks before the full run (docs/23 section 8)." : " Next: npm run bakeoff:report"}`);
