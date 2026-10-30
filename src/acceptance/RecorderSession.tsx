import { useCallback, useEffect, useState } from "react";
import { useVoiceCapture, type VoiceCapture } from "@/ui/useVoiceCapture";
import { CATEGORIES, slots, TOTAL_ORDERS } from "./categories";
import { dexieClipStore, type ClipStore, type StoredClip } from "./clipStore";
import { blobToBase64, buildSessionFile, type SessionFile } from "./sessionFile";

// KB-364 (owner, 30 Oct 2026): the acceptance-order recorder. DRAFT BUILDS ONLY: main.tsx mounts it behind
// `import.meta.env.VITE_ACCEPTANCE === "1"` (set only when a draft is built), so a production bundle contains none of this
// (scripts/check-recorder-absent.ts proves it). The owner says each order in his own words, the same microphone path the app uses
// (useVoiceCapture); the clips stay on the phone until he exports ONE file for the PC.

const MARKER = "kb-acceptance-recorder";
const ALL = slots();

function downloadJson(file: SessionFile): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kb-acceptance-${file.createdAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface SessionProps {
  capture: VoiceCapture;
  store: ClipStore;
  onExport?: (file: SessionFile) => void;
  play?: (blob: Blob) => void;
}

export function Session({ capture, store, onExport = downloadJson, play = defaultPlay }: SessionProps) {
  const [clips, setClips] = useState<ReadonlyMap<string, StoredClip>>(new Map());
  const [active, setActive] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [note, setNote] = useState("");

  const reload = useCallback(async () => setClips(new Map((await store.list()).map((c) => [c.id, c]))), [store]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const start = async (id: string) => {
    if (active) return;
    setNote("");
    setActive(id);
    setStartedAt(Date.now());
    await capture.start();
  };
  const stop = async (id: string, category: string) => {
    const blob = await capture.stop();
    setActive(null);
    if (!blob) return setNote(`${id}: nothing was recorded - try again`);
    await store.put({ id, category, mime: blob.type || "audio/webm", durationMs: Date.now() - startedAt, blob });
    await reload();
  };
  const exportAll = async () => {
    const list = [...clips.values()];
    const out = await Promise.all(list.map(async (c) => ({ id: c.id, category: c.category, mime: c.mime, durationMs: c.durationMs, audioBase64: await blobToBase64(c.blob) })));
    onExport(buildSessionFile(out, navigator.userAgent, new Date()));
  };

  const btn = "min-h-11 rounded-[6px] border border-line bg-surface px-3 text-[14px] font-medium";
  let n = 0;
  return (
    <main data-testid={MARKER} className="mx-auto max-w-xl px-4 py-4 text-ink">
      <h1 className="text-[18px] font-semibold">Acceptance session</h1>
      <p className="text-[13px] text-ink-soft">
        {clips.size} of {TOTAL_ORDERS} recorded. Say each order in your own words, then write what the bill should be in the sheet on the PC (the same A-number).
      </p>
      {capture.error && <p className="text-danger">The microphone is not available. Check the permission and try again.</p>}
      {note && <p className="text-danger">{note}</p>}
      {CATEGORIES.map((c) => (
        <section key={c.id} className="mt-5">
          <h2 className="text-[15px] font-semibold">{c.title}</h2>
          <p className="text-[13px] text-ink-soft">{c.hint}</p>
          <ul>
            {ALL.filter((s) => s.category === c.id).map((s) => {
              const clip = clips.get(s.id);
              n++;
              const listening = active === s.id;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2">
                  <span className="w-10 font-mono text-[13px]">{s.id}</span>
                  <span className="min-w-24 text-[13px] text-ink-soft">{listening ? `Listening ${Math.round(capture.elapsedMs / 1000)} s` : clip ? `Recorded ${(clip.durationMs / 1000).toFixed(1)} s` : "Not recorded"}</span>
                  {listening ? (
                    <button type="button" className={`${btn} border-danger text-danger`} onClick={() => void stop(s.id, s.category)}>
                      Stop {s.id}
                    </button>
                  ) : (
                    <button type="button" disabled={active !== null} className={btn} onClick={() => void start(s.id)}>
                      {clip ? `Re-record ${s.id}` : `Record ${s.id}`}
                    </button>
                  )}
                  {clip && !listening && (
                    <>
                      <button type="button" className={btn} onClick={() => play(clip.blob)}>
                        Play {s.id}
                      </button>
                      <button type="button" className={btn} onClick={() => void store.remove(s.id).then(reload)}>
                        Delete {s.id}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="sticky bottom-0 mt-6 bg-surface py-3">
        <button type="button" disabled={clips.size === 0 || active !== null} className={`${btn} w-full`} onClick={() => void exportAll()}>
          Download session file ({clips.size} clips)
        </button>
      </div>
    </main>
  );
}

function defaultPlay(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  void audio.play();
}

/** The page the draft build mounts at /?session=1. */
export function RecorderSession() {
  const capture = useVoiceCapture();
  const [store] = useState(dexieClipStore);
  return <Session capture={capture} store={store} />;
}
