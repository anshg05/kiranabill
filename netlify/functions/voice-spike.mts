import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { EZY_V3_PROMPT } from "../../src/voice/audioPrompts";
import { createGeminiAudioParseProvider } from "../../src/voice/geminiAudioParseProvider";

// KB-384 TIME-LIMIT SPIKE (owner, 9 Nov 2026) - TEMPORARY: measures, on a draft, (1) the longest a Netlify function may run (?sleep=N) and
// (2) how long gemini-3.8-flash takes on the owner's 3-4 minute recording through a real function. It does not exist (404) unless the draft's
// KB384_SPIKE_KEY is set AND the caller sends it - never an open Gemini proxy. Deleted before the V3 release (KB-384's PLAN).

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function keyMatches(req: Request): boolean {
  const want = process.env.KB384_SPIKE_KEY ?? "";
  const got = req.headers.get("x-spike-key") ?? "";
  if (want.length < 12 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async (req: Request): Promise<Response> => {
  if (!keyMatches(req)) return new Response("Not found", { status: 404 });
  const started = performance.now();
  const sleep = new URL(req.url).searchParams.get("sleep");
  if (sleep !== null) {
    const seconds = Math.min(Math.max(Number(sleep) || 0, 0), 900);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    return json({ slept: seconds, totalMs: Math.round(performance.now() - started) });
  }
  if (req.method !== "POST") return json({ error: "POST a recording, or GET ?sleep=N" }, 405);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "Server misconfigured" }, 500);
  const bytes = await req.arrayBuffer();
  const audio = new Blob([bytes], { type: req.headers.get("content-type") ?? "audio/mp4" });
  const r = await createGeminiAudioParseProvider(apiKey, { model: "gemini-3.8-flash", systemPrompt: EZY_V3_PROMPT, thinkingConfig: { thinkingLevel: "low" }, timeoutMs: 600_000 }).parseAudio(audio, { catalog: [] });
  return json({ bytes: bytes.byteLength, geminiMs: Math.round(r.latencyMs), totalMs: Math.round(performance.now() - started), usage: r.usage, transcript: r.transcript, items: r.items });
};

export const config: Config = { path: "/voice-spike" };
