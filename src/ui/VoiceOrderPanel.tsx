import { useEffect, useState } from "react";
import { Loader2, Mic, Pause, Play, RotateCcw, Sparkles, Square, Trash2, TriangleAlert } from "lucide-react";
import type { LocalVoiceRecording } from "@/data/db";
import { ORDER_RECORDING, useVoiceCapture } from "./useVoiceCapture";
import type { VoiceOrders } from "./useVoiceOrders";
import { useT } from "./useT";

// KB-385 step 5 (owner, 10 Nov 2026; D101, doc 25 §5 and §8): the V3 voice screens - ONE path for every order.
//   OrderRecorder (the bar): tap -> a timer of recorded time -> Pause / Resume -> Stop (or 5:00, warned at 4:30) -> listen -> Re-record or
//   Generate bill. "Add more by voice" inside a bill is the same flow; its lines are added to the end.
//   OrderEntries (under the lines): each recording of the bill - being read (the processing panel), queued offline, failed, or answered
//   with "Heard: …" (shown the moment it lands, so an ear mistake such as A47's ₹102 can be caught). Every state that is not a bill ends
//   in Retry (the SAME recording) or Add by hand; Remove takes a recording out (Bill Banao waits for the ones not in the bill).

const btn = "flex min-h-11 items-center justify-center gap-2 rounded-[6px] px-3 font-medium disabled:opacity-50";
const primary = `${btn} bg-indigo text-surface`;
const secondary = `${btn} border border-line bg-surface text-ink`;
const icon = { size: 20, strokeWidth: 1.5, "aria-hidden": true } as const;

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Take {
  readonly audio: Blob;
  readonly ms: number;
  readonly url: string;
  readonly stopped?: "limit" | "hidden";
}

export function OrderRecorder({
  hasLines,
  disabledReason,
  onGenerate,
  onAddByHand,
}: {
  hasLines: boolean;
  /** Why it cannot record yet (the catalog is loading, no live session) - shown, and the button is disabled. */
  disabledReason?: string | null;
  onGenerate: (audio: Blob, recordedMs: number) => void;
  onAddByHand: () => void;
}) {
  const { t, tx } = useT();
  const [take, setTake] = useState<Take | null>(null);
  const [nothing, setNothing] = useState(false);
  const keep = (audio: Blob | null, ms: number, stopped?: Take["stopped"]) => {
    if (!audio) return setNothing(true);
    setTake({ audio, ms, url: URL.createObjectURL(audio), ...(stopped ? { stopped } : {}) });
  };
  const capture = useVoiceCapture({ ...ORDER_RECORDING, onAutoStop: (audio, reason) => keep(audio, capture.elapsedMs, reason) });
  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);

  const start = () => {
    setTake(null);
    setNothing(false);
    void capture.start();
  };
  const stop = async () => keep(await capture.stop(), capture.elapsedMs);

  if (take) {
    return (
      <div className="flex flex-col gap-2">
        {take.stopped && <p className="text-[13px] text-ink-soft">{t(take.stopped === "limit" ? "order.stoppedLimit" : "order.stoppedHidden")}</p>}
        <audio controls src={take.url} aria-label={t("order.listen")} className="w-full" />
        <div className="flex gap-2">
          <button type="button" onClick={start} className={`${secondary} flex-1`}>
            <RotateCcw {...icon} />
            {t("order.rerecord")}
          </button>
          <button
            type="button"
            onClick={() => {
              onGenerate(take.audio, take.ms);
              setTake(null);
            }}
            className={`${primary} flex-1`}
          >
            <Sparkles {...icon} />
            {t("order.generate")}
          </button>
        </div>
      </div>
    );
  }

  if (capture.phase === "listening" || capture.phase === "paused" || capture.phase === "stopping") {
    const paused = capture.phase === "paused";
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-ink-soft">{paused ? t("order.paused") : null}</span>
          <span className={`font-semibold tabular-nums ${paused ? "" : "text-danger"}`}>{mmss(capture.elapsedMs)}</span>
        </div>
        {capture.elapsedMs >= ORDER_RECORDING.warnAtMs && <p className="text-[13px] text-danger">{t("order.warn")}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={paused ? capture.resume : capture.pause} className={`${secondary} flex-1`} disabled={capture.phase === "stopping"}>
            {paused ? <Play {...icon} /> : <Pause {...icon} />}
            {t(paused ? "order.resume" : "order.pause")}
          </button>
          <button type="button" onClick={() => void stop()} className={`${primary} flex-1 ${paused ? "" : "animate-pulse"}`} disabled={capture.phase === "stopping"}>
            <Square {...icon} />
            {t("mic.stop")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {(nothing || capture.error) && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-danger">
          <TriangleAlert size={16} strokeWidth={1.5} aria-hidden />
          <span>{nothing ? t("order.nothing") : tx(capture.error!.message)}</span>
          <button type="button" onClick={onAddByHand} className={`${secondary} ml-auto`}>
            {t("byhand.button")}
          </button>
        </div>
      )}
      {disabledReason && <p className="text-[13px] text-ink-soft">{tx(disabledReason)}</p>}
      <button type="button" onClick={start} disabled={!!disabledReason || capture.phase === "requesting"} className={`${primary} w-full`}>
        {capture.phase === "requesting" ? <Loader2 {...icon} className="animate-spin" /> : <Mic {...icon} />}
        {nothing ? t("order.rerecord") : t(hasLines ? "order.recordMore" : "order.record")}
      </button>
    </div>
  );
}

