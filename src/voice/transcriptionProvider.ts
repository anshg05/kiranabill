// Verbatim from docs/02-ARCHITECTURE.md section 5. Every provider decision
// is a config change behind this interface, never a rewrite (SD-005).
export interface TranscriptionProvider {
  name: string;
  transcribe(
    audio: Blob,
    opts: {
      vocabulary?: string[]; // shop-scoped phrase biasing
      language?: string;
    },
  ): Promise<{ text: string; confidence?: number; latencyMs: number; /** KB-352: the provider's own region header, when it sends one. */ region?: string | null }>;
}
