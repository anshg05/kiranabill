import type { ParserCatalog } from "../../src/domain/catalogIndex.js";
import { matchProductName, type ParsedItem } from "../../src/domain/grammar.js";
import { flagWeakProducts } from "../../src/domain/weakProduct.js";
import type { TokenUsage } from "../../src/voice/parseProvider.js";
import { compareOrder, type ActualBill } from "../acceptance/compare.js";
import { scoringCatalog } from "../acceptance/spellings.js";
import { LIMITS, transcribeTokens } from "./quota.js";
import type { ExpectedBill } from "../acceptance/types.js";

// KB-370 (V1 bake-off): scoring, cost and the call declaration. Pure - no network, no files (score.test.ts).

export const CANDIDATES = ["A", "A+vocab", "A-30s", "B", "B-novocab", "C", "C2", "D", "B-smart", "E-lite", "E-flash", "E-flash-1ear", "S", "nocat-old", "nocat-D103", "nocat-v2"] as const;
/** Round 1's set - what a run without --candidates measures (round-2 candidates run only when chosen). */
export const ROUND1_CANDIDATES: readonly CandidateId[] = ["A", "A+vocab", "A-30s", "B", "B-novocab", "C", "C2", "D"];
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
  "B-smart": "round 2: B with gemini-3.5-transcribe's SMART mode (resolves spoken corrections) -> Layer 1 + Layer 2 + checks",
  "E-lite": "round 2, Ezy-style: audio -> gemini-3.5-flash-lite with the D102 prompt (names as said, corrections edit the line) -> checks; every number must also be in B's transcript",
  "E-flash": "round 2, Ezy-style: the same with gemini-3.8-flash at thinking level low - TWO ears: every number must also be in B's saved transcript",
  "E-flash-1ear": "the SAME E-flash answers checked only against E-flash's own transcript - one call per bill, as Ezy probably works (no extra calls)",
  S: "round 2: Sarvam saaras:v4 (verbatim) as the ear -> Layer 1 + Layer 2 + checks; batch API over 30 s",
  "nocat-old": "nocat (6 Nov 2026): E-flash's call (gemini-3.8-flash, thinking low, the D102 prompt) WITHOUT the catalog; our code fills an unspoken price on one clear match; one ear",
  "nocat-v2": "KB-383: the V3 prompt (doc 25 §2) - nocat-D103 plus listed units, repeats as two lines, removal only when the item is named, the D105 quantity rule, Devanagari names and transcript",
  "nocat-D103": "nocat-old with the prompt's rule 3 rewritten to D103 (the unit next to the number wins: '1 किलो पैकेट' = 1 kg) - the version that would ship",
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
  /** KB-380 (owner, 7 Nov 2026): dropped lines the bill does NOT warn about - a silent undercharge. Warned = a whole-bill Theek hai (every
   * line warned) or a "Not added" piece. Scored by D102 only (older rows: undefined). */
  readonly silentDropped?: number;
  /** Owner, 8 Nov 2026: lines that ask the shopkeeper for a price (Price needed) - their own count, never merged with the Theek hai. */
  readonly priceNeededLines?: number;
  /** A product said once, billed twice, with NO Theek hai on the extra line - a wrong line (the dal-order failure). */
  readonly silentDuplicated: number;
  /** The same, but the extra line carries a Theek hai (owner, 1 Nov 2026: listed, not a silent wrong; the order is not exact). */
  readonly warnedDuplicated: number;
  readonly invented: number;
  /** A custom line whose numbers are right but whose name does not look like what was said (rule 2): not exact, not a wrong number. */
  readonly numbersRightNameWrong: number;
  readonly checks: number;
  /** Lines a Theek hai is shown on. */
  readonly warnedLines: number;
  /** Every wrong line, in plain words, for the report. */
  readonly wrong: readonly string[];
}

// KB-379: the owner's reviewed spellings and the scoring catalog moved to eval/acceptance/spellings.ts (the gate uses them too)
export { SCORING_SPELLINGS, scoringCatalog } from "../acceptance/spellings.js";
const scoringCache = new WeakMap<ParserCatalog, ParserCatalog>();

/** Does the chosen catalog product explain the OWNER's written name? The app's own KB-368 rule (flagWeakProducts), read with his words:
 * no flag = every content word of his name is close to the product's name or aliases - the same product under another spelling. */
