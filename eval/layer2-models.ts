/**
 * KB-360 (owner, 29 Oct 2026) - which Gemini model should answer Layer 2? A MEASUREMENT, not a test: the gold set in
 * eval/layer2-cases.json (the owner's real Layer-2 transcripts, his three long orders, and adversarial cases) is sent through
 * the SHIPPED provider and the SHIPPED settle step, per model and per thinking setting, several runs each, and scored the way the
 * product is judged: a number that is not what was said is WRONG (never acceptable); a missing number is a bail (safe).
 *
 * The key is read from GEMINI_API_KEY_EVAL (process env, else .env.local) and is never printed - every printed string passes
 * through redact(). It spends real quota: start with --runs 1 and a few models.
 *
 *   npm run eval:layer2 -- --models gemini-3.1-flash-lite,gemini-3.5-flash-lite --thinking default,off --runs 3 --out <file>
 *
 * Models are exact names; a "-latest" alias is refused (it can change underneath a tested prompt).
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogSlice } from "../src/domain/catalogIndex.js";
import { settleLayer2Items } from "../src/domain/layer2.js";
import { lineTotalPaise } from "../src/domain/money.js";
import { SEED_PARSER_CATALOG } from "../src/domain/seedCatalog.js";
import { createGeminiParseProvider } from "../src/voice/geminiParseProvider.js";
import { PRICING_GRAMMAR_PROMPT } from "../src/voice/pricingGrammarPrompt.js";
import { CANONICAL_DEVANAGARI } from "../src/domain/numberWords.js";
import { ProviderError } from "../src/voice/deadline.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** USD per 1M tokens, Standard paid tier, https://ai.google.dev/gemini-api/docs/pricing (page "last updated 2026-10-28"). Output includes thinking tokens. */
const PRICE: Record<string, { in: number; out: number; note?: string }> = {
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75, note: "doubles on 1 Jan 2027" },
  "gemini-3.8-flash": { in: 0.75, out: 3.75, note: "doubles on 1 Jan 2027" },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
};

/**
 * Prompt variants measured against the shipped prompt (same schema). "rule6" adds a rule for a price that was SAID but cannot be read
 * (never a guessed number, never the catalog price) with three held-out examples (none is in the gold set); "numbers" also lists every
 * Hindi number word 1-100 in place of the short legacy list.
 */
const RULE6 = `
RULE 6 - a price that was SAID but that you cannot read with certainty. If the speaker clearly gave a price (a number word followed by
rupay / rupaye / रुपए / ka / wala / "per kilo") but the number word is garbled or is not a number you recognise, do NOT guess a number and
do NOT use the catalog price. Keep the item with the quantity and unit that WERE said and return rate:null, total:0, priceType:"unknown".
A misheard price is never better than no price. Digits are never garbled: "do kilo aata 56 rupay kilo" is rate 5600.
"do kilo aata chaubay rupay kilo" -> qty:2, unit:"kg", rate:null, total:0, priceType:"unknown"
"एक लीटर तेल सोलठ रुपए" -> qty:1, unit:"liter", rate:null, total:0, priceType:"unknown"
"teen kilo chawal pachh rupay" -> qty:3, unit:"kg", rate:null, total:0, priceType:"unknown"
`;
const NUMBER_LIST = `\nHindi numerals 1-100 (Devanagari; Whisper may spell them differently - read them by sound): ${CANONICAL_DEVANAGARI.map((w, i) => `${w}=${i + 1}`).join(" ")}\n`;
const PROMPTS: Record<string, string> = {
  base: PRICING_GRAMMAR_PROMPT,
  rule6: PRICING_GRAMMAR_PROMPT + RULE6,
  numbers: PRICING_GRAMMAR_PROMPT + RULE6 + NUMBER_LIST,
};

type TotalRule = number | "default" | "none";
/** `catalogId` may list every id that is a right answer (the base seed has two Moong entries and an Urad Mogar the grammar does not know by that name); null = a custom line. */
interface ExpectedLine { catalogId: string | null | (string | null)[]; qty: number | null; unit: string; total: TotalRule }
const idOk = (exp: ExpectedLine, got: string | null): boolean => (Array.isArray(exp.catalogId) ? exp.catalogId.includes(got) : exp.catalogId === got);
const firstId = (exp: ExpectedLine): string | null => (Array.isArray(exp.catalogId) ? (exp.catalogId[0] ?? null) : exp.catalogId);
interface Case { id: string; source: string; transcript: string; mode?: "exact" | "okOrBail" | "noNumbers"; expect: ExpectedLine[] }

