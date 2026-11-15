// KB-412 batch c (26 §5 waveform), as drawn: 5 px bars, radius 3, 4 px apart, centred in a row of the given height (64 on
// 09-Recording, 30 on 10-Review - where the taller bars run past the row, as drawn). Live (09): primary, each bar scaling (kb-bar)
// with the delay the file gives it, 0.11 s apart in sevens; playback (10): the played colour, still. The screen supplies the bar
// heights; the kit draws them. Decorative - the timer and the buttons carry the meaning.
export function Waveform({ heights, live = false, height }: { heights: number[]; live?: boolean; height: number }) {
  return (
    <div aria-hidden="true" className="font-kb flex items-center justify-center gap-1" style={{ height }}>
      {heights.map((h, i) => (
        <div
          key={i}
          className={`w-[5px] flex-none rounded-[3px] ${live ? "bg-kb-primary animate-kb-bar origin-center" : "bg-kb-wave-played"}`}
          style={{ height: h, animationDelay: live ? `${Math.round((i % 7) * 11) / 100}s` : undefined }}
        />
      ))}
    </div>
  );
}
