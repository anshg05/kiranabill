/** After the next paint: two animation frames (what was just committed has been drawn). KB-404 times "on screen" with it. */
export function afterPaint(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(cb));
  else setTimeout(cb, 0);
}
