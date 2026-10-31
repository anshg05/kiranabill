import type { CatalogEntry } from "@/domain/catalog";
import type { ParsedItem } from "@/domain/grammar";
import type { TokenUsage } from "@/voice/parseProvider";
import { ProviderError, withDeadline } from "@/voice/deadline";
import { answerOf, failedAnswer, geminiUrl, inlineAudio, pinnedModel } from "@/voice/geminiAudio";
import { DEFAULT_GEMINI_MODEL } from "@/voice/geminiModel";
import { mapToParsedItem, RESPONSE_SCHEMA, type GeminiRawItem } from "@/voice/geminiParseProvider";
import { PRICING_GRAMMAR_PROMPT } from "@/voice/pricingGrammarPrompt";

// KB-370 (V1 bake-off, candidate C / C2): the RECORDING straight to an audio-capable Gemini model, which returns what it heard
// (transcript) AND the items in one call. NOT wired into /voice. The shipped grammar prompt is reused as it is; the addendum only says
// the input is audio and the items may use only numbers in the model's own transcript. The checks run on that transcript afterwards
// (eval/bakeoff) - which is why candidate D also asks a second ear (B) whether the numbers were really said.

export const AUDIO_PARSE_ADDENDUM = [
  "The input is a RECORDING of the order, not a transcript.",
  "First write `transcript`: exactly the words that were spoken, in the script they were spoken in (Hindi in Devanagari), nothing added, nothing corrected, nothing left out.",
  "Then write `items` from that transcript by every rule above. Use ONLY numbers that appear in your transcript; a number that was not said is null.",
].join("\n");

/** The bake-off's deadline; V3 sets the production one from the measured seconds. */
export const AUDIO_PARSE_BAKEOFF_TIMEOUT_MS = 45_000;

const SCHEMA = { type: "object", properties: { transcript: { type: "string" }, items: RESPONSE_SCHEMA }, required: ["transcript", "items"] };

export interface GeminiAudioParseProvider {
  readonly name: string;
  parseAudio(audio: Blob, opts: { catalog: readonly CatalogEntry[] }): Promise<{ transcript: string; items: ParsedItem[]; usage: TokenUsage; latencyMs: number }>;
}

export function createGeminiAudioParseProvider(apiKey: string, options: { model?: string; timeoutMs?: number } = {}): GeminiAudioParseProvider {
  const model = pinnedModel(options.model ?? DEFAULT_GEMINI_MODEL);
  const timeoutMs = options.timeoutMs ?? AUDIO_PARSE_BAKEOFF_TIMEOUT_MS;
  return {
    name: model,
    async parseAudio(audio, opts) {
      // The same four fields Layer 2 sends; there is no transcript to rank a slice from, so the whole catalog goes.
      const catalog = opts.catalog.map((e) => ({ id: e.id, displayName: e.displayName, unit: e.unit, suggestedPricePaise: e.suggestedPricePaise }));
      const body = {
        systemInstruction: { parts: [{ text: `${PRICING_GRAMMAR_PROMPT}\n\n${AUDIO_PARSE_ADDENDUM}` }] },
        contents: [{ role: "user", parts: [{ text: `Candidate products:\n${JSON.stringify(catalog)}` }, { inlineData: await inlineAudio(audio) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: SCHEMA },
      };
      const start = performance.now();
      return withDeadline(
        timeoutMs,
        async (signal) => {
          // D59: the key in a header, never in the URL an error or log may carry.
          const response = await fetch(geminiUrl(model), { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal });
          if (!response.ok) throw await failedAnswer("Gemini audio parse", response);
          const { text, usage } = await answerOf(response);
          const parsed = JSON.parse(text) as { transcript: string; items: GeminiRawItem[] };
          return { transcript: parsed.transcript.trim(), items: parsed.items.map((raw) => mapToParsedItem(raw, catalog)), usage, latencyMs: performance.now() - start };
        },
        () => new ProviderError("timeout", `Gemini audio parse timed out after ${timeoutMs} ms`),
      );
    },
  };
}
