/** KB-352: runs `cb` when the browser is idle (at the latest after `timeoutMs`); returns a cancel. Without requestIdleCallback (Safari, jsdom) a short timer. */
export function whenIdle(cb: () => void, timeoutMs = 2000): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(() => cb(), { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 50);
  return () => clearTimeout(id);
}

/** The same as a promise: resolves at the next idle moment. */
export const idle = (timeoutMs?: number): Promise<void> => new Promise((resolve) => void whenIdle(resolve, timeoutMs));
