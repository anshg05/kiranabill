import type { CatalogEntry } from "@/domain/catalog";
import { buildCatalogSlice, type ParserCatalog } from "@/domain/catalogIndex";
import { parseUtteranceParts, type ParsedItem } from "@/domain/grammar";
import { settleLayer2Items } from "@/domain/layer2";
import { checkLayer2AgainstSpoken } from "@/domain/layer2Check";
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
  /**
   * KB-358a: pieces of a long order nothing could read - each its own text (Retry / Add by hand). Layer 2 failed or answered
   * with nothing for them; the lines that WERE read are in `lines`. Empty when the whole utterance was read.
   */
  readonly unresolved: readonly string[];
  /** Why Layer 2 did not answer for `unresolved` (the error it threw); undefined when it answered with nothing. */
  readonly failure?: unknown;
}

export interface ResolveDeps {
  /** THIS shop's catalog (data/shopCatalog.ts) - never the seed (Q2). */
  readonly shop: ParserCatalog;
  readonly parse: (transcript: string, catalogSlice: readonly CatalogEntry[]) => Promise<ParsedItem[]>;
}

const NUMBER_CODES = new Set<ReviewCode>(["number_dropped", "qty_dropped", "number_unconsumed"]);

/**
 * KB-358b: a piece with a spoken quantity, unit, name AND an explicit RATE ("2 kg उडद मुगर 130 रुपए किलो", "... 130 wala") needs no
 * catalog product: exactly the spoken numbers. A bare total does not qualify - "5 किलो चावल 30 खाब" is a garbled word, not a new
 * product (RT28), and Layer 2 can still repair it.
 */
function isCompleteCustom(item: ParsedItem): boolean {
  return (
    item.catalogId === null &&
    item.matchStatus === "none" && // KB-360: NO product matched at all - an ambiguous match (two close products) is never a custom line
    item.spokenName.trim() !== "" &&
    item.qty !== null &&
    item.unit !== "" &&
    item.rate !== null &&
    item.total !== null &&
    item.total > 0 &&
    item.priceType === "rate"
  );
}

