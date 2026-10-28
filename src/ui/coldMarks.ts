// KB-352: the milestones of the app's cold start, as ms since the page began (performance.now() is relative to the navigation start).
// js = the bundle has been parsed and its modules run; auth = the sign-in check is answered; db = this user's local database is open and the
// cached shop read; shop = the billing screen has its shop; catalog = the parser is built and the draft is read; mic = the mic is enabled.

export type ColdMark = "js" | "auth" | "db" | "shop" | "catalog" | "mic";
export const COLD_MARKS: readonly ColdMark[] = ["js", "auth", "db", "shop", "catalog", "mic"];

const marks = new Map<ColdMark, number>();

/** Marks a milestone - the FIRST time only. */
export function markCold(name: ColdMark): void {
  if (!marks.has(name)) marks.set(name, Math.max(0, Math.round(performance.now())));
}

export function coldPhases(): Partial<Record<ColdMark, number>> {
  return Object.fromEntries(marks);
}

export function resetColdMarks(): void {
  marks.clear();
}
