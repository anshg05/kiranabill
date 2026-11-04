// KB-370 (V1 bake-off): what the two audio candidates share - the Gemini URL, a pinned model name, audio as inline base64,
// and a ProviderError from a failed answer. Not used by /voice; V3 wires in whichever candidate the owner picks.
import { ProviderError } from "@/voice/deadline";
import { resolveGeminiModel } from "@/voice/geminiModel";
import type { TokenUsage } from "@/voice/parseProvider";

export const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** An exact model name or a throw - a "-latest" alias can change underneath a measured result (geminiModel.ts). */
export function pinnedModel(model: string): string {
  const r = resolveGeminiModel(model);
  if (r.ignored) throw new Error(`"${model}" is not a pinned model name`);
  return r.model;
}

/** The recording as inline audio: the bare media type ("audio/webm;codecs=opus" -> "audio/webm") and base64 bytes. */
export async function inlineAudio(audio: Blob): Promise<{ mimeType: string; data: string }> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: (audio.type.split(";")[0] ?? "").trim() || "audio/webm", data: btoa(binary) };
}

/** A 429 / 503 is busy (a quota or Google overloaded); anything else is a plain failure. */
export async function failedAnswer(what: string, response: Response): Promise<ProviderError> {
  const body = await response.text();
  return new ProviderError(response.status === 429 || response.status === 503 ? "busy" : "failed", `${what} failed: ${response.status} ${body}`, response.status);
}

interface GeminiAnswer {
  candidates: { content: { parts: { text?: string; thought?: boolean; audioTranscription?: { text?: string; words?: { word?: string }[] } }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
}

/**
 * The answer's text and its BILLED token counts. Text: the parts that are not thoughts; gemini-3.5-transcribe answers with
 * parts[].audioTranscription instead - LIVE (the 1 Nov diagnostic call) its `.text`, in Google's REST example its `.words[]`.
 * KB-370's first run read "" from it.
 * Output tokens = total - prompt: thinking tokens are billed as output (docs/thinking) but are not in candidatesTokenCount.
 */
export async function answerOf(response: Response): Promise<{ text: string; usage: TokenUsage; thoughts: number }> {
  const data = (await response.json()) as GeminiAnswer;
  const parts = data.candidates[0]?.content.parts ?? [];
  const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  const transcribed = parts.map((p) => p.audioTranscription?.text ?? "").filter(Boolean).join(" ");
  const words = transcribed || parts.flatMap((p) => p.audioTranscription?.words ?? []).map((w) => w.word ?? "").filter(Boolean).join(" ");
  const u = data.usageMetadata;
  const prompt = u?.promptTokenCount ?? 0;
  const total = u?.totalTokenCount ?? 0;
  return { text: text || words, usage: { promptTokens: prompt, completionTokens: Math.max(0, total - prompt), totalTokens: total }, thoughts: u?.thoughtsTokenCount ?? 0 };
}
