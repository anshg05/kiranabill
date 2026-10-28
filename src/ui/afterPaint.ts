/** After the next paint: two animation frames (what was just committed has been drawn). KB-404 times "on screen" with it. */
export function afterPaint(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(cb));
  else setTimeout(cb, 0);
}

/**
 * KB-352: `cb` once, after the next paint - or at the latest after `maxMs` (a hidden tab never paints; what follows a saved bill must
 * still run). Never both.
 */
export function afterPaintOrSoon(cb: () => void, maxMs = 1500): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    cb();
  };
  afterPaint(once);
  setTimeout(once, maxMs);
}
