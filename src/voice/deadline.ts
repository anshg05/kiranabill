// KB-319 (KI-58, D50): every voice call has a deadline - on the server per
// provider attempt (Groq 8 s, Gemini 6 s), on the client per /voice call
// (transcribe 12 s, parse 8 s). All well inside Netlify's 60 s synchronous
// limit, so /voice returns a clean error instead of being killed.

/** A provider call that didn't succeed, by what /voice should answer:
 * timeout -> 504, busy (the provider's own 429) -> 503, failed -> 502. */
export class ProviderError extends Error {
  constructor(
    readonly kind: "timeout" | "busy" | "failed",
    message: string,
    /** D59: the provider's HTTP status, when it answered - for the log line. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Runs `run` with an AbortSignal; at `ms` the signal aborts and the call
 * rejects with `onTimeout()` - even if `run` ignores the signal, so a late
 * answer can never be used. `run` should include reading the body.
 */
export async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, onTimeout: () => Error): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(onTimeout()); // first, so the race settles as a timeout, not as the abort's error
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
