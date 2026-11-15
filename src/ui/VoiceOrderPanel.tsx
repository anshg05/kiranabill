import { useEffect, useState } from "react";
import { Loader2, Pause, Play, RotateCcw, Sparkles, Square, TriangleAlert } from "lucide-react";
import type { LocalVoiceRecording } from "@/data/db";
import { ORDER_RECORDING, useVoiceCapture } from "./useVoiceCapture";
import type { VoiceOrders } from "./useVoiceOrders";
import { useT } from "./useT";
import { HeardCard } from "./kit/HeardCard";
import { InfoBanner } from "./kit/Banner";
import { Icon, KB_ICONS } from "./kit/icons";

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
      <div className="flex w-full flex-col gap-2">
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
      <div className="flex w-full flex-col gap-2">
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
    <div className={`flex flex-col gap-2 ${hasLines && !nothing && !capture.error && !disabledReason ? "" : "w-full"}`}>
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
      {/* KB-413 step 1: on 12 "More" (secondary, the mic) sits beside Bill Banao; its name still says what it does. An empty bill:
          the full-width primary "Record order". The recording / listening states (09 / 10) are KB-413 step 2. */}
      <button
        type="button"
        onClick={start}
        aria-label={hasLines && !nothing ? t("order.recordMore") : undefined}
        disabled={!!disabledReason || capture.phase === "requesting"}
        className={
          hasLines && !nothing
            ? "font-kb kb-press kb-hit box-content flex min-h-[56px] items-center justify-center gap-2 rounded-[16px] border border-kb-border bg-kb-card px-[18px] text-kb-15 font-bold text-kb-ink disabled:opacity-50"
            : "font-kb kb-press kb-hit flex min-h-[56px] w-full items-center justify-center gap-[10px] rounded-[16px] bg-kb-primary text-kb-16 font-bold text-kb-card shadow-kb-primary disabled:opacity-50"
        }
      >
        {capture.phase === "requesting" ? <Loader2 {...icon} className="animate-spin" /> : <Icon icon={KB_ICONS.Mic} size={19} />}
        {nothing ? t("order.rerecord") : hasLines ? t("order.more") : t("order.record")}
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
  part,
}: {
  orders: Pick<VoiceOrders, "recordings" | "sending" | "offline" | "retry" | "remove">;
  /** Opens the add panel with these words (the transcript, or nothing). */
  onAddByHand?: (query: string) => void;
  /** KB-413: "heard" = the recordings already in the bill (their Heard cards, shown above the lines on 12); "pending" = the ones not
   *  in the bill yet (being read, queued offline, failed - shown under the lines, owner's answer 3). Both when not given. */
  part?: "heard" | "pending";
}) {
  const { t } = useT();
  const reading = orders.recordings.some((r) => orders.sending.has(r.recordingId));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [reading]);
  const shown = orders.recordings.filter((r) => (part === "heard" ? r.state === "appended" : part === "pending" ? r.state !== "appended" : true));
  if (shown.length === 0) return null;
  const entry = (r: LocalVoiceRecording) => {
    if (r.state === "appended") {
      const empty = (r.items ?? []).length === 0;
      return (
        <li key={r.recordingId} className="flex flex-col gap-2">
          <HeardCard label={t("heard.label")} text={`“${r.transcript ?? ""}”`} expandLabel={t("heard.more")} collapseLabel={t("heard.less")} />
          {empty && (
            <div className="font-kb flex flex-wrap items-center gap-2 rounded-[16px] border-[1.5px] border-kb-warn-border bg-kb-warn-bg py-[10px] px-[14px] text-kb-14 font-bold text-kb-warn-text">
              <Icon icon={KB_ICONS.TriangleAlert} size={17} />
              <span className="min-w-0 flex-1">{t("order.noItems")}</span>
              {onAddByHand && (
                <button type="button" onClick={() => onAddByHand(r.transcript ?? "")} className="kb-hit flex-none whitespace-nowrap min-h-[44px] rounded-[12px] border border-kb-border bg-kb-card px-3 text-kb-14 font-bold text-kb-ink">
                  {t("byhand.button")}
                </button>
              )}
            </div>
          )}
        </li>
      );
    }
    if (orders.sending.has(r.recordingId)) {
      const s = Math.max(0, Math.round((Date.now() - new Date(r.createdAt).getTime()) / 1000));
      return (
        <li key={r.recordingId}>
          <InfoBanner icon={KB_ICONS.Mic} title={t("order.reading", { s })} busy />
        </li>
      );
    }
    if (r.state === "queued") {
      // offline (24-Offline's banner); "Add by hand" meanwhile stays, as today
      return (
        <li key={r.recordingId} className="flex flex-col gap-2">
          <InfoBanner icon={KB_ICONS.Cloud} title={t("order.queued")} busy />
          {onAddByHand && (
            <button type="button" onClick={() => onAddByHand("")} className="kb-hit self-start whitespace-nowrap min-h-[44px] rounded-[12px] border border-kb-border bg-kb-card px-3 text-kb-14 font-bold text-kb-ink">
              {t("byhand.button")}
            </button>
          )}
        </li>
      );
    }
    // failed: Retry (the SAME recording) / Add by hand / Remove as a text button (owner, 15 Nov 2026, answer 3)
    return (
      <li key={r.recordingId} data-severity="HIGH" className="font-kb flex flex-col gap-[10px] rounded-[16px] border-[1.5px] border-kb-warn-border bg-kb-warn-bg py-3 px-[14px]">
        <div className="flex items-center gap-[6px] text-kb-14 font-bold text-kb-warn-text">
          <Icon icon={KB_ICONS.TriangleAlert} size={17} />
          <span className="min-w-0">{t(FAILED_TEXT[r.reason ?? ""] ?? "order.couldntRead")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-pending-target onClick={() => void orders.retry(r.recordingId)} className="kb-hit kb-press flex-none whitespace-nowrap min-h-[48px] rounded-[12px] bg-kb-ink px-4 text-kb-15 font-bold text-kb-card">
            {t("retry.button")}
          </button>
          {onAddByHand && (
            <button type="button" onClick={() => onAddByHand("")} className="kb-hit flex-none whitespace-nowrap min-h-[48px] rounded-[12px] border border-kb-border bg-kb-card px-4 text-kb-15 font-bold text-kb-ink">
              {t("byhand.button")}
            </button>
          )}
          <button type="button" aria-label={t("order.remove")} onClick={() => void orders.remove(r.recordingId)} className="kb-hit flex-none whitespace-nowrap min-h-[48px] px-2 text-kb-15 font-bold text-kb-sub">
            {t("col.remove")}
          </button>
        </div>
      </li>
    );
  };
  return (
    <ul aria-label={t("order.list")} className="flex flex-col gap-[10px]">
      {shown.map(entry)}
    </ul>
  );
}
