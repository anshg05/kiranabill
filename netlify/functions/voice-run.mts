import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { EZY_V3_PROMPT } from "../../src/voice/audioPrompts.js";
import { createGeminiAudioParseProvider } from "../../src/voice/geminiAudioParseProvider.js";
import { verifyAccessToken } from "./_shared/jwt.js";
import { checkRateLimit } from "./_shared/rateLimit.js";
import { runVoiceJob, V3_AUDIO_MODEL, V3_GEMINI_TIMEOUT_MS, type ClaimedRecording } from "./_shared/voiceRun.js";

// KB-384a step 3 (owner, 9 Nov 2026; D107): the async voice path's worker - a Netlify BACKGROUND function (the phone gets 202 at
// once; it may run up to 15 min, measured limit of a normal one: 30 s). The phone has already uploaded the audio to Supabase Storage
// and added the voice_recordings row; it POSTs {recordingId} here and then watches the row. The worker acts AS THE CALLER (their
// token, every RLS policy) - no service-role key in Netlify. It stores Gemini's raw answer; the phone builds the bill (our checks,
// fills and totals) from it. One path for every order, short or long.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req: Request, _context: Context): Promise<Response> => {
  const done = () => new Response(null, { status: 202 }); // a background function's answer is not seen by the caller anyway
  if (req.method !== "POST") return done();
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!supabaseUrl || !anonKey || !geminiKey) {
    console.warn("[voice-run] server misconfigured");
    return done();
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !(await verifyAccessToken(authHeader, supabaseUrl))) return done();
  let recordingId: unknown;
  try {
    recordingId = ((await req.json()) as { recordingId?: unknown }).recordingId;
  } catch {
    return done();
  }
  if (typeof recordingId !== "string" || !UUID.test(recordingId)) return done();

  const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const gemini = createGeminiAudioParseProvider(geminiKey, {
    model: process.env.GEMINI_AUDIO_MODEL || V3_AUDIO_MODEL,
    thinkingConfig: { thinkingLevel: "low" },
    systemPrompt: EZY_V3_PROMPT,
    timeoutMs: V3_GEMINI_TIMEOUT_MS,
  });

  await runVoiceJob(recordingId, {
    async claim(id) {
      const { data, error } = await db.rpc("claim_voice_recording", { p_recording_id: id });
      if (error) throw new Error("claim");
      const r = (data as { shop_id: string; path: string; mime: string; attempts: number }[])[0];
      return r ? ({ shopId: r.shop_id, path: r.path, mime: r.mime, attempts: r.attempts } satisfies ClaimedRecording) : null;
    },
    allowed: checkRateLimit,
    async download(path) {
      const { data, error } = await db.storage.from("recordings").download(path);
      if (error || !data) throw new Error("download");
      return data;
    },
    async parse(audio) {
      const r = await gemini.parseAudio(audio, { catalog: [] });
      return { transcript: r.transcript, items: r.items, usage: r.usage };
    },
    async finish(f) {
      const { data, error } = await db.rpc("finish_voice_recording", {
        p_recording_id: f.recordingId, p_attempt: f.attempt, p_status: f.status, p_transcript: f.transcript, p_items: f.items, p_usage: f.usage, p_model: gemini.name, p_error: f.error,
      });
      if (error) throw new Error("finish");
      return data === true;
    },
    log: (line) => console.warn(line),
  });
  return done();
};

export const config: Config = { background: true, path: "/voice-run" };
