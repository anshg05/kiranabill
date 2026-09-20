import type { ParsedItem } from "@/domain/grammar";
import type { CatalogEntry } from "@/domain/catalog";

// Verbatim from docs/02-ARCHITECTURE.md section 5, aside from TokenUsage -
// no doc defines that shape yet; provider-agnostic field names chosen here
// (not Gemini's own usageMetadata naming) since Claude Haiku (SD-006's
// documented failover, deferred - see NI-25) would use different field
// names for the same concept.
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ParseProvider {
  name: string;
  parse(
    transcript: string,
    opts: {
      catalogSlice: CatalogEntry[];
    },
  ): Promise<{ items: ParsedItem[]; usage: TokenUsage; latencyMs: number }>;
}
