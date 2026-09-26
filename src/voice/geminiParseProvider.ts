import type { ParseProvider, TokenUsage } from "@/voice/parseProvider";
import type { ParsedItem, MatchStatus, PriceType } from "@/domain/grammar";
import { PRICING_GRAMMAR_PROMPT } from "@/voice/pricingGrammarPrompt";

// gemini-2.5-flash-lite, confirmed live and current (docs/11-STACK-DECISIONS.md
// SD-006 warned its retirement date and successor pricing needed real
// verification, not an assumed model string). Checked against the real
// ai.google.dev pricing page: 2.5-flash-lite is NOT deprecated and remains
// the cheapest flash-lite variant ($0.10/$0.40 per 1M tokens vs 3.1's
// $0.25/$1.50 and 3.5's $0.30/$2.50) - the newer generations exist but are
// materially more expensive, and 04-VOICE-PIPELINE.md section 9's whole
// cost-model/moat argument was computed against 2.5's pricing. Using a
// newer model here would silently invalidate that cost model - out of
// scope for this ticket to redo.
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500; // inferred, not doc-specified - flagged in the ticket handoff

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      spokenName: { type: "string" },
      catalogId: { type: "string", nullable: true },
      qty: { type: "number", nullable: true },
      unit: { type: "string" },
      rate: { type: "integer", nullable: true },
      total: { type: "integer", nullable: true },
      priceType: { type: "string", enum: ["rate", "total", "default", "unknown"] },
    },
    required: ["spokenName", "catalogId", "qty", "unit", "rate", "total", "priceType"],
  },
};

interface GeminiRawItem {
  spokenName: string;
  catalogId: string | null;
  qty: number | null;
  unit: string;
  rate: number | null;
  total: number | null;
  priceType: PriceType;
}

function mapToParsedItem(raw: GeminiRawItem, catalogSlice: { id: string }[]): ParsedItem {
  const inSlice = raw.catalogId !== null && catalogSlice.some((c) => c.id === raw.catalogId);
  const catalogId = inSlice ? raw.catalogId : null;
  const matchStatus: MatchStatus = catalogId !== null ? "matched" : "none";
  return {
    spokenName: raw.spokenName,
    catalogId,
    isCustom: catalogId === null,
    matchStatus,
    qty: raw.qty,
    unit: raw.unit,
    rate: raw.rate,
    // KB-005f: Gemini returns no rate unit, so its own `unit` is taken as
    // the rate's unit - Gemini's CLAIM, not verified. For a spoken gm/ml
    // qty on a per-kg product the prompt multiplies the per-kg price by the
    // gram count (docs/12-PARKED.md KI-34): these rates and totals are
    // untrusted and must be recomputed client-side before KB-302 puts
    // Layer 2 output on a bill. They are HIGH-flagged by unusual_rate /
    // unusual_total meanwhile (reviewFlags.test.ts, KB-005f).
    rateUnit: raw.rate === null ? null : raw.unit,
    total: raw.total,
    priceType: raw.priceType,
  };
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeminiParseProvider(apiKey: string): ParseProvider {
  return {
    name: "gemini-flash-lite",
    async parse(transcript, opts) {
      const catalogSlice = opts.catalogSlice.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        unit: entry.unit,
        suggestedPricePaise: entry.suggestedPricePaise,
      }));
      const userContent = `Candidate products:\n${JSON.stringify(catalogSlice)}\n\nTranscript: ${transcript}`;

      const body = {
        systemInstruction: { parts: [{ text: PRICING_GRAMMAR_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      };

      const start = performance.now();
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const latencyMs = performance.now() - start;
          const data = (await response.json()) as {
            candidates: { content: { parts: { text: string }[] } }[];
            usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
          };
          const rawText = data.candidates[0]!.content.parts[0]!.text;
          const rawItems = JSON.parse(rawText) as GeminiRawItem[];
          const items = rawItems.map((raw) => mapToParsedItem(raw, catalogSlice));
          const usage: TokenUsage = {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
          };
          return { items, usage, latencyMs };
        }

        const bodyText = await response.text();
        lastError = new Error(`Gemini parse failed: ${response.status} ${bodyText}`);
        if (!isRetryable(response.status) || attempt === RETRY_ATTEMPTS - 1) {
          throw lastError;
        }
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }

      throw lastError;
    },
  };
}
