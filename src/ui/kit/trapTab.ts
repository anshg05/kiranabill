import type { KeyboardEvent } from "react";

// KB-342 / KB-413: Tab stays inside an open sheet or full screen - from the last control to the first, Shift+Tab back.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function trapTab(e: KeyboardEvent<HTMLElement>, box: HTMLElement | null): void {
  if (e.key !== "Tab") return;
  const all = [...(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const first = all[0];
  const last = all[all.length - 1];
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
  else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
}
