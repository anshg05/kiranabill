import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";
import { ORDER_RECORDING } from "./useVoiceCapture";
import { TopBar } from "./kit/TopBar";
import { Badge } from "./kit/Badge";
import { MicButton } from "./kit/MicButton";
import { DESIGN_BARS, Waveform } from "./kit/Waveform";
import { TipCard } from "./kit/TipCard";
import { Button } from "./kit/Button";
import { BottomSheet } from "./kit/BottomSheet";
import { Icon, KB_ICONS } from "./kit/icons";
import { trapTab } from "./kit/trapTab";

// KB-413 step 2 (D110 item 9): 09-Recording and 10-Review, full screen, as drawn. The recorder itself (useVoiceCapture: the 5:00 limit
// warned at 4:30, Pause, the background stop that KEEPS the recording, the mic errors) is unchanged - these are its screens.
// Back (the arrow, Android Back, Escape) never throws a recording away by itself (owner, 15 Nov 2026, answer 7): it pauses and asks
// "Discard recording?" - Keep / Discard.

/** "m:ss" (10-Review's "0:42", "of 5:00") */
export function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** "mm:ss" - 09-Recording's big timer ("00:42") */
const clock = (ms: number) => mmss(ms).padStart(5, "0");

const ONES = DESIGN_BARS.map(() => 1);
/** 09's 22 px space between parts, allowed to shrink to 8 (the parts themselves never shrink) */
const SPACE = "flex-[0_1_22px]! min-h-2";
// 10 draws its two tallest bars (56, 58) 1 px past the player card's edge; capped at 54 so nothing leaves its card (reviewer, 15 Nov 2026)
const BARS_10 = DESIGN_BARS.slice(0, 22).map((h) => Math.min(h, 54));

/** The full screen both share: the top bar, Back asks, Tab stays inside, the Discard question on top. */
export function RecordOverlay({ screenKey, title, asking, lostLine, onAsk, onKeep, onDiscard, children }: {
  /** "rec" / "review" - focus moves to the new screen when it changes */
  screenKey: string;
  title: string;
  asking: boolean;
  /** the question's one line: what is lost ("The 0:42 recording will be deleted.") */
  lostLine: string;
  /** Back was pressed: pause and ask */
  onAsk: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  // Android Back / Escape: ask, never close by itself
  useBackEntry("kbRecord", onAsk, () => (onAsk(), false));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), [screenKey]);
  return createPortal(
    <div className="fixed inset-0 z-30 font-kb bg-kb-bg text-kb-ink">
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={(e) => trapTab(e, box.current)} className="mx-auto flex h-full w-full max-w-[480px] flex-col outline-none">
        <TopBar title={title} backLabel={t("settings.back")} onBack={onAsk} />
        {children}
      </div>
      {asking && (
        // step-2 fix 4 (owner + reviewer): what is lost; the safe choice is the big first button, Discard red but secondary under it
        <BottomSheet backKey="kbDiscardRecording" title={t("rec.discardTitle")} intro={lostLine} onClose={onKeep}>
          <div className="flex flex-col gap-[10px]">
            <Button variant="primary" onClick={onKeep}>{t("rec.keep")}</Button>
            <Button variant="destructive-outline" onClick={onDiscard}>{t("discard.confirm")}</Button>
          </div>
        </BottomSheet>
      )}
    </div>,
    document.body,
  );
}

