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
  candidates: { content: { parts: { text?: string; thought?: boolean }[] } }[];
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

/** The answer's text (the parts that are not thoughts) and its token counts. */
export async function answerOf(response: Response): Promise<{ text: string; usage: TokenUsage }> {
  const data = (await response.json()) as GeminiAnswer;
  const text = (data.candidates[0]?.content.parts ?? []).filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  const u = data.usageMetadata;
  return { text, usage: { promptTokens: u.promptTokenCount, completionTokens: u.candidatesTokenCount, totalTokens: u.totalTokenCount } };
}