const explains = (ownerName: string, item: ParsedItem, sc: ParserCatalog) => flagWeakProducts([{ ...item, spokenName: ownerName }], sc.entries).length === 0;

/** Kind-of-goods words: "पोपट दाल" minus its first word is only "दाल", which names no product. */
const CATEGORY_WORDS = new Set(["दाल", "तेल", "साबुन", "बिस्किट", "डिटर्जेंट", "मसाला", "आटा", "पाउडर", "पैकेट"]);
/**
 * Owner, 1 Nov 2026: a BRAND billed as the generic catalog product (एवरेस्ट किचन किंग मसाला -> Kitchen King) is "numbers right, name differs"
 * when the numbers are right. A brand = his name's FIRST word is the unexplained one, and the rest - with a word that is not just a
 * category - is explained by the product. "पोपट दाल" -> Chana Daal is no brand case: a different product, wrong.
 */
const brandOfGeneric = (ownerName: string, item: ParsedItem, sc: ParserCatalog) => {
  const rest = ownerName.trim().split(/\s+/).slice(1);
  return rest.some((w) => !CATEGORY_WORDS.has(w)) && explains(rest.join(" "), item, sc);
};

const NO_WARNING = " [NO warning]";
const WARNED = " [a Theek hai warned]";

/**
 * The acceptance comparison (eval/acceptance/compare.ts, unchanged - it is the gate's) against the scoring catalog, then the bake-off's own
 * rules (owner, 1 Nov 2026):
 * 1. "shop price" for a product the eval catalog does not have: "Price needed" is right (there is no shop price to fill in);
 * 2. a custom line for such a product: numbers right + a name that looks alike = right (compare.ts's rule); numbers right + a name that does
 *    not = "numbers right, name wrong"; a CATALOG product chosen instead = a wrong product;
 * 3. a product said once and billed twice: a warned duplicate (listed, not a wrong line, not exact) or a silent duplicate (a wrong line).
 * A line that never arrived is DROPPED; any other extra line is INVENTED.
 */
