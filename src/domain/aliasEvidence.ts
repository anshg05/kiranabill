// KB-323 (docs/07-DECISIONS.md D81): a learned alias is a conclusion drawn from evidence, not a stored number.
// The evidence is the append-only learning events; the confidence of an alias is a SUM over them, so it does not
// depend on which device saw what first (deltas commute, D74 section 5 is discharged), a device that joins late
// computes the same answer, and a cancelled bill's lessons are simply left out (NI-50). Pure: no storage, no clock.

/** Integer hundredths throughout - a float sum would differ by order (0.1 + 0.2 + 0.2 vs 0.2 + 0.2 + 0.1). */
const BASE = 30;
const FAST = 20;
const GEMINI = 10;
const CORRECTION = 40; // KB-336: the shopkeeper changed the product himself - one alone (0.7) never promotes
const SUPPRESS = 20;
const REMOVE = 100;
const PROMOTE = 80;
// KB-354: what Gemini evidence ALONE can reach. Promotion needs one confirmation that is not a Gemini guess.
const GEMINI_ONLY_CAP = 70;
const RETIRE = 30;

/** The single-device rule, unchanged: first confirmation 0.5 (= base + 0.2), then +0.2 each. */
export const ALIAS_BASE = BASE / 100;
export const PROMOTE_AT = PROMOTE / 100;
export const RETIRE_AT = RETIRE / 100;

export interface AliasEvent {
  readonly localId: string;
  readonly eventType: "alias_confirmed" | "alias_suppressed" | "alias_removed";
  readonly alias: string;
  readonly shopProductId: string;
  /** Where the line came from: fastpath, manual, gemini or correction (KB-336). Anything else (or none) is treated as Gemini - the cautious side. */
  readonly sourceLayer: string | null;
  readonly createdAt: string;
  /** The bill that taught this was cancelled afterwards: it counts for nothing, in either direction. */
  readonly cancelled: boolean;
}

export interface DerivedAlias {
  readonly aliasKey: string;
  /** The spelling of the newest event. */
  readonly alias: string;
  /** The winning product - one alias maps to one product per shop. */
  readonly catalogId: string;
  readonly confidence: number;
  /** Above the retirement threshold (a retired alias is kept as evidence, never deleted - deletes do not sync, NI-27). */
  readonly active: boolean;
  /** Other products this phrase was also confirmed for (active ones only) - never used by the parser. */
  readonly losers: readonly { readonly catalogId: string; readonly confidence: number }[];
}

export interface LearnedMap {
  readonly [aliasKey: string]: { readonly alias: string; readonly catalogId: string; readonly confidence: number };
}

export const aliasKeyOf = (text: string): string => text.trim().toLowerCase();

/** A confirmation a person or the parser's own match stands behind: fast-path, manual, or a KB-336 correction. Unknown = Gemini. */
const isFirmConfirmation = (e: AliasEvent): boolean => e.eventType === "alias_confirmed" && (e.sourceLayer === "fastpath" || e.sourceLayer === "manual" || e.sourceLayer === "correction");

const weightOf = (e: AliasEvent): number => {
  if (e.eventType === "alias_suppressed") return -SUPPRESS;
  if (e.eventType === "alias_removed") return -REMOVE;
  if (e.sourceLayer === "correction") return CORRECTION;
  return e.sourceLayer === "fastpath" || e.sourceLayer === "manual" ? FAST : GEMINI;
};

/** Newest first: by time, then id - so a tie never depends on the order events arrived in. */
const newerFirst = (a: AliasEvent, b: AliasEvent) => (a.createdAt === b.createdAt ? (a.localId < b.localId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);

export function deriveAliases(events: readonly AliasEvent[]): DerivedAlias[] {
  const byAlias = new Map<string, AliasEvent[]>();
  for (const e of events) {
    if (e.cancelled) continue;
    const key = aliasKeyOf(e.alias);
    byAlias.set(key, [...(byAlias.get(key) ?? []), e]);
  }
  const out: DerivedAlias[] = [];
  for (const [aliasKey, list] of byAlias) {
    list.sort(newerFirst);
    const perProduct = new Map<string, { sum: number; firm: boolean; newest: string; newestId: string }>();
    for (const e of list) {
      const cur = perProduct.get(e.shopProductId) ?? { sum: 0, firm: false, newest: e.createdAt, newestId: e.localId };
      cur.sum += weightOf(e);
      cur.firm ||= isFirmConfirmation(e);
      perProduct.set(e.shopProductId, cur);
    }
    // A product's confidence: base + the evidence, capped at 1 AFTER summing (KB-354: at 0.7 when no firm confirmation backs it). Winner: the highest, then the newest event.
    const scored = [...perProduct].map(([catalogId, v]) => ({ catalogId, raw: Math.min(BASE + v.sum, v.firm ? 100 : GEMINI_ONLY_CAP), newest: v.newest, newestId: v.newestId }));
    scored.sort((a, b) => b.raw - a.raw || (a.newest === b.newest ? (a.newestId < b.newestId ? 1 : -1) : a.newest < b.newest ? 1 : -1));
    const winner = scored[0]!;
    out.push({
      aliasKey,
      alias: list[0]!.alias,
      catalogId: winner.catalogId,
      confidence: Math.max(winner.raw, 0) / 100,
      active: winner.raw > RETIRE,
      losers: scored.slice(1).filter((s) => s.raw > RETIRE).map((s) => ({ catalogId: s.catalogId, confidence: s.raw / 100 })),
    });
  }
  return out.sort((a, b) => (a.aliasKey < b.aliasKey ? -1 : 1));
}

/** The aliases the parser may use: active and promoted (confidence >= 0.8). */
export function promotedAliases(derived: readonly DerivedAlias[]): DerivedAlias[] {
  return derived.filter((a) => a.active && a.confidence * 100 >= PROMOTE);
}

export function toLearnedMap(derived: readonly DerivedAlias[]): LearnedMap {
  return Object.fromEntries(promotedAliases(derived).map((a) => [a.aliasKey, { alias: a.alias, catalogId: a.catalogId, confidence: a.confidence }]));
}

/**
 * The first-use note (owner, 17 Oct 2026): a line the parser resolved through a learned alias says so, with a one-tap
 * "Not this", until the alias has been confirmed to confidence 1. Never blocks the bill. Null = nothing to say.
 */
export function learnedNoteFor(spokenName: string, catalogId: string | null, learned: LearnedMap): { alias: string; catalogId: string } | null {
  if (!catalogId) return null;
  const hit = learned[aliasKeyOf(spokenName)];
  if (!hit || hit.catalogId !== catalogId || hit.confidence >= 1) return null;
  return { alias: hit.alias, catalogId };
}
