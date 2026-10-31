// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { VoiceCapture } from "@/ui/useVoiceCapture";
import type { ClipStore, StoredClip } from "./clipStore";
import { Session } from "./RecorderSession";
import type { SessionFile } from "./sessionFile";

// KB-364: the phone recorder, with a fake microphone and an in-memory store.

afterEach(cleanup);

const fakeStore = (): ClipStore & { rows: Map<string, StoredClip> } => {
  const rows = new Map<string, StoredClip>();
  return { rows, list: async () => [...rows.values()], put: async (c) => void rows.set(c.id, c), remove: async (id) => void rows.delete(id) };
};
const capture = (blob: Blob | null): VoiceCapture =>
  ({ phase: "idle", error: null, elapsedMs: 0, lastTiming: null, start: vi.fn(async () => {}), stop: vi.fn(async () => blob), release: vi.fn() }) as VoiceCapture;
const click = (name: string) => act(() => screen.getByRole("button", { name }).click());

describe("the recorder session page", () => {
  it("lists all 62 slots in the eleven groups, none recorded, and nothing to export", () => {
    render(<Session capture={capture(null)} store={fakeStore()} />);
    expect(screen.getByText(/0 of 62 recorded/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Record A\d\d$/ })).toHaveLength(62);
    expect(screen.getByRole("heading", { name: "Mixed: some priced, some not" })).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Download session file/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Record -> Stop saves the clip under its slot; the count moves; it can be played, re-recorded and deleted", async () => {
    const store = fakeStore();
    const play = vi.fn();
    const mic = capture(new Blob([new Uint8Array(100)], { type: "audio/webm;codecs=opus" }));
    render(<Session capture={mic} store={store} play={play} />);
    click("Record A07");
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop A07" })).toBeTruthy());
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Record A08" }) as HTMLButtonElement).disabled).toBe(true); // one at a time
    click("Stop A07");
    await waitFor(() => expect(screen.getByText(/1 of 62 recorded/)).toBeTruthy());
    expect(store.rows.get("A07")).toMatchObject({ id: "A07", category: "short-priceless", mime: "audio/webm;codecs=opus" });
    click("Play A07");
    expect(play).toHaveBeenCalledTimes(1);
    click("Delete A07");
    await waitFor(() => expect(screen.getByText(/0 of 62 recorded/)).toBeTruthy());
    expect(store.rows.size).toBe(0);
  });

  it("a recording that captured nothing says so and saves nothing", async () => {
    const store = fakeStore();
    render(<Session capture={capture(null)} store={store} />);
    click("Record A01");
    await waitFor(() => screen.getByRole("button", { name: "Stop A01" }));
    click("Stop A01");
    await waitFor(() => expect(screen.getByText(/A01: nothing was recorded/)).toBeTruthy());
    expect(store.rows.size).toBe(0);
  });

  it("exports ONE session file with every clip's id, group and audio", async () => {
    const store = fakeStore();
    store.rows.set("A03", { id: "A03", category: "short-priced", mime: "audio/webm", durationMs: 3000, blob: new Blob([new Uint8Array([1, 2, 3])]) });
    store.rows.set("A41", { id: "A41", category: "unclear-words", mime: "audio/webm", durationMs: 2000, blob: new Blob([new Uint8Array([4, 5])]) });
    const onExport = vi.fn<(f: SessionFile) => void>();
    render(<Session capture={capture(null)} store={store} onExport={onExport} />);
    await waitFor(() => expect(screen.getByText(/2 of 62 recorded/)).toBeTruthy());
    click("Download session file (2 clips)");
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const file = onExport.mock.calls[0]![0];
    expect(file.version).toBe(1);
    expect(file.clips.map((c) => [c.id, c.category, c.audioBase64])).toEqual([
      ["A03", "short-priced", "AQID"],
      ["A41", "unclear-words", "BAU="],
    ]);
  });

  it("shows when the microphone is not available", () => {
    const mic = { ...capture(null), error: { kind: "denied", message: "x" } } as unknown as VoiceCapture;
    render(<Session capture={mic} store={fakeStore()} />);
    expect(screen.getByText(/microphone is not available/)).toBeTruthy();
  });
});
