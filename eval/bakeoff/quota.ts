// KB-370 (owner, 1 Nov 2026, from AI Studio): gemini-3.5-transcribe on Tier 1 allows 10 requests and 10,000 tokens a minute and 100 requests
// a day, reset at midnight Pacific (ai.google.dev/gemini-api/docs/rate-limits, 28 Oct 2026), per PROJECT - production shares it. The 1 Nov
// run's 429s were mostly the daily cap. The bake-off keeps a 10% margin a minute and stops at 90 a day, leaving production room.

export const LIMITS = { rpm: 10, tpm: 10_000, margin: 0.9 };
export const DAILY_STOP = 90;
const MINUTE = 60_000;

export interface Sent {
  readonly at: Date;
  readonly tokens: number;
}

/** 32 tokens a second of audio (docs/audio) plus the written answer (~8 tokens a second of speech, an estimate). */
export const transcribeTokens = (audioSeconds: number) => Math.ceil(audioSeconds * 32 + audioSeconds * 8);

/** How long to wait before a call of `tokens` keeps the rolling minute within 90% of 10 RPM and 10K TPM. */
export function waitMs(sent: readonly Sent[], now: Date, tokens: number): number {
  const maxCalls = Math.floor(LIMITS.rpm * LIMITS.margin);
  const maxTokens = LIMITS.tpm * LIMITS.margin;
  const window = sent.filter((s) => now.getTime() - s.at.getTime() < MINUTE).sort((a, b) => a.at.getTime() - b.at.getTime());
  for (let drop = 0; drop <= window.length; drop++) {
    const left = window.slice(drop);
    if (left.length + 1 <= maxCalls && left.reduce((a, s) => a + s.tokens, 0) + tokens <= maxTokens) {
      return drop === 0 ? 0 : window[drop - 1]!.at.getTime() + MINUTE + 1 - now.getTime();
    }
  }
  return MINUTE; // a single call larger than the minute's budget: wait a full minute and send it alone
}

/** The quota's day: the date at midnight Pacific. */
export const pacificDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
