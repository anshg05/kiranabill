// KB-352: where /voice's own time went, as a standard Server-Timing header, plus the region it ran in. Numbers and plain names only.

export interface VoiceParts {
  /** The sign-in check (one query to the database). */
  auth: number;
  /** The per-shop rate limit. */
  limit: number;
  /** Reading the multipart upload. */
  form: number;
  /** Groq's own time (the transcription call). */
  groq?: number;
}

const PLAIN_NAME = /^[A-Za-z0-9._-]{1,40}$/;
const whole = (n: number | undefined): string | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : null);

export function serverTimingHeaders(
  parts: VoiceParts,
  enteredAt: number,
  now: number,
  env: Readonly<Record<string, string | undefined>>,
  groqRegion?: string | null,
): Record<string, string> {
  const entries: Array<[string, number | undefined]> = [["auth", parts.auth], ["limit", parts.limit], ["form", parts.form], ["groq", parts.groq], ["total", now - enteredAt]];
  const timing = entries.flatMap(([name, v]) => (whole(v) === null ? [] : [`${name};dur=${whole(v)}`])).join(", ");
  const region = env.AWS_REGION && PLAIN_NAME.test(env.AWS_REGION) ? env.AWS_REGION : "unknown";
  return {
    "Content-Type": "application/json",
    "Server-Timing": timing,
    "X-Kb-Region": region,
    ...(groqRegion && PLAIN_NAME.test(groqRegion) ? { "X-Kb-Groq-Region": groqRegion } : {}),
  };
}
