/**
 * The V3 LIVE regression run (KB-370 nocat / KB-387; trimmed to V3 on 18 Nov 2026 when the old voice path was deleted - owner + reviewer).
 * Each recording of the regression set goes through V3's call - gemini-3.8-flash with NO catalog, the V3 prompt - then OUR code (price
 * fill, checks, totals: nocatBill = the app's aiAnswerBill), and is scored under D102 + D103 against the bill the owner wrote
 * (eval/acceptance/sheet.txt). It SPENDS money: run it only after the owner's OK, a canary first (docs/23 section 8).
 *     npm run bakeoff                                     declare the calls and the cost - makes NO call
 *     npm run bakeoff -- --canary --go                    A01, A61, A62 once each, prints transcript + items, STOPS
 *     npm run bakeoff -- --go --cap-inr N [--out FILE]    the full run; it stops itself at Rs N of logged spend
 *     --candidates nocat-v2 (default; V3) | nocat-old | nocat-D103 (the earlier prompts, for comparison) · --only A51,A52 · --long-runs 3
 *     --merge FILE [--drop X] re-runs those candidates' rows in an earlier results file (a re-run of the same command RESUMES it)
 * Then:  npm run bakeoff:report (REPORT.md) · npm run bakeoff:replay (free: saved raw answers through today's code)
 * Key: GEMINI_API_KEY_EVAL from .env.local - read here, never printed. The recordings are never committed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedItem } from "../../src/domain/grammar.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { ProviderError } from "../../src/voice/deadline.js";
import { createGeminiAudioParseProvider } from "../../src/voice/geminiAudioParseProvider.js";
import type { ActualBill } from "../acceptance/compare.js";
import { parseSheet } from "../acceptance/sheet.js";
import { AUDIO_DIR, SHEET } from "../acceptance/store.js";
import type { ExpectedBill } from "../acceptance/types.js";
import { nocatBill } from "./pipeline.js";
import { scoreRunD102 } from "./d102.js";
import { EZY_D102_NOCAT_PROMPT, EZY_D103_NOCAT_PROMPT, EZY_V3_PROMPT } from "./ezyPrompt.js";
import { declare, GST, toSaved, tokensUsd, webmSeconds, type CandidateId, type Recording, type RunResult } from "./score.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const go = process.argv.includes("--go");
const canary = process.argv.includes("--canary");
const mergeFile = arg("merge");
const drop = arg("drop")?.split(",") ?? [];
const capInr = arg("cap-inr") ? Number(arg("cap-inr")) : Infinity;
const pace = { transcribeS: 0, otherS: 3 };
/** docs/23 section 8: one short order and the two longest. */
const CANARY_IDS = ["A01", "A61", "A62"];
const only = canary ? CANARY_IDS : arg("only")?.split(",");
const PROMPT: Partial<Record<CandidateId, string>> = { "nocat-v2": EZY_V3_PROMPT, "nocat-old": EZY_D102_NOCAT_PROMPT, "nocat-D103": EZY_D103_NOCAT_PROMPT };
const chosen = (arg("candidates")?.split(",") ?? ["nocat-v2"]) as CandidateId[];
for (const c of chosen) if (!PROMPT[c]) throw new Error(`unknown candidate ${c} - only V3's: ${Object.keys(PROMPT).join(", ")}`);
/** V3's thinking level (the lowest gemini-3.8-flash allows; the canary confirms it from the thinking tokens). */
const THINKING = { thinkingLevel: "low" };
const longRuns = canary ? 1 : Number(arg("long-runs") ?? 3);
/** The last RBI reference rate found on 31 Oct 2026: 95.17. Pass today's with --inr-per-usd. */
const inrPerUsd = Number(arg("inr-per-usd") ?? 95.17);
const MODEL = "gemini-3.8-flash";
const shop = SEED_PARSER_CATALOG;

// ---- the orders: every sheet block with a written bill ----------------------------------------------------------------------------
const sheet = parseSheet(readFileSync(SHEET, "utf8"));
const expectedOf = new Map<string, { expected: ExpectedBill; category: string; setAside: boolean }>();
for (const o of sheet.orders) {
  const expected = o.expected ?? o.skippedExpected;
  if (expected) expectedOf.set(o.id, { expected, category: o.category, setAside: !o.expected });
}
const audioFiles = existsSync(AUDIO_DIR) ? readdirSync(AUDIO_DIR) : [];
const recordings: (Recording & { file: string })[] = [];
for (const [id, o] of expectedOf) {
  const file = audioFiles.find((f) => f.startsWith(`${id}.`));
  if (!file || (only && !only.includes(id))) continue;
  recordings.push({ id, set: o.category === "long-30-90s" ? "long" : "short", seconds: webmSeconds(readFileSync(path.join(AUDIO_DIR, file))), file });
}

