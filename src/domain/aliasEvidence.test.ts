import { describe, expect, it } from "vitest";
import {
  ALIAS_BASE,
  PROMOTE_AT,
  deriveAliases,
  learnedNoteFor,
  promotedAliases,
  type AliasEvent,
} from "./aliasEvidence";

// KB-323 (D81): a learned alias's confidence is DERIVED from the append-only events, never read from an absolute row -
// so two devices that learn the same phrase before pulling each other lose nothing (deltas commute), a device that joins
// late computes the same number, a cancelled bill teaches nothing, and a Gemini guess needs more evidence.

let n = 0;
const ev = (over: Partial<AliasEvent> & Pick<AliasEvent, "eventType">): AliasEvent => ({
  localId: `e${String(n++).padStart(4, "0")}`,
  alias: "pale ji",
  shopProductId: "parle-g",
  sourceLayer: "fastpath",
  createdAt: `2026-10-0${1 + (n % 9)}T10:00:00.000Z`,
  cancelled: false,
  ...over,
});
const confirm = (over: Partial<AliasEvent> = {}) => ev({ eventType: "alias_confirmed", ...over });
const suppress = (over: Partial<AliasEvent> = {}) => ev({ eventType: "alias_suppressed", ...over });
const remove = (over: Partial<AliasEvent> = {}) => ev({ eventType: "alias_removed", ...over });
const one = (events: AliasEvent[]) => deriveAliases(events).find((a) => a.aliasKey === "pale ji");

describe("deriveAliases - the same numbers the single-device rule gave", () => {
  it("first confirmation 0.5, then +0.2 each: promoted (>= 0.8) on the third", () => {
    expect(ALIAS_BASE).toBe(0.3);
    expect(one([confirm()])!.confidence).toBe(0.5);
    expect(one([confirm(), confirm()])!.confidence).toBe(0.7);
    const third = one([confirm(), confirm(), confirm()])!;
    expect(third.confidence).toBe(0.9);
    expect(third.confidence >= PROMOTE_AT).toBe(true);
  });
  it("capped at 1, the cap applied to the SUM so order never matters", () => {
    expect(one([confirm(), confirm(), confirm(), confirm(), confirm()])!.confidence).toBe(1);
  });
  it("a suppression is -0.2; at or below 0.3 the alias is no longer active (retired)", () => {
    const a = one([confirm(), confirm(), confirm(), suppress()])!;
    expect(a.confidence).toBe(0.7);
    expect(a.active).toBe(true);
    const gone = one([confirm(), suppress()])!;
    expect(gone.confidence).toBe(0.3);
    expect(gone.active).toBe(false);
  });
  it("a phrase heard once and never confirmed again is not promoted", () => {
    expect(promotedAliases(deriveAliases([confirm()]))).toEqual([]);
  });
});

describe("Gemini-sourced confirmations count +0.1 (owner, 17 Oct 2026)", () => {
  it("three Gemini confirmations are NOT promoted; five are", () => {
    const g = () => confirm({ sourceLayer: "gemini" });
    expect(promotedAliases(deriveAliases([g(), g(), g()]))).toEqual([]);
    expect(one([g(), g(), g(), g()])!.confidence).toBe(0.7);
    expect(promotedAliases(deriveAliases([g(), g(), g(), g(), g()])).map((a) => a.aliasKey)).toEqual(["pale ji"]);
  });
  it("a manual correction is as strong as a fast-path confirmation; an unknown source is treated as Gemini (the cautious side)", () => {
    expect(one([confirm({ sourceLayer: "manual" })])!.confidence).toBe(0.5);
    expect(one([confirm({ sourceLayer: "something-new" })])!.confidence).toBe(0.4);
    expect(one([confirm({ sourceLayer: null })])!.confidence).toBe(0.4);
  });
});

describe("a correction counts +0.4 (owner, 17 Oct 2026, KB-336)", () => {
  const corr = (over: Partial<AliasEvent> = {}) => confirm({ sourceLayer: "correction", ...over });
  it("one correction alone gives 0.7 and NEVER promotes", () => {
    expect(one([corr()])!.confidence).toBe(0.7);
    expect(promotedAliases(deriveAliases([corr()]))).toEqual([]);
  });
  it("a correction plus one clean confirmation, or two corrections, promote", () => {
    expect(promotedAliases(deriveAliases([corr(), confirm()]))).toHaveLength(1);
    expect(promotedAliases(deriveAliases([corr(), corr()]))).toHaveLength(1);
  });
  it("a correction for another product moves the phrase only once it out-weighs the old evidence", () => {
    const rival = { shopProductId: "parle-g-big" };
    expect(one([confirm(), confirm(), confirm(), corr(rival)])!.catalogId).toBe("parle-g"); // 0.9 against 0.7
    expect(one([confirm(), corr(rival)])!.catalogId).toBe("parle-g-big"); // 0.5 against 0.7
  });
});

describe("a cancelled bill's lessons do not count (NI-50, owner 14 Oct 2026)", () => {
  it("events of a cancelled bill are ignored - both the confirmations and the suppressions", () => {
    const events = [confirm(), confirm(), confirm({ cancelled: true }), suppress({ cancelled: true })];
    expect(one(events)!.confidence).toBe(0.7);
    expect(promotedAliases(deriveAliases(events))).toEqual([]);
  });
  it("cancelling the bill that promoted an alias demotes it - the same events, one more flag", () => {
    const third = confirm();
    const base = [confirm(), confirm(), third];
    expect(promotedAliases(deriveAliases(base))).toHaveLength(1);
    expect(promotedAliases(deriveAliases([base[0]!, base[1]!, { ...third, cancelled: true }]))).toEqual([]);
  });
});

