import type { CatalogEntry } from "@/domain/catalog";
import { buildCatalogSlice, type ParserCatalog } from "@/domain/catalogIndex";
import { parseUtterance, type ParsedItem } from "@/domain/grammar";
import { settleLayer2Items } from "@/domain/layer2";
import { checkLayer2NumberOrder, evaluateReviewFlags, type ReviewCode, type ReviewFlag } from "@/domain/reviewFlags";

// KB-302: steps 3-6 of the one-turn flow (16-APP-FLOW.md section 3;
// 02-ARCHITECTURE.md section 5): Layer 1 on the transcript first, Layer 2 only
// on a miss, then Layer 3 on whatever lands. The Layer 2 call is injected
// (data/voiceApi.ts parseTranscript in the app, a fake in tests).

export interface BillLine {
  readonly item: ParsedItem;
  /** What the bill shows - the shop entry's name for a matched Layer 2 line (Q5b). */
  readonly displayName: string;
  /** LocalBillItem.source: "fastpath" = Layer 1, "voice" = Layer 2, "manual" = added by hand (KB-305). */
  readonly source: "fastpath" | "voice" | "manual";
}

export interface ResolvedUtterance {
  readonly layer: "fastpath" | "voice";
  readonly lines: readonly BillLine[];
  /** itemIndex is relative to `lines`; the screen re-bases it onto the bill. */
  readonly flags: readonly ReviewFlag[];
  /** KB-317: per-stage timings for the dev [voice] log. layer2Ms is null when
   * Layer 1 hit and Gemini was never called. */
  readonly timings: { readonly layer1Ms: number; readonly layer2Ms: number | null };
}

export interface ResolveDeps {
  /** THIS shop's catalog (data/shopCatalog.ts) - never the seed (Q2). */
  readonly shop: ParserCatalog;
  readonly parse: (transcript: string, catalogSlice: readonly CatalogEntry[]) => Promise<ParsedItem[]>;
}

const NUMBER_CODES = new Set<ReviewCode>(["number_dropped", "qty_dropped", "number_unconsumed"]);

export async function resolveUtterance(transcript: string, deps: ResolveDeps): Promise<ResolvedUtterance> {
  // Layer 1. Owner Q3: a HIT only if it parsed, every line matched a product
  // in the shop's catalog, and no HIGH number flag fired. Otherwise Layer 1's
  // answer is discarded, never shown: a comma order it merged into one line,
  // or a garbled transcript it turned into one "unknown product", goes to
  // Layer 2 instead.
  const layer1Start = performance.now();
  const fast = parseUtterance(transcript, deps.shop);
  const layer1Ms = performance.now() - layer1Start;
  if (fast) {
    const flags = evaluateReviewFlags(transcript, fast, deps.shop.entries);
    const hit =
      fast.every((item) => item.catalogId !== null) &&
      !flags.some((f) => f.severity === "HIGH" && NUMBER_CODES.has(f.code));
    if (hit) {
      return {
        layer: "fastpath",
        // KB-317 (owner): the bill shows the shop's own name for the product,
        // never the spoken words ("चावल का" reached the bill).
        lines: fast.map((item) => ({ item, displayName: deps.shop.byId.get(item.catalogId!)?.displayName ?? item.spokenName, source: "fastpath" })),
        flags,
        timings: { layer1Ms, layer2Ms: null },
      };
    }
  }

  // Layer 2 (owner Q1: the transcript, not the audio), settled (Q5 / KI-34),
  // then Layer 3 plus the ordered number alignment (Q7 / NI-26).
  const layer2Start = performance.now();
  const proposed = await deps.parse(transcript, buildCatalogSlice(deps.shop, transcript));
  const layer2Ms = performance.now() - layer2Start;
  const settled = settleLayer2Items(proposed, deps.shop);

  // KB-317 commit 5 (owner): a line with no catalog match AND no qty, rate or
  // total is nothing the shopkeeper said - Whisper's silence hallucination
  // ("झाल") became four such lines. It is not added. A line with a number is
  // always kept (hard rule 5 - never block on an unknown product).
  const kept = settled.lines.map((l) => !isEmptyLine(l.item));
  const lines = settled.lines.filter((_, i) => kept[i]);
  // Nothing left: no flags either - a HIGH number flag on a bill with no lines
  // ("कर दो" -> "दो") is noise; the screen says what happened instead.
  if (lines.length === 0) return { layer: "voice", lines: [], flags: [], timings: { layer1Ms, layer2Ms } };
  const newIndex = kept.reduce<number[]>((acc, k, i) => (acc.push(k ? (acc[i - 1] ?? -1) + 1 : (acc[i - 1] ?? -1)), acc), []);
  const settledFlags = settled.flags
    .filter((f) => f.itemIndex === null || kept[f.itemIndex])
    .map((f) => (f.itemIndex === null ? f : { ...f, itemIndex: newIndex[f.itemIndex]! }));

  const items = lines.map((l) => l.item);
  const misaligned = checkLayer2NumberOrder(transcript, items);
  return {
    layer: "voice",
    lines: lines.map((l) => ({ ...l, source: "voice" })),
    flags: [...evaluateReviewFlags(transcript, items, deps.shop.entries), ...settledFlags, ...(misaligned ? [misaligned] : [])],
    timings: { layer1Ms, layer2Ms },
  };
}

function isEmptyLine(item: ParsedItem): boolean {
  return item.catalogId === null && item.qty === null && item.rate === null && item.total === null;
}
