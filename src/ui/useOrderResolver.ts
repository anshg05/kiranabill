import { useCallback } from "react";
import type { ParserCatalog } from "@/domain/catalogIndex";
import { extractSpokenNumbers } from "@/domain/grammar";
import { resolveUtterance, type ResolveDeps } from "@/data/voiceBilling";
import { VoiceApiError } from "@/data/voiceApi";
import { PARSE_FAILED, type BillLines } from "./useBillLines";
import { messageFor, NO_ITEM_FOUND, VoiceUserError } from "./useVoiceBilling";

// KB-319 (KI-57; owner, 2 Oct 2026): a transcript becomes bill lines here.
// When the parse fails for a reason a Retry can fix (5xx, 429, timeout,
// network), the utterance is kept on the bill as "Not added" - never lost,
// never a re-record. Retry re-runs the same resolve on the same text: Layer 1
// misses again, the same catalog gives the same slice, ONE text-only /voice
// call. A late answer can't add lines twice: voiceApi's deadline discards it,
// and the bill accepts a Retry's lines only while its entry is still listed.

/** The status line after a failed parse - the entry on the bill has the Retry. */
export const NOT_ADDED = "Couldn't read the items — Retry below";

const RETRYABLE = new Set<VoiceApiError["kind"]>(["server", "busy", "rate_limited", "timeout", "network"]);
const isRetryable = (err: unknown) => err instanceof VoiceApiError && RETRYABLE.has(err.kind);

export interface OrderResolver {
  /** A heard transcript -> lines on the bill. Throws a shopkeeper-facing error. */
  onTranscript: (transcript: string) => Promise<void>;
  /** Retry a not-added utterance (text only). */
  retry: (id: string) => void;
}

export interface UseOrderResolverOptions {
  /** THIS shop's catalog; null while it loads. */
  shop: ParserCatalog | null;
  bill: Pick<BillLines, "add" | "fail" | "retrying" | "retryFailed" | "notAdded">;
  parse: ResolveDeps["parse"];
}

export function useOrderResolver({ shop, bill, parse }: UseOrderResolverOptions): OrderResolver {
  const { add, fail, retrying, retryFailed, notAdded } = bill;

  const onTranscript = useCallback(
    async (transcript: string) => {
      if (!shop) throw new VoiceUserError("Couldn't hear that — try again");
      let resolved;
      try {
        resolved = await resolveUtterance(transcript, { shop, parse });
      } catch (err) {
        if (!isRetryable(err)) throw err;
        fail(transcript);
        throw new VoiceUserError(NOT_ADDED);
      }
      if (import.meta.env.DEV) {
        console.info("[voice] resolved", {
          layer: resolved.layer,
          layer1Ms: Number(resolved.timings.layer1Ms.toFixed(2)),
          geminiMs: resolved.timings.layer2Ms === null ? null : Math.round(resolved.timings.layer2Ms),
          lines: resolved.lines.map((l) => `${l.displayName} ${l.item.qty ?? "—"} ${l.item.unit} = ${l.item.total ?? "—"}`),
          flags: resolved.flags.map((f) => `${f.severity} ${f.code}`),
          numbersHeard: extractSpokenNumbers(transcript),
        });
      }
      // KB-317 commit 5: nothing usable in the transcript - it stays on screen, with this under it.
      if (resolved.lines.length === 0) throw new VoiceUserError(NO_ITEM_FOUND);
      add(resolved.lines, resolved.flags, transcript);
    },
    [add, fail, parse, shop],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = notAdded.find((n) => n.id === id);
      if (!entry || entry.retrying || !shop) return;
      retrying(id);
      void (async () => {
        try {
          const resolved = await resolveUtterance(entry.transcript, { shop, parse });
          if (resolved.lines.length === 0) retryFailed(id, NO_ITEM_FOUND);
          else add(resolved.lines, resolved.flags, entry.transcript, id);
        } catch (err) {
          retryFailed(id, isRetryable(err) ? PARSE_FAILED : messageFor(err));
        }
      })();
    },
    [add, notAdded, parse, retryFailed, retrying, shop],
  );

  return { onTranscript, retry };
}
