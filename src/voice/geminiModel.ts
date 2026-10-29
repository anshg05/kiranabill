// KB-360 (owner, 29 Oct 2026): gemini-2.5-flash-lite is no longer offered to new Google projects, so the model is a Netlify variable
// (GEMINI_MODEL) and the NEXT change needs no code. The default is the model the owner picked after measuring (eval/layer2-models.ts).
//
// Only an EXACT, pinned model name is ever used. A "-latest" alias can change underneath a prompt that was tested on one model, and a
// malformed value must never reach a URL: both are ignored (the default is used) and the caller is told, so a typo shows up in the log.

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface ResolvedModel {
  readonly model: string;
  /** True when a value WAS given but refused (an alias, or not shaped like a model name). */
  readonly ignored: boolean;
}

const MODEL_SHAPE = /^[a-z0-9][a-z0-9.-]{2,59}$/;

export function resolveGeminiModel(raw: string | undefined): ResolvedModel {
  const given = raw?.trim() ?? "";
  if (given === "") return { model: DEFAULT_GEMINI_MODEL, ignored: false };
  if (/latest/i.test(given) || !MODEL_SHAPE.test(given)) return { model: DEFAULT_GEMINI_MODEL, ignored: true };
  return { model: given, ignored: false };
}
