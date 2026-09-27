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
  /** LocalBillItem.source: "fastpath" = Layer 1, "voice" = Layer 2. */
  readonly source: "fastpath" | "voice";
}

export interface ResolvedUtterance {
  readonly layer: "fastpath" | "voice";
  readonly lines: readonly BillLine[];
  /** itemIndex is relative to `lines`; the screen re-bases it onto the bill. */
  readonly flags: readonly ReviewFlag[];
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
  const fast = parseUtterance(transcript, deps.shop);
  if (fast) {
    const flags = evaluateReviewFlags(transcript, fast, deps.shop.entries);
    const hit =
      fast.every((item) => item.catalogId !== null) &&
      !flags.some((f) => f.severity === "HIGH" && NUMBER_CODES.has(f.code));
    if (hit) {
      return {
        layer: "fastpath",
        lines: fast.map((item) => ({ item, displayName: item.spokenName, source: "fastpath" })),
        flags,
      };
    }
  }

  // Layer 2 (owner Q1: the transcript, not the audio), settled (Q5 / KI-34),
  // then Layer 3 plus the ordered number alignment (Q7 / NI-26).
  const proposed = await deps.parse(transcript, buildCatalogSlice(deps.shop, transcript));
  const settled = settleLayer2Items(proposed, deps.shop);
  const items = settled.lines.map((l) => l.item);
  const misaligned = checkLayer2NumberOrder(transcript, items);
  return {
    layer: "voice",
    lines: settled.lines.map((l) => ({ ...l, source: "voice" })),
    flags: [...evaluateReviewFlags(transcript, items, deps.shop.entries), ...settled.flags, ...(misaligned ? [misaligned] : [])],
  };
}
