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
export function RecordOverlay({ screenKey, title, asking, lostLine, onAsk, onBack, onKeep, onDiscard, children }: {
  /** "rec" / "review" - focus moves to the new screen when it changes */
  screenKey: string;
  title: string;
  asking: boolean;
  /** the question's one line: what is lost ("The 0:42 recording will be deleted.") */
  lostLine: string;
  /** Back was pressed: pause and ask */
  onAsk: () => void;
  /** KB-413 step 3: 11 / 23 lose nothing on Back (the recording is in the voice queue) - Back just returns to 12 */
  onBack?: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  // Android Back / Escape: 09 / 10 ask, never close by themselves; 11 / 23 return to 12
  useBackEntry("kbRecord", onBack ?? onAsk, onBack ? undefined : () => (onAsk(), false));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), [screenKey]);
  return createPortal(
    <div className="fixed inset-0 z-30 font-kb bg-kb-bg text-kb-ink">
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={(e) => trapTab(e, box.current)} className="mx-auto flex h-full w-full max-w-[480px] flex-col outline-none">
        <TopBar title={title} backLabel={t("settings.back")} onBack={onBack ?? onAsk} />
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

/** 11's placeholder line: the paper's colour with a highlight passing over it - the file's 400 px background tile (bright 60 px in),
 *  here a 400 px strip moved sideways (26 §3: transform only), cut by its bar on purpose (data-clip-ok: the sheets' clip check lets
 *  exactly this through). Still, under reduced motion, it sits where the file's does. */
function Shimmer({ width }: { width: string }) {
  return (
    <span data-shimmer className="relative block h-3 flex-none overflow-hidden rounded-[6px] bg-kb-shimmer" style={{ width }}>
      <span data-clip-ok className="absolute inset-y-0 left-0 w-[400px] animate-kb-shimmer bg-[linear-gradient(90deg,var(--color-kb-shimmer)_0px,var(--color-kb-shimmer-hi)_60px,var(--color-kb-shimmer)_120px)]" />
    </span>
  );
}
/** 11-Generating's five item rows: the name's width, as drawn (the price is 44 px) */
const ROWS_11 = ["46%", "38%", "52%", "30%", "42%"];
/** the paper's torn bottom edge, as 11 draws it (the same 28 teeth as ReceiptPaper's) */
const TORN = "M0 0 L280 0 L280 2 L275 10 L270 2 L265 10 L260 2 L255 10 L250 2 L245 10 L240 2 L235 10 L230 2 L225 10 L220 2 L215 10 L210 2 L205 10 L200 2 L195 10 L190 2 L185 10 L180 2 L175 10 L170 2 L165 10 L160 2 L155 10 L150 2 L145 10 L140 2 L135 10 L130 2 L125 10 L120 2 L115 10 L110 2 L105 10 L100 2 L95 10 L90 2 L85 10 L80 2 L75 10 L70 2 L65 10 L60 2 L55 10 L50 2 L45 10 L40 2 L35 10 L30 2 L25 10 L20 2 L15 10 L10 2 L5 10 L0 2 Z";

/** 11-Generating's screen (under the top bar): the order is being read. No fake stages - the paper only rolls out once (kb-print). */
export function GeneratingBody({ shopName, seconds, onByHand }: { shopName: string; seconds: number; onByHand: () => void }) {
  const { t } = useT();
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-[18px] overflow-y-auto px-6 pt-2 [&>*]:flex-none">
        {/* the paper coming out of the slot - decorative: the words below say what is happening */}
        <div aria-hidden="true" className="w-[300px] max-w-full">
          <div className="mx-[-10px] h-[14px] rounded-[8px] bg-kb-slot" />
          <div className="-mt-[6px] overflow-hidden animate-kb-print drop-shadow-kb-receipt">
            <div className="bg-kb-card px-[18px] pt-4 pb-[10px] font-mono text-kb-ink">
              <p className="text-center text-kb-15 font-bold tracking-[.5px] uppercase [overflow-wrap:anywhere]">{shopName}</p>
              <div className="mt-2 mb-[10px] flex justify-center"><Shimmer width="120px" /></div>
              <div className="mb-1 border-t border-dashed border-kb-receipt-rule" />
              {ROWS_11.map((w) => (
                <div key={w} className="flex justify-between gap-[10px] border-b border-kb-shimmer py-[9px]">
                  <Shimmer width={w} />
                  <Shimmer width="44px" />
                </div>
              ))}
              <div className="flex items-center justify-between pt-[10px] pb-1">
                <span className="font-bold">{t("bill.total")}</span>
                <Shimmer width="70px" />
              </div>
            </div>
            <svg width="100%" height="10" viewBox="0 0 280 10" preserveAspectRatio="none" className="block text-kb-card">
              <path fill="currentColor" d={TORN} />
            </svg>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-center">
          <h2 role="status" className="text-kb-21 font-extrabold">{t("gen.reading")}</h2>
          <p className="text-kb-15 text-kb-sub tabular-nums">{t("gen.elapsed", { s: seconds })}</p>
        </div>
        <div className="self-stretch">
          {/* one fixed true tip (answer 4; rotating tips are KB-424) - the learning wording of 26 §0b item 3 (owner, 15 Nov 2026) */}
          <TipCard variant="warm" title={t("gen.tipTitle")}>{t("gen.tip")}</TipCard>
        </div>
      </div>
      <div className="flex flex-col gap-2 px-5 pb-[26px] pt-4">
        <p className="flex items-center justify-center gap-[6px] text-kb-13 text-kb-ok">
          <Icon icon={KB_ICONS.Phone} size={16} />
          {t("gen.safe")}
        </p>
        <Button variant="secondary" height={54} icon={KB_ICONS.Keyboard} iconSize={20} onClick={onByHand} className="text-kb-16!">{t("gen.byHand")}</Button>
      </div>
    </>
  );
}

