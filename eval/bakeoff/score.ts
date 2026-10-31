import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { matchProductName } from "../../src/domain/grammar.js";
import type { TokenUsage } from "../../src/voice/parseProvider.js";
import { compareOrder, type ActualBill } from "../acceptance/compare.js";
import type { ExpectedBill } from "../acceptance/types.js";

// KB-370 (V1 bake-off): scoring, cost and the call declaration. Pure - no network, no files (score.test.ts).

export const CANDIDATES = ["A", "A+vocab", "A-30s", "B", "B-novocab", "C", "C2", "D"] as const;
export type CandidateId = (typeof CANDIDATES)[number];
export type OrderSet = "short" | "long";

/** What each candidate is, in the report's words. */
export const CANDIDATE_LABEL: Record<CandidateId, string> = {
  A: "today: Groq whisper-large-v3 (8 s limit) -> Layer 1 -> Layer 2 (gemini-3.5-flash-lite) -> checks",
  "A+vocab": "A with the KB-007 vocabulary prompt",
  "A-30s": "A with a 30 s Groq limit (long orders only) - separates 'Whisper mis-heard' from 'the 8 s limit cut it off'",
  B: "gemini-3.5-transcribe (with vocabulary) -> the same Layer 1 + Layer 2 + checks",
  "B-novocab": "B without the vocabulary",
  C: "audio -> gemini-3.5-flash-lite: transcript + items in one call -> the same checks on its transcript",
  C2: "C with gemini-3.8-flash",
  D: "hybrid: C's items, a number counts only if B's transcript has it (no extra calls)",
};

/** USD. Gemini: Standard paid tier per 1M tokens, https://ai.google.dev/gemini-api/docs/pricing (page "last updated 2026-10-30");
 * Groq: https://console.groq.com/docs/speech-to-text (read 31 Oct 2026; $0.111 an hour, at least 10 s billed per request). */
export const PRICE_SOURCES = "Gemini: ai.google.dev/gemini-api/docs/pricing (last updated 2026-10-30); Groq: console.groq.com/docs/speech-to-text (read 31 Oct 2026)";
const TOKEN_PRICE: Record<string, { in: number; out: number }> = {
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 }, // the same rate for audio and text input
  "gemini-3.8-flash": { in: 0.75, out: 3.75 }, // until 31 Dec 2026; doubles on 1 Jan 2027
  "gemini-3.5-transcribe": { in: 2.0, out: 12.0 }, // audio input / text output
};
const GROQ_PER_HOUR = 0.111;
const GROQ_MIN_SECONDS = 10;

export const groqUsd = (seconds: number) => (Math.max(GROQ_MIN_SECONDS, seconds) / 3600) * GROQ_PER_HOUR;
export function tokensUsd(model: string, usage: TokenUsage): number {
  const p = TOKEN_PRICE[model];
  if (!p) throw new Error(`no price for ${model} - add it from the pricing page`);
  return (usage.promptTokens * p.in + usage.completionTokens * p.out) / 1e6;
}
export const BILLS_PER_MONTH = 100 * 30;
export const monthlyInr = (usdPerBill: number, inrPerUsd: number) => usdPerBill * inrPerUsd * BILLS_PER_MONTH;

/** A browser recording's length: the Duration in the WebM header (Segment > Info), else an estimate from its size at 128 kbps. */
export function webmSeconds(buf: Buffer): number {
  const info = buf.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  const at = info < 0 ? -1 : buf.indexOf(Buffer.from([0x44, 0x89]), info);
  if (at > 0 && at - info < 256) {
    const size = buf[at + 2]!;
    const ms = size === 0x84 ? buf.readFloatBE(at + 3) : size === 0x88 ? buf.readDoubleBE(at + 3) : NaN;
    const ts = buf.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]), info);
    const scaleNs = ts > 0 && ts < at ? buf.readUIntBE(ts + 4, buf[ts + 3]! & 0x0f) : 1_000_000;
    if (Number.isFinite(ms) && ms > 0) return (ms * scaleNs) / 1e9;
  }
  return buf.length / 16_000;
}

export interface RunScore {
  readonly exact: boolean;
  readonly wrongLines: number;
  readonly silentWrong: number;
  readonly wrongNumbers: number;
  readonly wrongProducts: number;
  readonly dropped: number;
  readonly duplicated: number;
  readonly invented: number;
  readonly checks: number;
  /** Lines a Theek hai is shown on. */
  readonly warnedLines: number;
  /** Every wrong line, in plain words, for the report. */
  readonly wrong: readonly string[];
}

/** The acceptance comparison (eval/acceptance/compare.ts) plus what a long order breaks: a product said once billed twice is DUPLICATED,
 * an extra line for a product nobody said is INVENTED, a line that never arrived is DROPPED. */
export function scoreRun(id: string, expected: ExpectedBill, actual: ActualBill, shop: ParserCatalog): RunScore {
  const v = compareOrder(id, expected, actual, shop);
  const want = new Map<string, number>();
  for (const e of expected.lines) {
    const cid = matchProductName(e.name, shop).catalogId;
    if (cid) want.set(cid, (want.get(cid) ?? 0) + 1);
  }
  const got = new Map<string, number>();
  for (const l of actual.lines) if (l.item.catalogId) got.set(l.item.catalogId, (got.get(l.item.catalogId) ?? 0) + 1);
  let duplicated = 0;
  for (const [cid, n] of got) if ((want.get(cid) ?? 0) >= 1) duplicated += Math.max(0, n - want.get(cid)!);
  duplicated = Math.min(duplicated, v.extra.length);
  const wrongProducts = v.wrong.filter((w) => w.includes("wrong product")).length;
  return {
    exact: v.exact,
    wrongLines: v.wrong.length,
    silentWrong: v.silentWrong,
    wrongNumbers: v.wrong.length - wrongProducts,
    wrongProducts,
    dropped: v.missing.length,
    duplicated,
    invented: v.extra.length - duplicated,
    checks: actual.checks,
    warnedLines: actual.warnedLines?.length ?? 0,
    wrong: v.wrong,
  };
}