export function scoreRun(id: string, expected: ExpectedBill, actual: ActualBill, shop: ParserCatalog): RunScore {
  let sc = scoringCache.get(shop);
  if (!sc) scoringCache.set(shop, (sc = scoringCatalog(shop)));
  const v = compareOrder(id, expected, actual, sc);
  const wrong = [...v.wrong];
  const inexact: string[] = [];
  let numbersRightNameWrong = 0;
  const notInCatalog = new Set(expected.lines.filter((e) => !matchProductName(e.name, sc).catalogId).map((e) => e.name));
  const shopPriced = new Set(expected.lines.filter((e) => e.price.kind === "default").map((e) => e.name));
  // another finding about the same expected line (a number) means its numbers are not right
  const otherFinding = (name: string, x: string) => [...v.wrong, ...v.inexact].some((y) => y !== x && y.startsWith(`${name}:`));
  for (const x of v.inexact) {
    const name = x.slice(0, x.indexOf(":"));
    if (!notInCatalog.has(name)) {
      inexact.push(x);
      continue;
    }
    if (x === `${name}: the price was left out` && shopPriced.has(name)) continue; // rule 1
    const heard = /: the name differs - heard "(.*)" \((.*)\)$/.exec(x);
    if (!heard || otherFinding(name, x)) {
      inexact.push(x);
      continue;
    }
    if (heard[2] === "not in the catalog") numbersRightNameWrong++; // rule 2
    else {
      // rule 2: the owner's spelling is not in the catalog and the app claimed a catalog product - wrong, unless that product explains it
      const j = actual.lines.findIndex((l) => l.item.spokenName === heard[1] && l.item.catalogId !== null);
      if (j >= 0 && explains(name, actual.lines[j]!.item, sc)) continue;
      if (j >= 0 && brandOfGeneric(name, actual.lines[j]!.item, sc)) (numbersRightNameWrong++); // its numbers are right: no other finding
      else wrong.push(`${name}: wrong product - heard "${heard[1]}" (${heard[2]})${(actual.warnedLines ?? []).includes(j) ? WARNED : NO_WARNING}`);
    }
  }

  // rule 2, the case compare.ts calls right: the heard WORDS match the owner's name but the line claims a catalog product - and the owner's
  // product is not in the catalog, so that product cannot be it (e.g. "पोपट दाल" billed as Chana Daal). Each such line once.
  // Also (owner, 1 Nov 2026 - the canary's hole): his name resolves to product X, the line claims ANOTHER catalog product Y with his words
  // (C: रिन साबुन -> Lifebuoy, फेना साबुन -> Godrej No.1, फेना डिटर्जेंट -> Nirma, रवा -> Chhena) - compare.ts calls that right; it is not.
  const claimed = new Set<number>();
  for (const e of expected.lines) {
    const j = actual.lines.findIndex((l, k) => {
      // the product his name resolves to always explains it (its names, or the scoring spellings) - so no separate "same id" test is needed
      if (l.item.catalogId === null || claimed.has(k)) return false;
      const one = compareOrder(id, { lines: [e], notAdded: 0, checks: 0 }, { lines: [l], unresolved: 0, checks: 0 }, sc);
      return one.extra.length === 0 && ![...one.wrong, ...one.inexact].some((y) => y.includes("name differs") || y.includes("wrong product")) && !explains(e.name, l.item, sc);
    });
    if (j < 0) continue;
    claimed.add(j);
    const l = actual.lines[j]!;
    // the brand case with right numbers (no other finding about this line) is a name that differs, not a wrong product
    if (brandOfGeneric(e.name, l.item, sc) && !otherFinding(e.name, "")) {
      numbersRightNameWrong++;
      continue;
    }
    wrong.push(`${e.name}: wrong product - heard "${l.item.spokenName}" (${l.displayName})${(actual.warnedLines ?? []).includes(j) ? WARNED : NO_WARNING}`);
  }

  // rule 3: an extra line for a product the owner said once (and that is already on the bill) is a duplicate - warned or silent
  const want = new Map<string, number>();
  for (const e of expected.lines) {
    const cid = matchProductName(e.name, sc).catalogId;
    if (cid) want.set(cid, (want.get(cid) ?? 0) + 1);
  }
  const got = new Map<string, number>();
  for (const l of actual.lines) if (l.item.catalogId) got.set(l.item.catalogId, (got.get(l.item.catalogId) ?? 0) + 1);
  const surplus = new Set([...got].filter(([cid, n]) => (want.get(cid) ?? 0) >= 1 && n > want.get(cid)!).map(([cid]) => cid));
  let silentDuplicated = 0;
  let warnedDuplicated = 0;
  for (let k = wrong.length - 1; k >= 0; k--) {
    const m = /^an extra line: (.*?)( \[a Theek hai warned\]| \[NO warning\])$/.exec(wrong[k]!);
    if (!m || !actual.lines.some((l) => l.item.spokenName === m[1] && l.item.catalogId !== null && surplus.has(l.item.catalogId))) continue;
    if (m[2] === WARNED) (warnedDuplicated++, wrong.splice(k, 1));
    else silentDuplicated++;
  }

  const wrongProducts = wrong.filter((w) => w.includes("wrong product")).length;
  const exact = v.notAddedOk && actual.checks <= expected.checks && wrong.length === 0 && inexact.length === 0 && v.missing.length === 0 && numbersRightNameWrong === 0 && warnedDuplicated === 0;
  return {
    exact,
    wrongLines: wrong.length,
    silentWrong: wrong.filter((w) => w.endsWith(NO_WARNING)).length,
    wrongNumbers: wrong.length - wrongProducts,
    wrongProducts,
    dropped: v.missing.length,
    silentDuplicated,
    warnedDuplicated,
    invented: v.extra.length - silentDuplicated - warnedDuplicated,
    numbersRightNameWrong,
    checks: actual.checks,
    warnedLines: actual.warnedLines?.length ?? 0,
    wrong,
  };
}

export interface SavedLine {
  readonly name: string;
  readonly catalogId: string | null;
  readonly qty: number | null;
  readonly unit: string;
  readonly rate: number | null;
  readonly total: number | null;
  readonly priceType: string;
  /** A Theek hai is shown on this line (saved since the canary; the canary's rows have no such field). */
  readonly warned?: boolean;
}

/** What a run saves of a bill - everything scoreRun reads. */
export function toSaved(actual: ActualBill): { lines: SavedLine[]; unresolved: number } {
  const warned = new Set(actual.warnedLines ?? []);
  return {
    lines: actual.lines.map(({ item: i }, k) => ({ name: i.spokenName, catalogId: i.catalogId, qty: i.qty, unit: i.unit, rate: i.rate, total: i.total, priceType: i.priceType, warned: warned.has(k) })),
    unresolved: actual.unresolved,
  };
}