// ---- the declaration (always printed; nothing is called without --go) -------------------------------------------------------------
const est = { layer2In: 0, cIn: 0, nocatIn: Math.ceil((EZY_V3_PROMPT.length + 30) / 3) };
const now = declare(recordings, longRuns, chosen, pace, est, inrPerUsd);
const bills = recordings.reduce((a, r) => a + (r.set === "long" ? longRuns : 1), 0);
console.log(`V3 regression run${canary ? " - CANARY (A01, A61, A62 once each, then STOP)" : ""} - candidates: ${chosen.join(", ")}`);
console.log(`Recordings with a written bill: ${recordings.filter((r) => r.set === "short").length} short, ${recordings.filter((r) => r.set === "long").length} long; long orders run ${longRuns} times.`);
console.log(`NOW: ${now.total} calls to ${MODEL}; about Rs ${(now.usd * inrPerUsd).toFixed(0)} (list prices x estimated tokens + a thinking allowance + ${GST * 100}% GST); about ${Math.ceil(now.minutes)} min.`);
// gemini-3.8-flash doubles BOTH rates on 1 Jan 2027 (the pricing page, 30 Oct 2026), so the cost per bill doubles
const perBill = (now.usd / Math.max(1, bills)) * inrPerUsd;
console.log(`Per bill (estimate, GST included): today Rs ${perBill.toFixed(2)}; from 1 Jan 2027 Rs ${(perBill * 2).toFixed(2)}.${Number.isFinite(capInr) ? ` Spend cap: Rs ${capInr}.` : ""}`);
if (!go) {
  console.log("\nNo call made. Re-run with --go after the owner's OK (a canary first).");
  process.exit(0);
}

// ---- the live run -----------------------------------------------------------------------------------------------------------------
process.loadEnvFile(".env.local");
const geminiKey = process.env.GEMINI_API_KEY_EVAL;
if (!geminiKey) throw new Error("GEMINI_API_KEY_EVAL not set (.env.local)");
const mime = (file: string) => ({ webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" })[path.extname(file).slice(1)] ?? "application/octet-stream";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The pause comes BEFORE a call, so it is never counted as the call's seconds. Only a BUSY answer (a quota, Google overloaded) is retried. */
async function paced<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await sleep(pace.otherS * 1000);
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof ProviderError && e.kind === "busy") || attempt >= 4) throw e;
      await sleep(attempt * 15_000);
    }
  }
}

const out = arg("out") ? path.resolve(arg("out")!) : canary ? path.join(HERE, `results-canary-${new Date().toISOString().slice(0, 10)}.json`) : mergeFile ? path.resolve(mergeFile) : path.join(HERE, `results-${new Date().toISOString().slice(0, 10)}.json`);
const earlier = mergeFile ? (JSON.parse(readFileSync(path.resolve(mergeFile), "utf8")) as { meta: Record<string, unknown>; results: RunResult[] }) : null;
const kept = (earlier?.results ?? []).filter((r) => (!chosen.includes(r.candidate) || r.rerun) && !drop.includes(r.candidate));
const done = new Map(kept.filter((r) => r.rerun && !r.error).map((r) => [`${r.candidate}|${r.id}|${r.run}`, r]));
const results: RunResult[] = [];
let spentUsd = 0;
const save = () =>
  writeFileSync(out, JSON.stringify({ meta: { ...(earlier?.meta ?? {}), date: new Date().toISOString(), longRuns: earlier ? earlier.meta.longRuns : longRuns, inrPerUsd, vocabulary: [], models: { audio: MODEL }, setAside: [...expectedOf].filter(([, o]) => o.setAside).map(([id]) => id), ...(mergeFile ? { rerun: { candidates: chosen, dropped: drop, at: new Date().toISOString() } } : {}), scoring: "D102 + D103 - names and units as said (owner, 4 and 5 Nov 2026)", round: 3 }, results: [...kept, ...results] }, null, 2) + "\n");