export interface RunResult extends RunScore {
  readonly candidate: CandidateId;
  readonly id: string;
  readonly set: OrderSet;
  readonly run: number;
  readonly transcript: string | null;
  /** Wall time from the end of the recording to the items (the PC's network + the models), seconds. */
  readonly seconds: number;
  readonly usd: number;
  /** A provider failure or timeout - the order shows nothing (or "Not added"), never a wrong line. */
  readonly error?: string;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};

export function summarize(results: readonly RunResult[], inrPerUsd: number) {
  const n = results.length;
  const sum = (f: (r: RunResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const usdPerBill = n === 0 ? 0 : sum((r) => r.usd) / n;
  const secs = results.map((r) => r.seconds);
  return {
    runs: n,
    exact: results.filter((r) => r.exact).length,
    wrongLines: sum((r) => r.wrongLines),
    silentWrong: sum((r) => r.silentWrong),
    wrongNumbers: sum((r) => r.wrongNumbers),
    wrongProducts: sum((r) => r.wrongProducts),
    dropped: sum((r) => r.dropped),
    duplicated: sum((r) => r.duplicated),
    invented: sum((r) => r.invented),
    warnedLines: sum((r) => r.warnedLines),
    errors: results.filter((r) => r.error).length,
    secondsMedian: quantile(secs, 0.5),
    secondsP90: quantile(secs, 0.9),
    secondsMax: secs.length ? Math.max(...secs) : 0,
    usdPerBill,
    inrPerBill: usdPerBill * inrPerUsd,
    inrPerMonth: monthlyInr(usdPerBill, inrPerUsd),
  };
}

/** Per recording and candidate, over its runs (long orders run three times: the AI's answer varies). */
export function perRecording(results: readonly RunResult[]) {
  const groups = new Map<string, RunResult[]>();
  for (const r of results) groups.set(`${r.candidate}|${r.id}`, [...(groups.get(`${r.candidate}|${r.id}`) ?? []), r]);
  return [...groups.values()].map((rs) => ({
    candidate: rs[0]!.candidate,
    id: rs[0]!.id,
    runs: rs.length,
    exactRuns: rs.filter((r) => r.exact).length,
    bestWrong: Math.min(...rs.map((r) => r.wrongLines)),
    worstWrong: Math.max(...rs.map((r) => r.wrongLines)),
    avgWrong: rs.reduce((a, r) => a + r.wrongLines, 0) / rs.length,
    avgSeconds: rs.reduce((a, r) => a + r.seconds, 0) / rs.length,
  }));
}

export interface Recording {
  readonly id: string;
  readonly set: OrderSet;
  readonly seconds: number;
}

/** The candidates that run on a set (A-30s only on long orders; D reuses B's and C's answers). */
export const candidatesFor = (set: OrderSet): CandidateId[] => CANDIDATES.filter((c) => c !== "D" && (c !== "A-30s" || set === "long"));

// Estimates for the declaration only - the report uses each call's real token counts. A Layer 2 call (the grammar prompt + a 30-product
// slice + one order) and a C call (the prompt + the whole catalog + the audio at 32 tokens a second).
const LAYER2_TOKENS = { in: 4_000, out: 400 };
const C_TEXT_TOKENS_IN = 14_000;
const C_TOKENS_OUT = 900;

/** Every call a run makes, BEFORE it makes one (D99 item 11). Layer 2 is at most one call per order and run for the Whisper-like candidates. */
export function declare(recordings: readonly Recording[], longRuns: number) {
  const calls = { groq: 0, transcribe: 0, layer2Max: 0, audioLite: 0, audioFlash: 0 };
  let usd = 0;
  for (const r of recordings) {
    const runs = r.set === "long" ? longRuns : 1;
    for (const c of candidatesFor(r.set)) {
      for (let i = 0; i < runs; i++) {
        const audioTokens = r.seconds * 32;
        if (c === "A" || c === "A+vocab" || c === "A-30s") (calls.groq++, (usd += groqUsd(r.seconds)));
        if (c === "B" || c === "B-novocab") (calls.transcribe++, (usd += tokensUsd("gemini-3.5-transcribe", { promptTokens: audioTokens, completionTokens: 200, totalTokens: 0 })));
        if (c.startsWith("A") || c.startsWith("B")) (calls.layer2Max++, (usd += tokensUsd("gemini-3.5-flash-lite", { promptTokens: LAYER2_TOKENS.in, completionTokens: LAYER2_TOKENS.out, totalTokens: 0 })));
        const cIn = { promptTokens: C_TEXT_TOKENS_IN + audioTokens, completionTokens: C_TOKENS_OUT, totalTokens: 0 };
        if (c === "C") (calls.audioLite++, (usd += tokensUsd("gemini-3.5-flash-lite", cIn)));
        if (c === "C2") (calls.audioFlash++, (usd += tokensUsd("gemini-3.8-flash", cIn)));
      }
    }
  }
  return { calls, total: calls.groq + calls.transcribe + calls.layer2Max + calls.audioLite + calls.audioFlash, usd };
}
