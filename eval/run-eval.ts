/**
 * KB-004 eval harness. Loads eval/voice-cases.json, resolves every
 * catalog-backed expected item against the LIVE catalog (never a hardcoded
 * price - docs/12-PARKED.md KI-17: the predecessor's fixtures hardcoded
 * rate/total as rupee decimals, and drifted from the catalog silently -
 * e.g. VC001 expected Chini at rate 43 while the catalog had moved to 45),
 * and reports one line per case.
 *
 * No parser exists yet - domain/grammar.ts is KB-005, which comes after
 * this ticket in docs/10-TRACKER.md's canonical order. Every case below
 * reports status "skip" for that reason. This is deliberate: "all 25 cases
 * run and print" (docs/18-AGENT-CONTRACT.md section 8) is honoured
 * literally, without manufacturing fake pass/fail numbers from a stub
 * parser that would test nothing. KB-005/KB-005c wire a real parse
 * function in here and replace the skip branch with an actual comparison
 * against `expected`.
 *
 * eval/voice-cases.json schema (this ticket):
 *   - `catalogId` on each expectedItem is the ground truth for which
 *     catalog product the case expects - resolved by hand against
 *     src/domain/catalog.ts, not by fuzzy string matching (that's
 *     KB-005b's job, and doesn't exist yet). `null` marks the three cases
 *     that are deliberately unresolved/ambiguous (VC006 Ganesh Poha - not
 *     in the catalog under any name; VC015 Surf Excel - pack size
 *     ambiguous even though the product itself now resolves; VC016 Sabun -
 *     too generic to trust). Left exactly as authored; re-deciding those
 *     is KB-005b's match-confidence judgment, not this ticket's.
 *   - `rate`/`total` are omitted for `priceType: "default"` items - those
 *     are computed below from the catalog's current price, every run, so
 *     they can never silently go stale again.
 *   - `rate`/`total` that ARE present are integer paise (docs/07-DECISIONS
 *     D1: money is always integer paise), not the old rupee decimals.
 *   - `displayName` is a human-readable note only, never compared - the
 *     canonical name for each `catalogId` is read fresh from the catalog
 *     below, so a catalog rename (already happened once: VC003's
 *     "कनकी" is now "Kanki") can't desync the fixture.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { catalog, getCatalogEntryById } from "../src/domain/catalog.js";
import { lineTotalPaise, formatRupees, type Paise } from "../src/domain/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface FixtureExpectedItem {
  readonly displayName: string;
  readonly qty: number | null;
  readonly unit: string;
  readonly rate?: Paise | null;
  readonly total?: Paise | null;
  readonly priceType: "default" | "rate" | "total" | "unknown";
  readonly isCustom: boolean;
  readonly catalogId: string | null;
}

interface FixtureCase {
  readonly id: string;
  readonly utterance: string;
  readonly expectedTranscript: string;
  readonly expectedItems: readonly FixtureExpectedItem[];
  readonly notes: string;
}

interface ResolvedExpectedItem {
  readonly canonicalDisplayName: string;
  readonly qty: number | null;
  readonly unit: string;
  readonly ratePaise: Paise | null;
  readonly totalPaise: Paise | null;
  readonly catalogId: string | null;
}

type CaseStatus = "pass" | "warn" | "fail" | "skip";

interface CaseResult {
  readonly id: string;
  readonly utterance: string;
  readonly status: CaseStatus;
  readonly reason: string;
  readonly resolvedItems: readonly ResolvedExpectedItem[];
}

function loadCases(): readonly FixtureCase[] {
  const raw = readFileSync(path.join(__dirname, "voice-cases.json"), "utf8");
  return JSON.parse(raw) as FixtureCase[];
}

/**
 * Resolves one fixture item against the live catalog. Throws on a broken
 * `catalogId` - a wrong ground truth is worse than a missing one, and the
 * whole run should fail loudly rather than silently print garbage.
 */
function resolveExpectedItem(caseId: string, item: FixtureExpectedItem): ResolvedExpectedItem {
  if (item.catalogId === null) {
    return {
      canonicalDisplayName: item.displayName,
      qty: item.qty,
      unit: item.unit,
      ratePaise: item.rate ?? null,
      totalPaise: item.total ?? null,
      catalogId: null,
    };
  }

  const entry = getCatalogEntryById(item.catalogId);
  if (!entry) {
    throw new Error(
      `${caseId}: expectedItem references catalogId "${item.catalogId}", which does not exist in the catalog`,
    );
  }

  if (item.priceType === "default") {
    if (item.qty === null) {
      throw new Error(`${caseId}: priceType "default" but qty is null - cannot compute a total`);
    }
    const ratePaise = entry.suggestedPricePaise;
    return {
      canonicalDisplayName: entry.displayName,
      qty: item.qty,
      unit: item.unit,
      ratePaise,
      totalPaise: lineTotalPaise(item.qty, ratePaise),
      catalogId: item.catalogId,
    };
  }

  return {
    canonicalDisplayName: entry.displayName,
    qty: item.qty,
    unit: item.unit,
    ratePaise: item.rate ?? null,
    totalPaise: item.total ?? null,
    catalogId: item.catalogId,
  };
}

function evaluateCase(fixtureCase: FixtureCase): CaseResult {
  const resolvedItems = fixtureCase.expectedItems.map((item) => resolveExpectedItem(fixtureCase.id, item));

  // No parser exists yet (KB-005). Every case is a deliberate skip - see
  // the file header. KB-005/KB-005c replace this branch with a real
  // comparison against `resolvedItems`.
  return {
    id: fixtureCase.id,
    utterance: fixtureCase.utterance,
    status: "skip",
    reason: "no parser wired - KB-005",
    resolvedItems,
  };
}

function formatItem(item: ResolvedExpectedItem): string {
  const price =
    item.totalPaise === null
      ? "total=?"
      : `total=${formatRupees(item.totalPaise)}${item.ratePaise === null ? "" : ` (rate ${formatRupees(item.ratePaise)})`}`;
  const qty = item.qty === null ? "qty=?" : `qty=${item.qty}${item.unit ? ` ${item.unit}` : ""}`;
  const id = item.catalogId === null ? "unresolved" : `#${item.catalogId}`;
  return `${item.canonicalDisplayName} (${id}) ${qty} ${price}`;
}

function main(): void {
  const cases = loadCases();
  console.log(`Eval harness - ${cases.length} cases loaded from voice-cases.json`);
  console.log(`Catalog: ${catalog.length} products\n`);

  const results = cases.map(evaluateCase);

  for (const result of results) {
    console.log(`[${result.status.toUpperCase().padEnd(4)}] ${result.id}  "${result.utterance}"`);
    console.log(`         ${result.reason}`);
    for (const item of result.resolvedItems) {
      console.log(`         - ${formatItem(item)}`);
    }
  }

  const tally = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const result of results) {
    tally[result.status] += 1;
  }

  console.log(
    `\n${tally.pass} pass / ${tally.warn} warn / ${tally.fail} fail / ${tally.skip} skip (of ${results.length})`,
  );
}

main();
