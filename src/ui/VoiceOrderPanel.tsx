import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SavedTake } from "@/data/recordingDraft";
import { Loader2 } from "lucide-react";
import type { LocalVoiceRecording } from "@/data/db";
import { ORDER_RECORDING, useVoiceCapture } from "./useVoiceCapture";
import { useMicLevel } from "./micLevel";
import { RecordOverlay, RecordingBody, ReviewBody, mmss } from "./RecordScreens";
import type { VoiceOrders } from "./useVoiceOrders";
import { useT } from "./useT";
import { HeardCard } from "./kit/HeardCard";
import { InfoBanner } from "./kit/Banner";
import { Icon, KB_ICONS } from "./kit/icons";

// KB-385 step 5 (owner, 10 Nov 2026; D101, doc 25 §5 and §8): the V3 voice screens - ONE path for every order.
//   OrderRecorder (the bar): tap -> 09 Recording, a timer of recorded time -> Pause / Resume -> Stop (or 5:00, warned at 4:30) -> 10 listen -> Re-record or
//   Generate bill. "Add more by voice" inside a bill is the same flow; its lines are added to the end.
//   OrderEntries (under the lines): each recording of the bill - being read (the processing panel), queued offline, failed, or answered
//   with "Heard: …" (shown the moment it lands, so an ear mistake such as A47's ₹102 can be caught). Every state that is not a bill ends
//   in Retry (the SAME recording) or Add by hand; Remove takes a recording out (Bill Banao waits for the ones not in the bill).

const icon = { size: 20, strokeWidth: 1.5, "aria-hidden": true } as const;

interface Take {
  readonly audio: Blob;
  readonly ms: number;
  readonly url: string;
  readonly stopped?: "limit" | "hidden";
  /** it is on the phone (10 says so only then) */
  readonly saved: boolean;
}

/** Where the stopped recording is kept on the phone (src/data/recordingDraft.ts; owner, 15 Nov 2026, answer 1). */
export interface TakeStore {
  load: () => Promise<SavedTake | null>;
  save: (take: SavedTake) => Promise<void>;
  clear: () => Promise<void>;
}

/** A one-line warning on the bill with "Add by hand" (No items found; Nothing recorded; the mic errors). */
function WarnRow({ text, onAddByHand }: { text: string; onAddByHand?: () => void }) {
  const { t } = useT();
  return (
    <div className="font-kb flex flex-wrap items-center gap-2 rounded-[16px] border-[1.5px] border-kb-warn-border bg-kb-warn-bg py-[10px] px-[14px] text-kb-14 font-bold text-kb-warn-text">
      <Icon icon={KB_ICONS.TriangleAlert} size={17} />
      <span className="min-w-0 flex-1">{text}</span>
      {onAddByHand && (
        <button type="button" onClick={onAddByHand} className="kb-hit flex-none whitespace-nowrap min-h-[44px] rounded-[12px] border border-kb-border bg-kb-card px-3 text-kb-14 font-bold text-kb-ink">
          {t("byhand.button")}
        </button>
      )}
    </div>
  );
}

/** What "Discard" then does: Back = just discard; Re-record / Type instead = discard, then that (owner, answer 5). */
type Asking = null | "back" | "rerecord" | "type";