const loadCases = (): Case[] => JSON.parse(readFileSync(path.join(here, "layer2-cases.json"), "utf8")) as Case[];

function loadKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY_EVAL;
  if (fromEnv) return fromEnv;
  const file = path.join(here, "..", ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*GEMINI_API_KEY_EVAL\s*=\s*(.*)$/);
      if (m) return m[1]!.trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("GEMINI_API_KEY_EVAL is not set (process env or .env.local)");
}
const KEY = loadKey();
const redact = (text: string): string => (KEY ? text.split(KEY).join("<key>") : text);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const variant = arg("prompt", "base");
if (!(variant in PROMPTS)) throw new Error(`unknown --prompt ${variant}`);
const rescore = arg("rescore", ""); // re-score saved answers (the --out files, comma-separated) - no API calls
let models = arg("models", "gemini-3.1-flash-lite").split(",").filter(Boolean);
let thinkingModes = arg("thinking", "default").split(",").filter(Boolean);
const runs = Number(arg("runs", "1"));
const paceMs = Number(arg("pace-ms", "6500"));
const only = arg("cases", "").split(",").filter(Boolean);
const outFile = arg("out", "");
for (const m of models) if (/latest/i.test(m)) throw new Error(`refusing a "-latest" alias: ${m} - pin an exact model name`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => (xs.length === 0 ? NaN : [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!);
const p95 = (xs: number[]) => (xs.length === 0 ? NaN : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!);

// ---- scoring ---------------------------------------------------------------------------------------------------------
interface Got { catalogId: string | null; qty: number | null; unit: string; rate: number | null; total: number | null; name: string }
type Outcome = "correct" | "bail" | "wrong";

/** What the CATALOG price of a product gives for this quantity (the line is "default"-priced: nothing was said about price). */
function defaultTotal(id: string | null, qty: number | null, unit: string): number | null {
  const entry = id ? SEED_PARSER_CATALOG.byId.get(id) : undefined;
  if (!entry || qty === null || entry.unit !== unit) return null;
  return lineTotalPaise(qty, entry.suggestedPricePaise);
}
const has = (n: number | null) => n !== null && n > 0;

function score(c: Case, got: Got[]): { outcome: Outcome; why: string } {
  const lines = got.filter((g) => g.qty !== null || g.total !== null || g.rate !== null || g.catalogId !== null);
  if (c.mode === "noNumbers") {
    const bad = lines.find((g) => has(g.qty) || has(g.total) || has(g.rate));
    return bad ? { outcome: "wrong", why: `a number where none was said: ${bad.name} qty ${bad.qty} total ${bad.total}` } : { outcome: "correct", why: "" };
  }
  const used = new Set<number>();
  let missing = false;
  for (const exp of c.expect) {
    const i = lines.findIndex((g, k) => !used.has(k) && idOk(exp, g.catalogId) && g.qty === exp.qty && g.unit === exp.unit);
    if (i < 0) {
      const other = lines.findIndex((g, k) => !used.has(k) && idOk(exp, g.catalogId) && (g.qty !== null || has(g.total)));
      if (firstId(exp) !== null && other >= 0) return { outcome: "wrong", why: `${firstId(exp)}: expected ${exp.qty} ${exp.unit}, got ${lines[other]!.qty} ${lines[other]!.unit} (total ${lines[other]!.total})` };
      missing = true;
      continue;
    }
    used.add(i);
    const item = lines[i]!;
    const want = exp.total === "default" ? defaultTotal(item.catalogId, exp.qty, exp.unit) : exp.total === "none" ? null : exp.total;
    const ok = exp.total === "default" ? !has(item.total) || item.total === want : exp.total === "none" ? !has(item.total) : item.total === want;
    if (!ok) {
      if (has(item.total)) return { outcome: "wrong", why: `${item.catalogId ?? "custom"} ${exp.qty} ${exp.unit}: expected total ${exp.total === "default" ? `the catalog price ${want}` : want}, got ${item.total}` };
      missing = true;
    }
  }
  const extra = lines.find((g, k) => !used.has(k) && (has(g.total) || has(g.qty)));
  if (extra) return { outcome: "wrong", why: `an extra line: ${extra.name} qty ${extra.qty} ${extra.unit} total ${extra.total}` };
  if (missing) return { outcome: c.mode === "okOrBail" ? "correct" : "bail", why: "a line or a number missing" };
  return { outcome: "correct", why: "" };
}

// ---- running ---------------------------------------------------------------------------------------------------------
interface Row {
  key: string; model: string; thinking: string; variant?: string; caseId: string; run: number;
  outcome: Outcome | "error"; why: string; ms: number | null; inTok: number; outTok: number; thoughtTok: number;
  status?: number | string; quota?: string; got?: Got[];
}
const done = new Map<string, Row>();
if (outFile && existsSync(outFile)) for (const l of readFileSync(outFile, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l) as Row; done.set(r.key, r); }

const THINKING_OFF_TRIES: Record<string, unknown>[] = [{ thinkingBudget: 0 }, { thinkingLevel: "minimal" }, { thinkingLevel: "low" }];
const thinkingFor = new Map<string, Record<string, unknown> | "unsupported" | undefined>(); // per model, for "off"

async function callOnce(model: string, thinkingConfig: Record<string, unknown> | undefined, c: Case) {
  const provider = createGeminiParseProvider(KEY, undefined, { model, thinkingConfig, timeoutMs: 40_000, systemPrompt: PROMPTS[variant] });
  const slice = buildCatalogSlice(SEED_PARSER_CATALOG, c.transcript);
  return provider.parse(c.transcript, { catalogSlice: slice });
}

async function probeOff(model: string, sample: Case): Promise<Record<string, unknown> | "unsupported"> {
  for (const cfg of THINKING_OFF_TRIES) {
    try {
      await callOnce(model, cfg, sample);
      console.log(`  [${model}] thinking "off" accepted as ${JSON.stringify(cfg)}`);
      await sleep(paceMs);
      return cfg;
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : "?";
      console.log(`  [${model}] thinking config ${JSON.stringify(cfg)} refused (status ${status})`);
      await sleep(paceMs);
    }
  }
  return "unsupported";
}

const cases = loadCases().filter((c) => only.length === 0 || only.includes(c.id));
console.log(rescore ? `Re-scoring saved answers from ${rescore.split(",").length} file(s) - no API calls` : `Layer-2 model measurement: ${cases.length} cases x ${runs} run(s) x ${thinkingModes.join("/")} x ${models.join(", ")}; the key is set (${KEY.length} chars) and never printed`);

const stopped = new Set<string>();
if (rescore) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const f of rescore.split(",")) {
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as Row;
      const c = byId.get(r.caseId);
      if (r.outcome !== "error" && c && r.got) { const s = score(c, r.got); r.outcome = s.outcome; r.why = s.why; }
      done.set(r.key, r);
    }
  }
  models = [...new Set([...done.values()].map((r) => r.model))];
}
for (const model of rescore ? [] : models) {
  for (const thinking of thinkingModes) {
    let cfg: Record<string, unknown> | undefined;
    if (thinking === "off") {
      if (!thinkingFor.has(model)) thinkingFor.set(model, await probeOff(model, cases[0]!));
      const t = thinkingFor.get(model)!;
      if (t === "unsupported") { console.log(`  [${model}] thinking off is not possible - skipped`); continue; }
      cfg = t;
    }
    for (let run = 1; run <= runs; run++) {
      for (const c of cases) {
        if (stopped.has(model)) break;
        const key = `${model}|${thinking}|${variant}|${c.id}|${run}`;
        if (done.has(key)) continue;
        let row: Row;
        try {
          const r = await callOnce(model, cfg, c);
          const settled = settleLayer2Items(r.items, SEED_PARSER_CATALOG);
          const got: Got[] = settled.lines.map((l) => ({ catalogId: l.item.catalogId, qty: l.item.qty, unit: l.item.unit, rate: l.item.rate, total: l.item.total, name: l.item.spokenName }));
          const s = score(c, got);
          const thoughts = Math.max(0, r.usage.totalTokens - r.usage.promptTokens - r.usage.completionTokens);
          row = { key, model, thinking, variant, caseId: c.id, run, outcome: s.outcome, why: s.why, ms: Math.round(r.latencyMs), inTok: r.usage.promptTokens, outTok: r.usage.completionTokens, thoughtTok: thoughts, got };
        } catch (e) {
          const pe = e instanceof ProviderError ? e : undefined;
          row = { key, model, thinking, variant, caseId: c.id, run, outcome: "error", why: redact(String((e as Error).message)).slice(0, 160), ms: null, inTok: 0, outTok: 0, thoughtTok: 0, status: pe?.status ?? pe?.kind ?? "?", quota: pe?.quota };
          if (pe?.status === 429 && pe.quota && /PerDay/i.test(pe.quota)) {
            console.log(`  [${model}] DAILY quota reached (${pe.quota}) - this model is stopped; ${done.size} rows kept`);
            stopped.add(model);
          }
        }
        done.set(key, row);
        if (outFile) appendFileSync(outFile, JSON.stringify(row) + "\n");
        process.stdout.write(row.outcome === "correct" ? "." : row.outcome === "bail" ? "b" : row.outcome === "wrong" ? "W" : "E");
        await sleep(paceMs);
      }
    }
    process.stdout.write("\n");
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------
console.log("\n| model | prompt | thinking | calls | correct | bail | WRONG | errors | median ms | p95 ms | in tok | out tok | thought tok | $ / call | runs differ |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const groups = [...new Set([...done.values()].map((r) => `${r.model}|${r.variant ?? "base"}|${r.thinking}`))].sort();
for (const group of groups) {
  {
    const [model, pv, thinking] = group.split("|") as [string, string, string];
    const rows = [...done.values()].filter((r) => r.model === model && (r.variant ?? "base") === pv && r.thinking === thinking);
    if (rows.length === 0) continue;
    const ok = rows.filter((r) => r.outcome !== "error");
    const price = PRICE[model];
    const avg = (f: (r: Row) => number) => (ok.length ? ok.reduce((a, r) => a + f(r), 0) / ok.length : 0);
    const cost = price ? (avg((r) => r.inTok) * price.in + (avg((r) => r.outTok) + avg((r) => r.thoughtTok)) * price.out) / 1e6 : NaN;
    const byCase = new Map<string, Set<string>>();
    for (const r of ok) { const s = byCase.get(r.caseId) ?? new Set(); s.add(JSON.stringify(r.got?.map((g) => [g.catalogId, g.qty, g.unit, g.total]))); byCase.set(r.caseId, s); }
    const differ = [...byCase.values()].filter((s) => s.size > 1).length;
    const ms = ok.map((r) => r.ms!).filter((x) => x !== null);
    console.log(`| ${model} | ${pv} | ${thinking} | ${rows.length} | ${rows.filter((r) => r.outcome === "correct").length} | ${rows.filter((r) => r.outcome === "bail").length} | ${rows.filter((r) => r.outcome === "wrong").length} | ${rows.filter((r) => r.outcome === "error").length} | ${Math.round(median(ms))} | ${Math.round(p95(ms))} | ${Math.round(avg((r) => r.inTok))} | ${Math.round(avg((r) => r.outTok))} | ${Math.round(avg((r) => r.thoughtTok))} | ${Number.isNaN(cost) ? "?" : "$" + cost.toFixed(5)} | ${differ} of ${byCase.size} cases |`);
  }
}
const wrong = [...done.values()].filter((r) => r.outcome === "wrong");
if (wrong.length) {
  console.log("\nEvery WRONG result:");
  for (const r of wrong) console.log(`  ${r.model} / ${r.variant ?? "base"} / ${r.thinking} / ${r.caseId} / run ${r.run}: ${r.why}`);
}
const errs = [...done.values()].filter((r) => r.outcome === "error");
if (errs.length) {
  const kinds = new Map<string, number>();
  for (const r of errs) kinds.set(`${r.model} status ${r.status}${r.quota ? " " + r.quota : ""}`, (kinds.get(`${r.model} status ${r.status}${r.quota ? " " + r.quota : ""}`) ?? 0) + 1);
  console.log("\nErrors:", [...kinds].map(([k, n]) => `${k} x${n}`).join("; "));
}
