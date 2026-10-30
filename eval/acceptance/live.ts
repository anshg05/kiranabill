/**
 * KB-364 (owner, 30 Oct 2026): the release gate, tier B - LIVE, from the AUDIO. Run before every release:
 *     npm run accept:live                       report only
 *     npm run accept:live -- --freeze           also freeze the Whisper text + Gemini's answers into the repo files tier A replays
 *     npm run accept:live -- --only A01,A07     a few orders
 *     npm run accept:live -- --max-gemini 30    the Gemini call budget (default 30)
 * Each recording goes through the REAL /voice (Groq Whisper) and then the shipped resolver with the REAL Layer 2, exactly as the app
 * does it. It DECLARES its calls first: one Groq call per recording and at most --max-gemini Gemini calls (only pieces Layer 1 cannot
 * read), shared with production's quota (docs/07-DECISIONS.md D99 item 11). Needs the local Docker stack + the keys in .env.local.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseTranscript, transcribeAudio } from "../../src/data/voiceApi.js";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { startLocalVoice } from "../../scripts/localVoice.js";
import { compareOrder, gate, type OrderVerdict } from "./compare.js";
import { runOrder } from "./run.js";
import { AUDIO_DIR, MIN_FROZEN_ORDERS, readOrders, readRecorded, writeOrders, writeRecorded, type Recorded } from "./store.js";
import { canLock } from "./tools.js";

const MIME: Record<string, string> = { webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" };
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = 4_000;
async function retry<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (attempt >= attempts) throw e;
      await sleep(attempt * 15_000);
    }
  }
}
const freeze = process.argv.includes("--freeze");
// --frozen-text: no Groq - the FROZEN Whisper text goes through the real Layer 2 (fresh Gemini answers). Tests a fix on the same text.
const frozenText = process.argv.includes("--frozen-text");
const only = arg("only")?.split(",");
const maxGemini = Number(arg("max-gemini") ?? 30);

const { orders: all, frozen } = readOrders();
const audioOf = (id: string) => (existsSync(AUDIO_DIR) ? readdirSync(AUDIO_DIR).find((f) => f.startsWith(`${id}.`)) : undefined);
const orders = all.filter((o) => (!only || only.includes(o.id)) && (frozenText ? !!o.transcript : audioOf(o.id)));
const skipped = all.filter((o) => !orders.includes(o) && (!only || only.includes(o.id)));
if (orders.length === 0) {
  console.error("No order with both a recording (eval/acceptance/audio) and an expected bill (orders.json). Import, fill the sheet, accept:build first.");
  process.exit(1);
}
console.log(`accept:live - ${frozenText ? "0 Groq transcription(s) (frozen text)" : `${orders.length} Groq transcription(s)`}, at most ${maxGemini} Gemini call(s); ${skipped.length} order(s) have no recording here and are skipped${freeze ? "; --freeze" : ""}`);

const voice = await startLocalVoice();
const verdicts: OrderVerdict[] = [];
const transcripts = new Map<string, string>();
const answered: Record<string, unknown> = {};
let geminiCalls = 0;
try {
  for (const o of orders) {
    let transcript: string;
    try {
      if (frozenText) transcript = o.transcript!;
      else {
        const file = audioOf(o.id)!;
        const ext = path.extname(file).slice(1);
        const blob = new Blob([readFileSync(path.join(AUDIO_DIR, file))], { type: MIME[ext] ?? "application/octet-stream" });
        // Groq answers "busy" when recordings are sent back to back (14 of 50 on 30 Oct): pace the calls and retry with a back-off
        transcript = await retry(() => transcribeAudio(blob, { accessToken: voice.accessToken, endpoint: voice.endpoint, language: "hi" }));
        await sleep(PACE_MS);
      }
    } catch (e) {
      console.log(`ERR   ${o.id} ${o.category}: transcription failed (${(e as Error).message})`);
      verdicts.push({ id: o.id, exact: false, wrong: [], missing: ["transcription failed"], extra: [], inexact: [], notAddedOk: false, unexpectedChecks: false, silentWrong: 0 });
      continue;
    }
    if (transcript.trim() === "") {
      // Whisper answered with nothing (A14, 30 Oct): that is a failure of the run, never a frozen text
      console.log(`ERR   ${o.id} ${o.category}: Whisper returned no text`);
      verdicts.push({ id: o.id, exact: false, wrong: [], missing: ["Whisper returned no text"], extra: [], inexact: [], notAddedOk: false, unexpectedChecks: false, silentWrong: 0 });
      continue;
    }
    transcripts.set(o.id, transcript);
    const actual = await runOrder(transcript, async (text, slice) => {
      if (++geminiCalls > maxGemini) throw new Error(`the Gemini budget (${maxGemini}) is used up - raise --max-gemini on purpose`);
      try {
        const items = await parseTranscript(text, { accessToken: voice.accessToken, endpoint: voice.endpoint, catalogSlice: slice });
        answered[text] = items;
        return items;
      } catch (e) {
        answered[text] = null;
        throw e;
      }
    });
    const v = compareOrder(o.id, o.expected, actual, SEED_PARSER_CATALOG);
    verdicts.push(v);
    const drift = o.transcript !== null && o.transcript !== transcript ? "  [Whisper text changed since it was frozen]" : "";
    const tag = v.wrong.length ? "WRONG" : v.exact ? "exact" : "inexact";
    console.log(`${tag.padEnd(7)} ${o.id} ${o.category}: "${transcript}"${drift}`);
    for (const w of v.wrong) console.log(`          ! ${w}`);
    for (const m of v.missing) console.log(`          - ${m}`);
    for (const x of v.inexact) console.log(`          ~ ${x}`);
    if (!v.notAddedOk) console.log(`          - the number of "Not added" pieces differs (${actual.unresolved}, expected ${o.expected.notAdded})`);
    if (v.unexpectedChecks) console.log(`          - ${actual.checks} Theek hai check(s), ${o.expected.checks} accepted`);
  }
} finally {
  voice.stop();
}

const g = gate(verdicts);
console.log(`\n${g.exact}/${g.total} exact, ${g.wrongLines} wrong line(s), ${g.unexpectedCheckOrders} order(s) with unexpected checks; ${geminiCalls} Gemini call(s) used`);
console.log(g.passed ? "accept:live PASSED" : `accept:live FAILED - ${g.reasons.join("; ")}`);

if (freeze) {
  const merged: Recorded = { ...readRecorded(), ...(answered as Recorded) };
  writeRecorded(merged);
  const next = all.map((o) => (transcripts.has(o.id) ? { ...o, transcript: transcripts.get(o.id)! } : o));
  const withText = next.filter((o) => !!o.transcript).length;
  const lock = canLock({ passed: g.passed, ranOrders: verdicts.length, ordersWithText: withText, min: MIN_FROZEN_ORDERS });
  writeOrders({ frozen: frozen || lock, orders: next });
  console.log(`Frozen: ${transcripts.size} transcript(s) and ${Object.keys(answered).length} Gemini answer(s) written (tier A replays them in npm test).`);
  console.log(lock ? "The set is now LOCKED: npm test enforces the full gate." : frozen ? "The set stays locked." : `The set is not locked yet (needs a passing run of the WHOLE set - every order with a frozen text, at least ${MIN_FROZEN_ORDERS}).`);
}
process.exit(g.passed ? 0 : 1);
