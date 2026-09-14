/**
 * KB-005c - the CLI harness. Phase 0 has no visible output for three weeks
 * (docs/15-BUILD-GUIDE.md section 7) - this is the mitigation, and the
 * fastest debugging tool in the project going forward. Also the exact demo
 * for the differentiator: "...ka" and "...wala" on identical phrasing must
 * produce different totals.
 *
 *   npm run try "chawal 5 kilo tees ka"
 *   npm run try "chawal 5 kilo tees wala"
 *
 * "Fast path" HIT/MISS is just parseUtterance() returning non-null vs.
 * null - there is no Layer 2 fallback in Phase 0 to actually reach, so a
 * MISS just means this utterance isn't handled deterministically yet.
 * Elapsed time is the real parseUtterance() call, not illustrative - real
 * numbers here are what KB-009's coverage probe will need to talk about
 * actual fast-path latency.
 */

import { parseUtterance, type ParsedItem } from "../src/domain/grammar.js";
import { getCatalogEntryById } from "../src/domain/catalog.js";
import { formatRupees } from "../src/domain/money.js";

function formatItem(item: ParsedItem): string {
  const name = item.catalogId ? getCatalogEntryById(item.catalogId)!.displayName : item.spokenName;
  const qty = item.qty === null ? "qty —" : `${item.qty} ${item.unit}`.trim();
  const rate = item.rate === null ? "rate —" : `rate ${formatRupees(item.rate)}`;
  const total = item.total === null ? "total —" : `total ${formatRupees(item.total)}`;
  // matchStatus "matched" is the common case and needs no callout; a KI-20
  // tie or an unresolved product is exactly the thing worth surfacing here.
  const statusTag = item.matchStatus === "matched" ? "" : ` (${item.matchStatus})`;
  return `  ${name}    ${qty}    ${rate}    ${total}    [${item.priceType}]${statusTag}`;
}

function main(): void {
  const text = process.argv.slice(2).join(" ").trim();
  if (!text) {
    console.error('Usage: npm run try "<utterance>"');
    process.exitCode = 1;
    return;
  }

  const start = performance.now();
  const items = parseUtterance(text);
  const elapsedMs = performance.now() - start;

  if (items === null) {
    console.log("  (bailed out - structurally ambiguous, no deterministic parse)");
    console.log(`  fast path: MISS (${elapsedMs.toFixed(2)}ms)`);
    return;
  }

  for (const item of items) {
    console.log(formatItem(item));
  }
  console.log(`  fast path: HIT (${elapsedMs.toFixed(2)}ms)`);
}

main();
