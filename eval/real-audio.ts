/**
 * KB-317 - Whisper model comparison on the OWNER'S REAL RECORDINGS (Groq only;
 * never Gemini). Report only - the model in the app does not change (owner
 * decides; 04-VOICE-PIPELINE.md section 2).
 *
 * Recordings come from the app's dev-only `?save=1` (vite.config.ts writes
 * eval/real-audio/<timestamp>.<ext> + .json; the folder is gitignored - the
 * owner's voice). Each one is re-transcribed with whisper-large-v3 and
 * whisper-large-v3-turbo through the SHIPPED Groq provider, timed, and run
 * through Layer 1 (eval/real-transcripts.ts's scorer). A recording linked from
 * eval/real-transcripts.json (`audio`) is scored against its owner-confirmed
 * expected lines; any other recording is shown side by side, unscored.
 *
 * Needs GROQ_API_KEY in .env.local (read here, never printed).
 * Run: npm run eval:audio
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGroqTranscriptionProvider } from "../src/voice/groqTranscriptionProvider.js";
import { loadRealTranscripts, scoreTranscript, type Outcome } from "./real-transcripts.js";

const MODELS = ["whisper-large-v3", "whisper-large-v3-turbo"] as const;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audioDir = path.join(root, "eval", "real-audio");

function groqKey(): string {
  const line = readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("GROQ_API_KEY="));
  const key = line?.slice("GROQ_API_KEY=".length).replace(/^"|"$/g, "").trim();
  if (!key) throw new Error("GROQ_API_KEY missing from .env.local");
  return key;
}

interface SavedMeta {
  audioFile: string;
  mime: string;
  transcript?: string;
  lang?: string;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN);

async function main(): Promise<void> {
  if (!existsSync(audioDir)) {
    console.log("No eval/real-audio/ yet - record with the app's ?save=1 first (npm run dev or npx netlify dev).");
    return;
  }
  const saved = readdirSync(audioDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(audioDir, f), "utf8")) as SavedMeta)
    .filter((m) => existsSync(path.join(audioDir, m.audioFile)));
  if (saved.length === 0) {
    console.log("eval/real-audio/ has no recordings yet.");
    return;
  }
  const fixtures = new Map(loadRealTranscripts().filter((c) => c.audio).map((c) => [c.audio!, c]));
  const key = groqKey();
  const stats = Object.fromEntries(MODELS.map((m) => [m, { ms: [] as number[], outcomes: [] as Outcome[] }]));

  console.log(`Whisper comparison on ${saved.length} real recording(s); ${fixtures.size} linked to confirmed fixtures\n`);
  for (const meta of saved) {
    const fixture = fixtures.get(meta.audioFile);
    const audio = new Blob([readFileSync(path.join(audioDir, meta.audioFile))], { type: meta.mime });
    const language = meta.lang && meta.lang !== "auto" ? meta.lang : undefined;
    console.log(`${meta.audioFile}${fixture ? ` (${fixture.id})` : " (no fixture - unscored)"}  at record time: "${meta.transcript ?? "?"}"`);
    for (const model of MODELS) {
      const t0 = performance.now();
      const { text } = await createGroqTranscriptionProvider(key, model).transcribe(audio, { language });
      const ms = Math.round(performance.now() - t0);
      stats[model]!.ms.push(ms);
      let scored = "";
      if (fixture) {
        const r = await scoreTranscript(text.trim(), fixture.expectedLines, fixture.expectedFlags);
        stats[model]!.outcomes.push(r.outcome);
        scored = ` -> ${r.outcome}`;
      }
      console.log(`   ${model.padEnd(24)} ${String(ms).padStart(5)} ms  "${text.trim()}"${scored}`);
    }
  }
  console.log("\nSUMMARY");
  for (const model of MODELS) {
    const s = stats[model]!;
    const n = (o: Outcome) => s.outcomes.filter((x) => x === o).length;
    console.log(
      `   ${model.padEnd(24)} median ${median(s.ms)} ms | scored ${s.outcomes.length}: hit-correct ${n("hit-correct")}, hit-WRONG ${n("hit-wrong")}, miss ${n("miss")}`,
    );
  }
}

void main();