/** 09-Recording's screen (under the top bar). */
export function RecordingBody({ elapsedMs, paused, busy, scales, onPause, onResume, onStop }: {
  elapsedMs: number;
  paused: boolean;
  /** the recording is being closed: Pause / Stop wait */
  busy: boolean;
  /** the bars' real-level scales; null = still at their drawn heights (reduced motion, no Web Audio) */
  scales: readonly number[] | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const { t } = useT();
  const [before, after] = t("rec.tip", { what: "\u0001" }).split("\u0001");
  const warn = elapsedMs >= ORDER_RECORDING.warnAtMs;
  return (
    <>
      {/* 09 draws 22 px between the parts; on a short screen or large text those spaces shrink to 8 first, so nothing is cut (step-2
          fix 2). Only if even that is not enough does the middle scroll - the buttons always stay on screen. */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-[14px] [&>*]:flex-none">
        <Badge kind={paused ? "paused" : "recording"}>{t(paused ? "order.paused" : "rec.recording")}</Badge>
        <div aria-hidden="true" className={SPACE} />
        <div className="text-[64px] leading-[normal] font-extrabold tracking-[-2px] tabular-nums">{clock(elapsedMs)}</div>
        <div className="mt-[6px] text-kb-14 text-kb-sub">{t("rec.of", { max: mmss(ORDER_RECORDING.maxMs) })}</div>
        <div aria-hidden="true" className={SPACE} />
        <MicButton variant="recording" still={paused} />
        <div aria-hidden="true" className={SPACE} />
        <Waveform heights={DESIGN_BARS} live height={64} scales={scales ?? ONES} />
        <div aria-hidden="true" className={SPACE} />
        <div className="self-stretch">
          <TipCard variant="white-dense">
            {before}
            <b className="font-bold text-kb-ink">{t("rec.tipWhat")}</b>
            {after}
          </TipCard>
        </div>
      </div>
      <div className="flex flex-col gap-[10px] px-5 pb-7 pt-[18px]">
        {/* the 4:30 warning: 09 does not draw it (26 §5 "4:30 one-line warning") - here, over the buttons; asked on the sheet */}
        {warn && (
          <p role="status" className="flex items-center justify-center gap-[6px] text-center text-kb-14 font-bold text-kb-warn-text">
            <Icon icon={KB_ICONS.TriangleAlert} size={16} />
            {t("order.warn")}
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" height={58} icon={paused ? KB_ICONS.Play : KB_ICONS.Pause} iconSize={20} fill={false} disabled={busy} onClick={paused ? onResume : onPause} className="flex-1">
            {t(paused ? "order.resume" : "order.pause")}
          </Button>
          <Button variant="primary" height={58} icon={KB_ICONS.Square} iconSize={20} fill={false} disabled={busy} onClick={onStop} className="flex-[1.4]">
            {t("mic.stop")}
          </Button>
        </div>
        <p className="flex items-center justify-center gap-[6px] text-kb-13 text-kb-ok">
          <Icon icon={KB_ICONS.Phone} size={16} />
          {t("rec.saved")}
        </p>
      </div>
    </>
  );
}

/** 10-Review's screen (under the top bar): the recording, playable, then Generate / Re-record / Type instead. */
export function ReviewBody({ url, ms, saved, stopped, onGenerate, onRerecord, onTypeInstead }: {
  url: string;
  ms: number;
  /** on the phone (src/data/recordingDraft.ts) - only then does 10 say so */
  saved: boolean;
  stopped?: "limit" | "hidden";
  onGenerate: () => void;
  onRerecord: () => void;
  onTypeInstead: () => void;
}) {
  const { t } = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [atMs, setAtMs] = useState(0);
  // the recorder's own length: a recorded webm often reports no duration (Infinity) until it has been played through
  const progress = ms > 0 ? atMs / ms : 0;
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play()?.catch(() => setPlaying(false));
  };
  return (
    <>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setAtMs(Math.min(ms, e.currentTarget.currentTime * 1000))}
        onEnded={() => (setPlaying(false), setAtMs(0))}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-[10px]">
        <div className="flex flex-col items-center gap-[18px] rounded-[26px] border border-kb-border bg-[linear-gradient(170deg,var(--color-kb-card)_0%,var(--color-kb-primary-pale)_100%)] px-5 py-[26px] shadow-kb-ready">
          <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full bg-kb-ok-pale text-kb-ok animate-kb-pop">
            <Icon icon={KB_ICONS.Check} size={36} strokeWidth={2.4} />
          </div>
          <div className="text-center">
            <h2 className="text-kb-22 font-extrabold">{t("review.ready")}</h2>
            <p className="mt-1 text-kb-15 text-kb-sub">{saved ? t("review.length", { time: mmss(ms) }) : mmss(ms)}</p>
            {/* why it stopped by itself (today's words; 10 does not draw them - asked on the sheet) */}
            {stopped && <p className="mt-1 text-kb-13 font-bold text-kb-warn-text">{t(stopped === "limit" ? "order.stoppedLimit" : "order.stoppedHidden")}</p>}
          </div>
          <div className="flex items-center gap-3 self-stretch rounded-[18px] border border-kb-border bg-kb-card px-[14px] py-3">
            <button
              type="button"
              aria-label={t(playing ? "review.pause" : "review.play")}
              onClick={toggle}
              className="kb-hit kb-press flex h-12 w-12 flex-none items-center justify-center rounded-full bg-kb-primary text-kb-card"
            >
              <Icon icon={playing ? KB_ICONS.Pause : KB_ICONS.Play} size={20} strokeWidth={1.5} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <Waveform heights={BARS_10} height={30} progress={progress} />
              <div className="flex justify-between text-kb-12 text-kb-sub tabular-nums">
                <span>{mmss(atMs)}</span>
                <span>{mmss(ms)}</span>
              </div>
            </div>
          </div>
        </div>
        <TipCard variant="note">{t("review.tip")}</TipCard>
      </div>
      <div className="flex flex-col gap-[10px] px-5 pb-[26px] pt-[18px]">
        <Button variant="primary" icon={KB_ICONS.Sparkles} iconSize={20} onClick={onGenerate}>{t("order.generate")}</Button>
        <div className="flex gap-[10px]">
          <Button variant="secondary" icon={KB_ICONS.RotateCcw} fill={false} onClick={onRerecord} className="flex-1">{t("order.rerecord")}</Button>
          <Button variant="secondary" icon={KB_ICONS.Keyboard} fill={false} onClick={onTypeInstead} className="flex-1">{t("review.typeInstead")}</Button>
        </div>
      </div>
    </>
  );
}
