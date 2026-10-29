import { useCallback } from "react";
import type { ParserCatalog } from "@/domain/catalogIndex";
import { extractSpokenNumbers } from "@/domain/grammar";
import { resolveUtterance, type ResolveDeps } from "@/data/voiceBilling";
import { VoiceApiError } from "@/data/voiceApi";
import { afterPaint } from "./afterPaint";
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

/** KB-358c / KB-360: the cause of a failed parse in words - always with a way on (Retry, or add by hand). The SAME text goes on the "Not added"
 * entry, the status line under the total and a failed Retry (one function, one message). */
export function parseFailureMessage(err: unknown): string {
  if (err instanceof VoiceApiError) {
    if (err.reason === "billing") return "AI reading has no credit — add by hand, and tell support";
    if (err.reason === "setup") return "AI reading isn't set up right — add by hand, and tell support";
    if (err.kind === "busy") return err.reason === "daily_limit" ? "Today's free reading limit is reached — add by hand, or try again tomorrow" : "Reading service is busy — Retry in a minute, or add by hand";
    if (err.kind === "timeout") return "Took too long — Retry, or add by hand";
  }
  return PARSE_FAILED;
}

/** The status line under the total: a plain failure points at the Retry below; a cause says itself. */
const statusFor = (message: string): string => (message === PARSE_FAILED ? NOT_ADDED : message);

export interface OrderResolver {
  /** A heard transcript -> lines on the bill. Throws a shopkeeper-facing error. */
  onTranscript: (transcript: string) => Promise<void>;
  /** Retry a not-added utterance (text only). */
  retry: (id: string) => void;
}

/**
 * KB-404 (D80): what one utterance came to - reported once, when its first attempt ends. `path` is the layer that produced
 * the lines, or "failed" when nothing reached the bill. A write-only sink: the bill is the same with or without a listener,
 * and a listener that throws changes nothing.
 */
export interface UtteranceReport {
  readonly path: "fastpath" | "voice" | "failed";
  readonly transcript: string;
  /** Transcript received -> the lines painted (two animation frames after they were added); null when none were. */
  readonly transcriptToItemsMs: number | null;
  readonly lines: readonly { name: string; qty: number | null; unit: string; rate: number | null; total: number | null }[];
}

export interface UseOrderResolverOptions {
  /** THIS shop's catalog; null while it loads. */
  shop: ParserCatalog | null;
  bill: Pick<BillLines, "add" | "fail" | "retrying" | "retryFailed" | "notAdded">;
  parse: ResolveDeps["parse"];
  /** KB-404: told once per utterance how it ended (see UtteranceReport). */
  onUtterance?: (report: UtteranceReport) => void;
}

export function useOrderResolver({ shop, bill, parse, onUtterance }: UseOrderResolverOptions): OrderResolver {
  const { add, fail, retrying, retryFailed, notAdded } = bill;

  const report = useCallback(
    (r: UtteranceReport) => {
      try {
        onUtterance?.(r);
      } catch (err) {
        console.warn("[metrics] utterance listener failed:", err instanceof Error ? err.name : "error"); // never touches the bill
      }
    },
    [onUtterance],
  );

  const onTranscript = useCallback(
    async (transcript: string) => {
      const started = performance.now();
      const failed = (): UtteranceReport => ({ path: "failed", transcript, transcriptToItemsMs: null, lines: [] });
      if (!shop) throw new VoiceUserError("Couldn't hear that — try again");
      let resolved;
      try {
        resolved = await resolveUtterance(transcript, { shop, parse });
      } catch (err) {
        report(failed());
        if (!isRetryable(err)) throw err;
        const message = parseFailureMessage(err);
        fail(transcript, message);
        throw new VoiceUserError(statusFor(message));
      }
      // KB-358a: what was read is on the bill; each piece nothing could read is its own "Not added" (own text, own Retry).
      if (resolved.unresolved.length > 0) {
        const retryable = resolved.failure === undefined || isRetryable(resolved.failure);
        if (!retryable && resolved.lines.length === 0) {
          report(failed());
          throw resolved.failure; // nothing read, nothing a Retry can fix: the screen shows its own message, nothing is listed (as before)
        }
        const message = retryable ? parseFailureMessage(resolved.failure) : messageFor(resolved.failure);
        if (resolved.lines.length > 0) {
          add(resolved.lines, resolved.flags, transcript);
          const lines = resolved.lines.map((l) => ({ name: l.displayName, qty: l.item.qty, unit: l.item.unit, rate: l.item.rate, total: l.item.total }));
          afterPaint(() => report({ path: resolved.layer, transcript, transcriptToItemsMs: Math.max(0, Math.round(performance.now() - started)), lines }));
        } else {
          report(failed());
        }
        for (const text of resolved.unresolved) fail(text, message);
        // KB-360: the status line under the total says the same as the entries - whether or not some lines were read
        throw new VoiceUserError(retryable ? statusFor(message) : message);
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
      if (resolved.lines.length === 0) {
        report(failed());
        throw new VoiceUserError(NO_ITEM_FOUND);
      }
      add(resolved.lines, resolved.flags, transcript);
      const lines = resolved.lines.map((l) => ({ name: l.displayName, qty: l.item.qty, unit: l.item.unit, rate: l.item.rate, total: l.item.total }));
      afterPaint(() => report({ path: resolved.layer, transcript, transcriptToItemsMs: Math.max(0, Math.round(performance.now() - started)), lines }));
    },
    [add, fail, parse, report, shop],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = notAdded.find((n) => n.id === id);
      if (!entry || entry.retrying || !shop) return;
      retrying(id);
      void (async () => {
        try {
          const resolved = await resolveUtterance(entry.transcript, { shop, parse });
          if (resolved.lines.length === 0) retryFailed(id, resolved.unresolved.length > 0 ? parseFailureMessage(resolved.failure) : NO_ITEM_FOUND);
          else add(resolved.lines, resolved.flags, entry.transcript, id);
        } catch (err) {
          retryFailed(id, isRetryable(err) ? parseFailureMessage(err) : messageFor(err));
        }
      })();
    },
    [add, notAdded, parse, retryFailed, retrying, shop],
  );

  return { onTranscript, retry };
}
