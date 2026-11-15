// KB-412 batch c (26 §5 waveform), as drawn: 5 px bars, radius 3, 4 px apart, centred in a row of the given height (64 on
// 09-Recording, 30 on 10-Review - where the taller bars run past the row, as drawn). Live (09): primary, each bar scaling (kb-bar)
// with the delay the file gives it, 0.11 s apart in sevens; playback (10): the played colour, still. The screen supplies the bar
// heights; the kit draws them. Decorative - the timer and the buttons carry the meaning.
// KB-413 step 2 (owner, 15 Nov 2026, answer 5): `scales` = 09's REAL mic level - each bar scaled (no animation) by one recent level;
// `progress` = 10's real playback - the bars already played in primary, the rest in the playback colour.

/** 09-Recording's 26 bar heights (10-Review draws the first 22). */
export const DESIGN_BARS = [10, 22, 36, 18, 48, 30, 56, 26, 40, 14, 34, 52, 20, 44, 28, 58, 24, 38, 12, 30, 46, 18, 36, 22, 50, 16];

export function Waveform({ heights, live = false, height, scales, progress }: {
  heights: readonly number[];
  live?: boolean;
  height: number;
  /** live only: each bar's scaleY (.35 - 1) from the mic level; given = no animation */
  scales?: readonly number[];
  /** playback only: 0 - 1 of the recording played */
  progress?: number;
}) {
  const played = progress === undefined ? 0 : Math.round(Math.min(1, Math.max(0, progress)) * heights.length);
  return (
    <div aria-hidden="true" className="font-kb flex items-center justify-center gap-1" style={{ height }}>
      {heights.map((h, i) => {
        const tone = live || i < played ? "bg-kb-primary" : "bg-kb-wave-played";
        const motion = live && !scales ? "animate-kb-bar origin-center" : live ? "origin-center transition-transform duration-100" : "";
        return (
          <div
            key={i}
            data-played={!live && i < played ? "" : undefined}
            className={`w-[5px] flex-none rounded-[3px] ${tone} ${motion}`}
            style={{
              height: h,
              animationDelay: live && !scales ? `${Math.round((i % 7) * 11) / 100}s` : undefined,
              transform: scales ? `scaleY(${scales[i] ?? 1})` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
