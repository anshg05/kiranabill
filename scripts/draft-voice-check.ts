// KB-384a step 6 (owner, 10 Nov 2026; D107): the async voice path end to end on the DRAFT, run by the OWNER himself with his own login:
//     npm run draft:voice
// It asks for his session token at a HIDDEN prompt (never stored, never printed), then for A63 and A61 (one Gemini call each - the
// approved cap is Rs 2): upload to production Supabase -> /voice-run on the draft (a background function) -> watch the row -> the bill
// (src/domain/aiAnswerBill). Then a Retry and a double tap on a done recording must make NO second Gemini call (attempts stays 1).
// Prints times and results only; writes them to eval/acceptance/audio/step6-results.json (git-ignored, with the audio).
// The recordings are never marked billed: the daily clean-up deletes them 7 days after upload.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { aiAnswerBill } from "../src/domain/aiAnswerBill.js";
import { SEED_PARSER_CATALOG } from "../src/domain/seedCatalog.js";
import { submitRecording } from "../src/data/voiceJob.js";

export const DRAFT_ORIGIN = "https://release-draft--kiranabilling.netlify.app";
const APPROVED = ["A63", "A61"];

/** Everything wrong with a run plan. Empty = it may run. */
export function checkPlan(ids: string[], origin: string): string[] {
  const problems: string[] = [];
  if (origin !== DRAFT_ORIGIN) problems.push(`only the draft (${DRAFT_ORIGIN}) - never ${origin}`);
  if (ids.length > 2) problems.push("at most 2 recordings (the approved Gemini cap)");
  if (new Set(ids).size !== ids.length) problems.push("a recording listed twice");
  for (const id of ids) if (!APPROVED.includes(id)) problems.push(`${id} is not one of the approved recordings (${APPROVED.join(", ")})`);
  return problems;
}

export const mimeOf = (file: string) => (file.endsWith(".m4a") ? "audio/mp4" : "audio/webm");

/** Reads a line without showing it (each key is swallowed). Pasting works. */
function hiddenPrompt(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode?.(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") process.exit(1); // Ctrl+C
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const ids = APPROVED;
  const problems = checkPlan(ids, DRAFT_ORIGIN);
  if (problems.length) throw new Error(problems.join("; "));

  // production's PUBLIC Supabase address and anon key (the same ones the draft's bundle carries) - lengths only are printed
  const env = JSON.parse(execSync("npx netlify env:list --site kiranabilling --context production --scope builds --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Record<string, string>;
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("could not read production's VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from Netlify");
  console.log(`production Supabase: set, ${url.length} chars; anon key: set, ${anonKey.length} chars`);

  const token = await hiddenPrompt("Paste your session token (hidden), then Enter: ");
  if (token.split(".").length !== 3) throw new Error("that is not a session token (expected three dot-separated parts)");
  console.log(`token: received, ${token.length} chars`);
  const db = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: member, error } = await db.from("shop_members").select("shop_id").limit(1);
  if (error || !member?.[0]) throw new Error("this token has no shop (signed out or expired? copy a fresh one)");
  const shopId = member[0].shop_id as string;

  const results: Record<string, unknown>[] = [];
  for (const id of ids) {
    const file = id === "A63" ? "A63.m4a" : "A61.webm";
    const audio = new Blob([readFileSync(path.join("eval", "acceptance", "audio", file))], { type: mimeOf(file) });
    const recordingId = crypto.randomUUID();
    const submit = () => submitRecording({ client: db, shopId, recordingId, audio, accessToken: token, endpoint: `${DRAFT_ORIGIN}/voice-run` });
    const t0 = performance.now();
    const out = await submit();
    const totalMs = Math.round(performance.now() - t0);
    const row = (await db.from("voice_recordings").select("attempts, started_at, finished_at, model, usage, error").eq("recording_id", recordingId).maybeSingle()).data as {
      attempts: number; started_at: string; finished_at: string; model: string; usage: unknown; error: string | null;
    } | null;
    const workerMs = row?.started_at && row.finished_at ? new Date(row.finished_at).getTime() - new Date(row.started_at).getTime() : null;
    console.log(`\n${id} (${(audio.size / 1e6).toFixed(1)} MB): ${out.kind}${out.kind === "failed" ? ` (${out.reason})` : ""} - phone's total ${totalMs} ms (upload + start + waiting), worker ${workerMs} ms (claim -> Gemini -> stored), model ${row?.model}, attempts ${row?.attempts}`);

    // Retry, then a double tap, on the DONE recording: no second Gemini call
    const t1 = performance.now();
    const retry = await submit();
    const retryMs = Math.round(performance.now() - t1);
    const [tapA, tapB] = await Promise.all([submit(), submit()]);
    const after = (await db.from("voice_recordings").select("attempts").eq("recording_id", recordingId).maybeSingle()).data as { attempts: number } | null;
    console.log(`  Retry: ${retry.kind} in ${retryMs} ms; double tap: ${tapA.kind} / ${tapB.kind}; attempts after both: ${after?.attempts} (1 = no second Gemini call)`);

    let bill: Record<string, unknown> | null = null;
    if (out.kind === "done") {
      const b = aiAnswerBill(out.transcript, out.items, SEED_PARSER_CATALOG);
      const high = new Set(b.flags.filter((f) => f.severity === "HIGH" || f.severity === "BLOCK").map((f) => f.itemIndex ?? -1));
      const priceNeeded = b.lines.filter((l) => l.item.total === null).length;
      const totalPaise = b.lines.reduce((s, l) => s + (l.item.total ?? 0), 0);
      bill = { lines: b.lines.length, theekHaiChecks: high.size, priceNeeded, totalPaise, items: b.lines.map((l) => ({ name: l.displayName, qty: l.item.qty, unit: l.item.unit, rate: l.item.rate, total: l.item.total })) };
      console.log(`  bill: ${b.lines.length} lines, ${high.size} Theek hai check(s), ${priceNeeded} Price needed, total of priced lines Rs ${(totalPaise / 100).toFixed(2)}`);
    }
    results.push({ id, recordingId, outcome: out.kind, reason: out.kind === "failed" ? out.reason : null, totalMs, workerMs, retryMs, attemptsAfterRetryAndDoubleTap: after?.attempts, model: row?.model, usage: row?.usage, transcript: out.kind === "done" ? out.transcript : null, bill });
  }
  writeFileSync(path.join("eval", "acceptance", "audio", "step6-results.json"), JSON.stringify({ when: new Date().toISOString(), draft: DRAFT_ORIGIN, results }, null, 1));
  console.log("\nSaved eval/acceptance/audio/step6-results.json (git-ignored). Tell Claude it is done.");
}

if (process.argv[1] && /draft-voice-check/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(`draft-voice-check: ${(e as Error).message}`);
    process.exit(1);
  });
}
