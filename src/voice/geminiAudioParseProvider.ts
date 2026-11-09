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

// KB-384a step 1 (owner, 9 Nov 2026; D107 item 6): the compact answer - short keys, no catalogId (V3 sends no catalog), priceType as one
// letter. "d" and "u" stay apart: "d" lets our code fill the shop price, "u" (a price said but not understood) never does.
const PRICE_TYPE = { r: "rate", t: "total", d: "default", u: "unknown" } as const;
type PriceLetter = keyof typeof PRICE_TYPE;
// A null quantity / rate / total is LEFT OUT of the answer (A63: 312 fewer tokens); left out = null.
export interface CompactItem { n: string; q?: number | null; u: string; r?: number | null; t?: number | null; p: PriceLetter }
export const COMPACT_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "string" }, q: { type: "number", nullable: true }, u: { type: "string" }, r: { type: "integer", nullable: true }, t: { type: "integer", nullable: true }, p: { type: "string", enum: Object.keys(PRICE_TYPE) } },
        required: ["n", "u", "p"],
      },
    },
  },
  required: ["transcript", "items"],
};
export const expandCompactItem = (c: CompactItem): GeminiRawItem => ({ spokenName: c.n, catalogId: null, qty: c.q ?? null, unit: c.u, rate: c.r ?? null, total: c.t ?? null, priceType: PRICE_TYPE[c.p] });
export const toCompactItem = (raw: GeminiRawItem): CompactItem => ({
  n: raw.spokenName,
  ...(raw.qty === null ? {} : { q: raw.qty }),
  u: raw.unit,
  ...(raw.rate === null ? {} : { r: raw.rate }),
  ...(raw.total === null ? {} : { t: raw.total }),
  p: raw.priceType[0] as PriceLetter,
});

export interface GeminiAudioParseProvider {
  readonly name: string;
  parseAudio(audio: Blob, opts: { catalog: readonly CatalogEntry[] }): Promise<{ transcript: string; items: ParsedItem[]; usage: TokenUsage; latencyMs: number; thoughts: number | null }>;
}

/** KB-370 round 2: `systemPrompt` replaces the shipped prompt + addendum (the Ezy-style D102 prompt); `thinkingConfig` is sent as it is.
 * KB-384a: `compact` asks for the compact answer (COMPACT_SCHEMA) and expands it - the items returned are the same type either way. */
export function createGeminiAudioParseProvider(apiKey: string, options: { model?: string; timeoutMs?: number; systemPrompt?: string; thinkingConfig?: Readonly<Record<string, unknown>>; compact?: boolean } = {}): GeminiAudioParseProvider {
  const model = pinnedModel(options.model ?? DEFAULT_GEMINI_MODEL);
  const timeoutMs = options.timeoutMs ?? AUDIO_PARSE_BAKEOFF_TIMEOUT_MS;
  return {
    name: model,
    async parseAudio(audio, opts) {
      // The same four fields Layer 2 sends; there is no transcript to rank a slice from, so the whole catalog goes.
      const catalog = opts.catalog.map((e) => ({ id: e.id, displayName: e.displayName, unit: e.unit, suggestedPricePaise: e.suggestedPricePaise }));
      const body = {
        systemInstruction: { parts: [{ text: options.systemPrompt ?? `${PRICING_GRAMMAR_PROMPT}\n\n${AUDIO_PARSE_ADDENDUM}` }] },
        contents: [{ role: "user", parts: [{ text: `Candidate products:\n${JSON.stringify(catalog)}` }, { inlineData: await inlineAudio(audio) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: options.compact ? COMPACT_SCHEMA : SCHEMA, ...(options.thinkingConfig ? { thinkingConfig: options.thinkingConfig } : {}) },
      };
      const start = performance.now();
      return withDeadline(
        timeoutMs,
        async (signal) => {
          // D59: the key in a header, never in the URL an error or log may carry.
          const response = await fetch(geminiUrl(model), { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal });
          if (!response.ok) throw await failedAnswer("Gemini audio parse", response);
          const { text, usage, thoughts } = await answerOf(response);
          const parsed = JSON.parse(text) as { transcript: string; items: (GeminiRawItem | CompactItem)[] };
          const raws = options.compact ? (parsed.items as CompactItem[]).map(expandCompactItem) : (parsed.items as GeminiRawItem[]);
          return { transcript: parsed.transcript.trim(), items: raws.map((raw) => mapToParsedItem(raw, catalog)), usage, latencyMs: performance.now() - start, thoughts };
        },
        () => new ProviderError("timeout", `Gemini audio parse timed out after ${timeoutMs} ms`),
      );
    },
  };
}