/** The bill back from what was saved, for re-scoring offline. The shown name is rebuilt the app's way: the catalog's for a matched line. */
export function fromSaved(saved: { lines: readonly SavedLine[]; unresolved?: number }, shop: ParserCatalog, checks = 0): ActualBill {
  const lines = saved.lines.map((l) => {
    const item: ParsedItem = { spokenName: l.name, catalogId: l.catalogId, isCustom: l.catalogId === null, matchStatus: l.catalogId === null ? "none" : "matched", qty: l.qty, unit: l.unit, rate: l.rate, rateUnit: l.rate === null ? null : l.unit, total: l.total, priceType: l.priceType as ParsedItem["priceType"] };
    return { item, displayName: (l.catalogId && shop.byId.get(l.catalogId)?.displayName) || l.name };
  });
  const warnedLines = saved.lines.flatMap((l, k) => (l.warned ? [k] : []));
  return { lines, unresolved: saved.unresolved ?? 0, checks: Math.max(checks, warnedLines.length), warnedLines };
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
  /** The recording's length in seconds (from its header) - the report marks those over 40 s. */
  readonly audioSeconds: number;
  /** The bill's lines as the candidate produced them - kept so a scoring fix is re-scored offline, with no new call (fromSaved). */
  readonly lines?: readonly SavedLine[];
  /** "Not added" pieces (saved since the canary; older rows have none). */
  readonly unresolved?: number;
  /** The model's RAW items, before any of our checks: C (so D can be rebuilt), and since 6 Nov 2026 E-flash and nocat-* (owner: to prove
   * whether KB-359 stripped a quantity the model did give - A57 / A42). The raw transcript is `transcript`. */
  readonly items?: readonly ParsedItem[];
  /** E-*: the thinking tokens Gemini reported; null = the answer carried no such field (round 2 checks the thinking level took effect). */
  readonly thoughts?: number | null;
  /** S: Sarvam's batch waits (upload; queue + processing; download), ms. */
  readonly waits?: { readonly uploadMs: number; readonly queueMs: number; readonly downloadMs: number; readonly polls: number };
  /** Produced by a --merge re-run: kept and skipped when the same command runs again (resume after a daily stop). */
  readonly rerun?: boolean;
  /** A provider failure or timeout - the order shows nothing (or "Not added"), never a wrong line. */
  readonly error?: string;
  /** The provider's own message for that failure (the full error body). */
  readonly errorDetail?: string;
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
    silentDropped: sum((r) => r.silentDropped ?? 0),
    priceNeededLines: sum((r) => r.priceNeededLines ?? 0),
    silentDuplicated: sum((r) => r.silentDuplicated),
    warnedDuplicated: sum((r) => r.warnedDuplicated),
    numbersRightNameWrong: sum((r) => r.numbersRightNameWrong),
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
    audioSeconds: rs[0]!.audioSeconds,
  }));
}

export interface Recording {
  readonly id: string;
  readonly set: OrderSet;
  readonly seconds: number;
}

/** The candidates that run on a set (A-30s only on long orders; D reuses B's and C's answers). */
export const candidatesFor = (set: OrderSet): CandidateId[] => CANDIDATES.filter((c) => c !== "D" && (c !== "A-30s" || set === "long"));

/**
 * The declaration's estimate (owner, 1 Nov 2026: list prices + thinking tokens + 18% GST - the Rs 404 drop was the whole of October, not
 * the run). Prompt tokens are estimated by the runner from the characters it sends; audio is 32 tokens a second (docs/audio). Answers and
 * the thinking allowance are estimates the canary replaces with real counts (usageMetadata, thinking included since geminiAudio.ts).
 */