/** 23's one true sentence: the voice queue's reason (src/data/voiceJob.ts) */
const FAIL_SENTENCE: Record<string, "fail.sent" | "fail.busy" | "fail.limit" | "fail.dayLimit" | "fail.session"> = {
  upload: "fail.sent", start: "fail.sent", busy: "fail.busy", timeout: "fail.busy", rate_limited: "fail.limit", day_limit: "fail.dayLimit", session: "fail.session",
};

/** 23-ReadFailed's screen (under the top bar): the first recording of an empty bill was not read. It is still in the voice queue. */
export function ReadFailedBody({ reason, ms, onRetry, onTypeInstead, onRecordAgain, onRemove }: {
  /** the queue's reason; none = it gave up waiting */
  reason?: string;
  ms: number;
  onRetry: () => void;
  onTypeInstead: () => void;
  onRecordAgain: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[18px] overflow-y-auto px-[26px] [&>*]:flex-none">
        <div className="flex h-24 w-24 items-center justify-center rounded-[30px] bg-kb-warn-bg text-kb-warn-text animate-kb-pop">
          <Icon icon={KB_ICONS.TriangleAlert} size={44} strokeWidth={1.8} />
        </div>
        <div className="flex flex-col gap-2 text-center">
          <h2 className="text-kb-24 font-extrabold">{t("order.couldntRead")}</h2>
          <p role="alert" className="text-kb-16 leading-[1.5] text-kb-sub">{t(FAIL_SENTENCE[reason ?? ""] ?? "fail.read")}</p>
        </div>
        <div className="flex items-center gap-3 self-stretch rounded-[16px] border border-kb-border bg-kb-card px-[14px] py-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-kb-ok-pale text-kb-ok">
            <Icon icon={KB_ICONS.Phone} size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-kb-15 font-bold">{t("fail.recording", { time: mmss(ms) })}</span>
            <span className="block text-kb-13 text-kb-ok">{t("fail.saved")}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-[10px] px-5 pb-[26px] pt-[18px]">
        {/* answer 3: Retry the SAME recording (big, first); Type instead = Add by hand; Record again (asks first - owner, 15 Nov 2026) */}
        <Button variant="primary" icon={KB_ICONS.RotateCw} iconSize={20} onClick={onRetry}>{t("retry.tryAgain")}</Button>
        <div className="flex gap-[10px]">
          <Button variant="secondary" height={52} icon={KB_ICONS.Keyboard} iconSize={19} fill={false} onClick={onTypeInstead} className="flex-1">{t("review.typeInstead")}</Button>
          <Button variant="secondary" height={52} icon={KB_ICONS.Mic} iconSize={19} fill={false} onClick={onRecordAgain} className="flex-1">{t("fail.recordAgain")}</Button>
        </div>
        {/* Remove as a text button (answer 3) - 23 does not draw it */}
        <Button variant="tertiary" ariaLabel={t("order.remove")} onClick={onRemove}>{t("col.remove")}</Button>
      </div>
    </>
  );
}