outer: for (const rec of recordings) {
  const { expected } = expectedOf.get(rec.id)!;
  const runs = rec.set === "long" ? longRuns : 1;
  for (let run = 1; run <= runs; run++) {
    for (const candidate of chosen) {
      if (done.has(`${candidate}|${rec.id}|${run}`)) continue; // resumed: this row exists
      if (spentUsd * inrPerUsd >= capInr) {
        console.log(`\nSPEND CAP reached: Rs ${(spentUsd * inrPerUsd).toFixed(1)} logged >= Rs ${capInr} - the run stops here (results so far are saved).`);
        break outer;
      }
      const cost = { usd: 0, ms: 0 };
      let transcript: string | null = null;
      let actual: ActualBill;
      let error: string | undefined;
      let errorDetail: string | undefined;
      let thoughts: number | null | undefined;
      let rawItems: ParsedItem[] | undefined; // the model's items before any of our checks
      let usage: { promptTokens: number; totalTokens: number } | undefined;
      try {
        // V3's call: the model never sees a product; our code fills an unspoken price (D102); our checks; one ear
        const blob = new Blob([readFileSync(path.join(AUDIO_DIR, rec.file))], { type: mime(rec.file) });
        const r = await paced(() => createGeminiAudioParseProvider(geminiKey, { model: MODEL, systemPrompt: PROMPT[candidate]!, thinkingConfig: THINKING }).parseAudio(blob, { catalog: [] }));
        transcript = r.transcript;
        cost.usd += tokensUsd(MODEL, r.usage);
        cost.ms += r.latencyMs;
        thoughts = r.thoughts;
        rawItems = r.items;
        usage = r.usage;
        actual = nocatBill(transcript, r.items, shop);
      } catch (e) {
        error = e instanceof ProviderError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : (e as Error).message.slice(0, 160);
        errorDetail = (e as Error).message;
        actual = { lines: [], unresolved: 1, checks: 0 };
      }
      const seconds = cost.ms / 1000;
      const score = scoreRunD102(rec.id, expected, actual, shop);
      spentUsd += cost.usd;
      results.push({ candidate, id: rec.id, set: rec.set, run, transcript, seconds, usd: cost.usd, audioSeconds: rec.seconds, ...toSaved(actual), ...(mergeFile ? { rerun: true } : {}), ...(rawItems ? { items: rawItems } : {}), ...(thoughts !== undefined ? { thoughts } : {}), ...(error ? { error, errorDetail } : {}), ...score });
      console.log(`${(error ? "ERR" : score.wrongLines ? "WRONG" : score.exact ? "exact" : "inexact").padEnd(7)} ${rec.id} run ${run} ${candidate.padEnd(10)} ${seconds.toFixed(1)} s${error ? `  ${error}: ${errorDetail}` : ""}`);
      for (const w of score.wrong) console.log(`          ! ${w}`);
      if (canary) {
        // docs/23 section 8: the owner sees the transcript and the items before the full run
        console.log(`          heard: "${transcript ?? ""}"`);
        if (thoughts !== undefined) console.log(`          thinking tokens: ${thoughts === null ? "ABSENT from the answer (not 0)" : thoughts}`);
        if (usage) console.log(`          cost of this call: Rs ${(cost.usd * inrPerUsd).toFixed(3)} at list price, Rs ${(cost.usd * inrPerUsd * (1 + GST)).toFixed(3)} with GST (tokens: ${usage.promptTokens} in, ${usage.totalTokens - usage.promptTokens} out incl. thinking)`);
        if (rawItems) for (const l of rawItems) console.log(`          RAW (before our checks): ${l.qty ?? "?"} ${l.unit} ${l.spokenName} ${l.priceType}${l.rate !== null ? ` rate Rs ${l.rate / 100}` : ""}${l.total !== null ? ` total Rs ${l.total / 100}` : ""}`);
        for (const l of toSaved(actual).lines) console.log(`          - ${l.qty ?? "?"} ${l.unit} ${l.name}${l.catalogId ? ` [${shop.byId.get(l.catalogId)?.displayName}]` : " [custom]"} ${l.priceType}${l.rate !== null ? ` rate Rs ${l.rate / 100}` : ""}${l.total !== null ? ` total Rs ${l.total / 100}` : ""}`);
      }
    }
    save();
  }
}
console.log(`\nDone: ${results.length} results in ${path.relative(process.cwd(), out)}; logged spend Rs ${(spentUsd * inrPerUsd).toFixed(1)}.${canary ? " CANARY: STOP here - the owner looks before the full run (docs/23 section 8)." : " Next: npm run bakeoff:report"}`);