export const GST = 0.18;
export interface TokenEstimate {
  readonly layer2In: number; // the grammar prompt + a 30-product slice + one order
  readonly cIn: number; // the grammar prompt + the audio addendum + the whole catalog (without the audio)
  readonly nocatIn?: number; // the no-catalog prompt alone (without the audio)
}
const OUT = { transcribePerSecond: 8, layer2: 400, c: 900 };
const THINKING = 1; // allowance: as many thinking tokens as answer tokens (gemini-3.5-flash-lite thinks "minimal" by default)
const withThinking = (out: number) => out * (1 + THINKING);
/** Medians measured on 1 Nov 2026 (results-2026-10-31.json), for the time estimate. */
export const MEASURED_SECONDS = { groq: 0.8, transcribe: 3.6, layer2: 1.5, c: 3.3, c2: 20, sarvamRest: 2, sarvamBatch: 60 }; // Sarvam: NOT measured yet - the canary measures it
/** Sarvam speech-to-text, Pay as you go: Rs 0.49 a minute, billed per second, before GST (docs.sarvam.ai/api/getting-started/pricing, read 5 Nov 2026). */
export const SARVAM_INR_PER_MINUTE = 0.49;

/** Every call a run makes, BEFORE it makes one (D99 item 11), its estimated bill (USD, GST included) and its minutes. Layer 2 is at most one
 * call per order and run for the Whisper-like candidates. `chosen` narrows a re-run; D never calls anything itself. */
export function declare(recordings: readonly Recording[], longRuns: number, chosen: readonly CandidateId[] = ROUND1_CANDIDATES, pace = { transcribeS: 3, otherS: 3 }, est: TokenEstimate = { layer2In: 4_000, cIn: 14_000 }, inrPerUsd = 95.17) {
  const calls = { groq: 0, transcribe: 0, layer2Max: 0, audioLite: 0, audioFlash: 0, sarvam: 0 };
  let usd = 0;
  let seconds = 0;
  const s = MEASURED_SECONDS;
  const t = (model: string, input: number, output: number) => tokensUsd(model, { promptTokens: input, completionTokens: output, totalTokens: input + output });
  for (const r of recordings) {
    const runs = r.set === "long" ? longRuns : 1;
    const audio = r.seconds * 32;
    for (const c of candidatesFor(r.set).filter((x) => chosen.includes(x))) {
      for (let i = 0; i < runs; i++) {
        if (c === "A" || c === "A+vocab" || c === "A-30s") (calls.groq++, (usd += groqUsd(r.seconds) / (1 + GST)), (seconds += pace.otherS + s.groq)); // Groq bills in USD, no Indian GST
        // a long clip waits for the token minute (9,000 of 10K) rather than the request minute
        if (c === "B" || c === "B-novocab" || c === "B-smart") (calls.transcribe++, (usd += t("gemini-3.5-transcribe", audio, r.seconds * OUT.transcribePerSecond)), (seconds += Math.max(pace.transcribeS, (transcribeTokens(r.seconds) / (LIMITS.tpm * LIMITS.margin)) * 60) + s.transcribe));
        if (c.startsWith("A") || c.startsWith("B")) (calls.layer2Max++, (usd += t("gemini-3.5-flash-lite", est.layer2In, withThinking(OUT.layer2))), (seconds += pace.otherS + s.layer2));
        if (c === "S") (calls.sarvam++, (usd += (r.seconds / 60) * SARVAM_INR_PER_MINUTE / inrPerUsd), (seconds += pace.otherS + (r.seconds > 30 ? s.sarvamBatch : s.sarvamRest)));
        if (c === "S") (calls.layer2Max++, (usd += t("gemini-3.5-flash-lite", est.layer2In, withThinking(OUT.layer2))), (seconds += pace.otherS + s.layer2));
        if (c === "C" || c === "E-lite") (calls.audioLite++, (usd += t("gemini-3.5-flash-lite", est.cIn + audio, withThinking(OUT.c))), (seconds += pace.otherS + s.c));
        if (c === "C2" || c === "E-flash") (calls.audioFlash++, (usd += t("gemini-3.8-flash", est.cIn + audio, withThinking(OUT.c))), (seconds += pace.otherS + s.c2));
        if (c === "nocat-old" || c === "nocat-D103" || c === "nocat-v2") (calls.audioFlash++, (usd += t("gemini-3.8-flash", (est.nocatIn ?? 1_000) + audio, withThinking(OUT.c))), (seconds += pace.otherS + s.c2));
      }
    }
  }
  return { calls, total: calls.groq + calls.transcribe + calls.layer2Max + calls.audioLite + calls.audioFlash + calls.sarvam, usd: usd * (1 + GST), minutes: seconds / 60 };
}