export function OrderRecorder({
  hasLines,
  disabledReason,
  onGenerate,
  onAddByHand,
  takes,
  noteSlot,
}: {
  hasLines: boolean;
  /** Why it cannot record yet (the catalog is loading, no live session) - shown, and the button is disabled. */
  disabledReason?: string | null;
  onGenerate: (audio: Blob, recordedMs: number) => void;
  onAddByHand: () => void;
  /** the stopped recording kept on the phone (10 survives the app closing); without it nothing is saved and 10 does not claim it */
  takes?: TakeStore;
  /** where its warnings go: the bill's scrolling list (12) - never the bottom panel (step-2 fix 1). Here when not given. */
  noteSlot?: HTMLElement | null;
}) {
  const { t, tx } = useT();
  const [take, setTake] = useState<Take | null>(null);
  const [nothing, setNothing] = useState(false);
  const [asking, setAsking] = useState<Asking>(null);
  const takesRef = useRef(takes);
  takesRef.current = takes;
  const show = (audio: Blob, ms: number, saved: boolean, stopped?: Take["stopped"]) =>
    setTake({ audio, ms, url: URL.createObjectURL(audio), saved, ...(stopped ? { stopped } : {}) });
  // Stopped (Stop, 5:00, the app going to the background): saved on the phone first, then 10 - which says "saved" only if it is
  const keep = async (audio: Blob | null, ms: number, stopped?: Take["stopped"]) => {
    if (!audio) return setNothing(true);
    let saved = false;
    try {
      if (takesRef.current) {
        await takesRef.current.save({ audio, recordedMs: ms, ...(stopped ? { stopped } : {}) });
        saved = true;
      }
    } catch {
      // the phone refused the write (storage full): 10 still has the recording in memory, and does not claim it is saved
    }
    show(audio, ms, saved, stopped);
  };
  const capture = useVoiceCapture({ ...ORDER_RECORDING, onAutoStop: (audio, reason, ms) => void keep(audio, ms, reason) });
  const recording = capture.phase === "listening" || capture.phase === "paused" || capture.phase === "stopping";
  const scales = useMicLevel(capture.stream, capture.phase === "listening");
  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);
  // The app was closed on 10: back to 10 with the recording
  useEffect(() => {
    let live = true;
    void takesRef.current?.load().then((saved) => {
      if (live && saved) show(saved.audio, saved.recordedMs, true, saved.stopped);
    }).catch(() => {});
    return () => void (live = false);
  }, []);

  const start = () => {
    setTake(null);
    setNothing(false);
    void capture.start();
  };
  const stop = async () => keep(await capture.stop(), capture.elapsedMs);
  const forget = () => takesRef.current?.clear().catch(() => {}) ?? Promise.resolve();
  // Back on 09 / 10 (owner, answer 7) and Re-record / Type instead on 10 (answer 5): pause, then ask
  const ask = (kind: Exclude<Asking, null>) => {
    if (capture.phase === "listening") capture.pause();
    setAsking(kind);
  };
  const discard = async () => {
    const then = asking;
    setAsking(null);
    if (!take) {
      await capture.stop(); // the recording so far is thrown away - the shopkeeper said Discard
      capture.release();
      return;
    }
    await forget();
    if (then === "type") {
      setTake(null);
      onAddByHand();
    } else if (then === "rerecord") {
      // 10 stays up until the new recording has really started (D45), then 09
      setNothing(false);
      await capture.start();
      setTake(null);
    } else setTake(null);
  };
  const lostMs = take ? take.ms : capture.elapsedMs;

  const screens = (take || recording) && (
    <RecordOverlay
      screenKey={take ? "review" : "rec"}
      title={t(take ? "review.title" : "rec.title")}
      asking={asking !== null}
      lostLine={t("rec.discardLine", { time: mmss(lostMs) })}
      onAsk={() => ask("back")}
      onKeep={() => setAsking(null)}
      onDiscard={() => void discard()}
    >
      {take ? (
        <ReviewBody
          url={take.url}
          ms={take.ms}
          saved={take.saved}
          {...(take.stopped ? { stopped: take.stopped } : {})}
          onGenerate={() => {
            // the voice queue takes it over - and deletes the phone's saved copy in the same write (src/data/voiceQueue.ts)
            onGenerate(take.audio, take.ms);
            setTake(null);
          }}
          onRerecord={() => ask("rerecord")}
          onTypeInstead={() => ask("type")}
        />
      ) : (
        <RecordingBody
          elapsedMs={capture.elapsedMs}
          paused={capture.phase === "paused"}
          busy={capture.phase === "stopping"}
          scales={scales}
          onPause={capture.pause}
          onResume={capture.resume}
          onStop={() => void stop()}
        />
      )}
    </RecordOverlay>
  );

  // step-2 fix 1: nothing recorded, the mic errors and why it cannot record yet go in the bill's list (noteSlot), never the bottom panel
  const notes = (nothing || capture.error || disabledReason) && (
    <div className="flex flex-col gap-2">
      {(nothing || capture.error) && <WarnRow text={nothing ? t("order.nothing") : tx(capture.error!.message)} onAddByHand={onAddByHand} />}
      {disabledReason && <p className="font-kb text-kb-13 text-kb-sub">{tx(disabledReason)}</p>}
    </div>
  );

  return (
    <div className={`flex flex-col gap-2 ${hasLines ? "" : "w-full"}`}>
      {screens}
      {notes && (noteSlot ? createPortal(notes, noteSlot) : notes)}
      {/* KB-413 step 1: on 12 "More" (secondary, the mic) sits beside Bill Banao; its name still says what it does. An empty bill:
          the full-width primary "Record order". Recording and listening are full screens (09 / 10, step 2). */}
      <button
        type="button"
        onClick={start}
        aria-label={hasLines && !nothing ? t("order.recordMore") : undefined}
        disabled={!!disabledReason || capture.phase === "requesting"}
        className={
          hasLines
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
          {empty && <WarnRow text={t("order.noItems")} {...(onAddByHand ? { onAddByHand: () => onAddByHand(r.transcript ?? "") } : {})} />}
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