export async function resolveUtterance(transcript: string, deps: ResolveDeps): Promise<ResolvedUtterance> {
  // Layer 1, PIECE by piece (KB-358a). Owner Q3: a piece is a HIT only if it parsed, matched a product in the shop's catalog
  // (or, KB-358b, is a custom line with every number spoken), and no HIGH number flag fired for it. Anything else is discarded,
  // never shown: a garbled piece goes to Layer 2 - the pieces Layer 1 did read stay on the bill whatever Layer 2 does.
  const layer1Start = performance.now();
  const parts = parseUtteranceParts(transcript, deps.shop);
  let keep = parts.map((p) => p.item !== null && (p.item.catalogId !== null || isCompleteCustom(p.item)));
  let flags: readonly ReviewFlag[] = [];
  for (let guard = 0; guard <= parts.length; guard++) {
    const at = keep.flatMap((k, i) => (k ? [i] : []));
    if (at.length === 0) {
      flags = [];
      break;
    }
    // all pieces kept: the whole transcript, as always; a subset: only their words (the others' numbers are not "unconsumed")
    const spoken = at.length === parts.length ? transcript : at.map((i) => parts[i]!.text).join(", ");
    flags = evaluateReviewFlags(spoken, at.map((i) => parts[i]!.item!), deps.shop.entries);
    const bad = flags.filter((f) => f.severity === "HIGH" && NUMBER_CODES.has(f.code));
    if (bad.length === 0) break;
    if (bad.some((f) => f.itemIndex === null)) keep = keep.map(() => false);
    else for (const f of bad) keep[at[f.itemIndex!]!] = false;
  }
  if (keep.some(Boolean) && flags.length === 0) {
    // the loop ended on a drop that emptied the set, or a guard exit: recompute once for what is kept
    const at = keep.flatMap((k, i) => (k ? [i] : []));
    flags = evaluateReviewFlags(at.length === parts.length ? transcript : at.map((i) => parts[i]!.text).join(", "), at.map((i) => parts[i]!.item!), deps.shop.entries);
  }
  const layer1Ms = performance.now() - layer1Start;
  const fastLines: BillLine[] = parts.flatMap((p, i) =>
    keep[i] ? [{ item: p.item!, displayName: deps.shop.byId.get(p.item!.catalogId ?? "")?.displayName ?? p.item!.spokenName, source: "fastpath" as const }] : [],
  );
  const left = parts.filter((_, i) => !keep[i]);
  if (left.length === 0) return { layer: "fastpath", lines: fastLines, flags, timings: { layer1Ms, layer2Ms: null }, unresolved: [] };

  // Layer 2 (owner Q1: the transcript, not the audio), settled (Q5 / KI-34), then Layer 3 and the ordered number alignment (Q7 /
  // NI-26) - for the pieces Layer 1 could not read, TOGETHER in one call. An unsplit text goes exactly as it was spoken.
  const asked = parts.length === 1 ? transcript : left.map((p) => p.text).join(", ");
  const layer2Start = performance.now();
  let proposed: ParsedItem[];
  try {
    proposed = await deps.parse(asked, buildCatalogSlice(deps.shop, asked));
  } catch (failure) {
    if (parts.length === 1) throw failure; // nothing was split: the caller keeps the whole text, as before
    return { layer: fastLines.length > 0 ? "fastpath" : "voice", lines: fastLines, flags, timings: { layer1Ms, layer2Ms: performance.now() - layer2Start }, unresolved: left.map((p) => p.text), failure };
  }
  const layer2Ms = performance.now() - layer2Start;
  const settledRaw = settleLayer2Items(proposed, deps.shop);
  // KB-359: the AI's line against what Layer 1 could read of the same piece (a price it cannot back is dropped; a different one is flagged)
  const checked = checkLayer2AgainstSpoken(left, settledRaw.lines);
  const settled = { lines: checked.lines, flags: [...settledRaw.flags, ...checked.flags] };

  // KB-317 commit 5 (owner): a line with no catalog match AND no qty, rate or
  // total is nothing the shopkeeper said - Whisper's silence hallucination
  // ("झाल") became four such lines. It is not added. A line with a number is
  // always kept (hard rule 5 - never block on an unknown or unpriced product).
  const kept = settled.lines.map((l) => !isEmptyLine(l.item));
  const lines = settled.lines.filter((_, i) => kept[i]);
  // Nothing left: no flags either - a HIGH number flag on a bill with no lines
  // ("कर दो" -> "दो") is noise; the screen says what happened instead.
  if (lines.length === 0) {
    if (parts.length === 1) return { layer: "voice", lines: [], flags: [], timings: { layer1Ms, layer2Ms }, unresolved: [] };
    // split, and Layer 2 gave nothing for these pieces: each is listed (never silently dropped)
    return { layer: fastLines.length > 0 ? "fastpath" : "voice", lines: fastLines, flags, timings: { layer1Ms, layer2Ms }, unresolved: left.map((p) => p.text) };
  }
  const newIndex = kept.reduce<number[]>((acc, k, i) => (acc.push(k ? (acc[i - 1] ?? -1) + 1 : (acc[i - 1] ?? -1)), acc), []);
  const settledFlags = settled.flags
    .filter((f) => f.itemIndex === null || kept[f.itemIndex])
    .map((f) => (f.itemIndex === null ? f : { ...f, itemIndex: newIndex[f.itemIndex]! }));

  const items = lines.map((l) => l.item);
  const misaligned = checkLayer2NumberOrder(asked, items);
  const layer2Flags = [...evaluateReviewFlags(asked, items, deps.shop.entries), ...settledFlags, ...(misaligned ? [misaligned] : [])];
  const offset = fastLines.length; // the screen counts the Layer 1 lines first
  return {
    layer: "voice",
    lines: [...fastLines, ...lines.map((l): BillLine => ({ ...l, source: "voice" }))],
    flags: [...flags, ...layer2Flags.map((f) => (f.itemIndex === null ? f : { ...f, itemIndex: f.itemIndex + offset }))],
    timings: { layer1Ms, layer2Ms },
    unresolved: [],
  };
}

function isEmptyLine(item: ParsedItem): boolean {
  return item.catalogId === null && item.qty === null && item.rate === null && item.total === null;
}