const FAILED_TEXT: Record<string, Parameters<ReturnType<typeof useT>["t"]>[0]> = {
  upload: "order.couldntSend",
  start: "order.couldntSend",
  session: "order.session",
  rate_limited: "order.limit",
};

export function OrderEntries({
  orders,
  onAddByHand,
}: {
  orders: Pick<VoiceOrders, "recordings" | "sending" | "offline" | "retry" | "remove">;
  /** Opens the add panel with these words (the transcript, or nothing). */
  onAddByHand?: (query: string) => void;
}) {
  const { t } = useT();
  const reading = orders.recordings.some((r) => orders.sending.has(r.recordingId));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [reading]);
  if (orders.recordings.length === 0) return null;

  const entry = (r: LocalVoiceRecording) => {
    if (r.state === "appended") {
      const empty = (r.items ?? []).length === 0;
      return (
        <li key={r.recordingId} className={`border-b border-line bg-surface px-4 py-1 text-[13px] ${empty ? "border-l-[3px] border-l-danger" : ""}`}>
          <span className="text-ink-soft">{t("flag.heard", { text: r.transcript ?? "" })}</span>
          {empty && (
            <span className="flex flex-wrap items-center gap-2 text-danger">
              <TriangleAlert size={16} strokeWidth={1.5} aria-hidden />
              {t("order.noItems")}
              {onAddByHand && (
                <button type="button" onClick={() => onAddByHand(r.transcript ?? "")} className={`${secondary} ml-auto`}>
                  {t("byhand.button")}
                </button>
              )}
            </span>
          )}
        </li>
      );
    }
    if (orders.sending.has(r.recordingId)) {
      const s = Math.max(0, Math.round((Date.now() - new Date(r.createdAt).getTime()) / 1000));
      return (
        <li key={r.recordingId} className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[13px] text-ink">
          <Loader2 size={16} strokeWidth={1.5} aria-hidden className="animate-spin" />
          {t("order.reading", { s })}
        </li>
      );
    }
    const text = r.state === "queued" ? t("order.queued") : t(FAILED_TEXT[r.reason ?? ""] ?? "order.couldntRead");
    const failed = r.state !== "queued";
    return (
      <li key={r.recordingId} data-severity={failed ? "HIGH" : undefined} className={`flex flex-wrap items-center gap-x-2 border-b border-line bg-surface px-4 py-1 text-[13px] ${failed ? "border-l-[3px] border-l-danger text-danger" : "text-ink"}`}>
        {failed && <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />}
        <span>{text}</span>
        <span className="ml-auto flex items-center gap-1">
          {failed && (
            <button type="button" data-pending-target onClick={() => void orders.retry(r.recordingId)} className="min-h-11 rounded-[6px] border border-danger bg-transparent px-3 font-medium text-danger">
              {t("retry.button")}
            </button>
          )}
          {onAddByHand && (
            <button type="button" onClick={() => onAddByHand("")} className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink">
              {t("byhand.button")}
            </button>
          )}
          <button type="button" aria-label={t("order.remove")} onClick={() => void orders.remove(r.recordingId)} className="flex min-h-11 min-w-11 items-center justify-center text-ink-soft">
            <Trash2 size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
      </li>
    );
  };

  return <ul aria-label={t("order.list")}>{orders.recordings.map(entry)}</ul>;
}
