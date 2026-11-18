import type { ParsedItem, MatchStatus, PriceType } from "@/domain/grammar";

// The item shape Gemini answers in, and how it becomes a ParsedItem - used by V3's audio call (geminiAudioParseProvider.ts).
// 18 Nov 2026 (owner + reviewer): the TEXT parse provider that lived here (createGeminiParseProvider - the old /voice path's Layer 2)
// was deleted with that path, together with its tests (geminiParseProvider / geminiProviderKb360 / geminiQuota); only this is left.

/** V3's audio call answers in this shape (geminiAudioParseProvider.ts). */
export const RESPONSE_SCHEMA = {
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

export interface GeminiRawItem {
  spokenName: string;
  catalogId: string | null;
  qty: number | null;
  unit: string;
  rate: number | null;
  total: number | null;
  priceType: PriceType;
}

export function mapToParsedItem(raw: GeminiRawItem, catalogSlice: { id: string }[]): ParsedItem {
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