describe("Not this: alias_removed is -1.0 and survives later learning", () => {
  it("one removal retires a promoted alias at once", () => {
    const a = one([confirm(), confirm(), confirm(), remove()])!;
    expect(a.active).toBe(false);
    expect(promotedAliases(deriveAliases([confirm(), confirm(), confirm(), remove()]))).toEqual([]);
  });
  it("it takes real evidence to bring it back (not one lucky confirmation)", () => {
    const afterRemove = [confirm(), confirm(), confirm(), remove()];
    expect(promotedAliases(deriveAliases([...afterRemove, confirm()]))).toEqual([]);
    expect(promotedAliases(deriveAliases([...afterRemove, ...Array.from({ length: 8 }, () => confirm())]))).toHaveLength(1);
  });
});

describe("two devices, one phrase: events commute", () => {
  it("any order, and any split between 'device A' and 'device B', gives the identical result", () => {
    const events = [confirm(), confirm({ sourceLayer: "gemini" }), suppress(), confirm(), confirm({ cancelled: true }), confirm({ sourceLayer: "manual" })];
    const expected = JSON.stringify(deriveAliases(events));
    expect(JSON.stringify(deriveAliases([...events].reverse()))).toBe(expected);
    const a = events.filter((_, i) => i % 2 === 0);
    const b = events.filter((_, i) => i % 2 === 1);
    expect(JSON.stringify(deriveAliases([...b, ...a]))).toBe(expected);
  });
  it("a device that joins late (it has only the pulled events, in server order) computes the same confidence", () => {
    const events = Array.from({ length: 12 }, (_, i) => (i % 5 === 4 ? suppress() : confirm({ sourceLayer: i % 3 === 0 ? "gemini" : "fastpath" })));
    const early = deriveAliases(events);
    const late = deriveAliases([...events].sort((x, y) => (x.localId < y.localId ? 1 : -1)));
    expect(late).toEqual(early);
  });
  it("the alias key is case- and space-insensitive (the same key the learning rows use)", () => {
    const a = deriveAliases([confirm({ alias: "Pale Ji" }), confirm({ alias: "  pale ji " })]);
    expect(a).toHaveLength(1);
    expect(a[0]!.confidence).toBe(0.7);
  });
});

describe("conflict: one alias, one product per shop (08 section 4)", () => {
  const rival = (over: Partial<AliasEvent> = {}) => ({ shopProductId: "parle-g-big", ...over });
  it("the same phrase confirmed for two products: the one with the higher confidence wins, the other is kept as a loser", () => {
    const a = one([confirm(), confirm(), confirm(), confirm(rival())])!;
    expect(a.catalogId).toBe("parle-g");
    expect(a.losers).toEqual([{ catalogId: "parle-g-big", confidence: 0.5 }]);
  });
  it("a newer mapping with higher confidence wins - and the old product's evidence is NOT credited to it", () => {
    const a = one([confirm(), confirm(rival()), confirm(rival()), confirm(rival())])!;
    expect(a.catalogId).toBe("parle-g-big");
    expect(a.confidence).toBe(0.9);
  });
  it("a tie goes to the newest event, deterministically", () => {
    const older = confirm({ createdAt: "2026-10-01T10:00:00.000Z" });
    const newer = confirm(rival({ createdAt: "2026-10-05T10:00:00.000Z" }));
    expect(one([older, newer])!.catalogId).toBe("parle-g-big");
    expect(one([newer, older])!.catalogId).toBe("parle-g-big");
  });
  it("a removed mapping is not a conflict loser that can come back as the winner by default", () => {
    const a = one([confirm(), confirm(), confirm(), remove(), confirm(rival())])!;
    expect(a.catalogId).toBe("parle-g-big");
  });
  it("a removal of one product's mapping leaves the other product's evidence alone", () => {
    const a = one([confirm(), confirm(), confirm(), confirm(rival()), confirm(rival()), confirm(rival()), remove()])!;
    expect(a.catalogId).toBe("parle-g-big");
    expect(a.confidence).toBe(0.9);
  });
});

describe("learnedNoteFor - the first-use note", () => {
  const learned = { "pale ji": { alias: "pale ji", catalogId: "parle-g", confidence: 0.9 } };
  it("a line resolved by a promoted alias still below confidence 1 gets the note", () => {
    expect(learnedNoteFor("pale ji", "parle-g", learned)).toEqual({ alias: "pale ji", catalogId: "parle-g" });
    expect(learnedNoteFor("  Pale Ji ", "parle-g", learned)).not.toBeNull();
  });
  it("no note at confidence 1, for another product, for a phrase that is not learned, or for a line with no product", () => {
    expect(learnedNoteFor("pale ji", "parle-g", { "pale ji": { ...learned["pale ji"]!, confidence: 1 } })).toBeNull();
    expect(learnedNoteFor("pale ji", "tide", learned)).toBeNull();
    expect(learnedNoteFor("chini", "parle-g", learned)).toBeNull();
    expect(learnedNoteFor("pale ji", null, learned)).toBeNull();
  });
});
