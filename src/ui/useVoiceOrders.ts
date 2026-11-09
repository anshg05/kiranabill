import { useCallback, useEffect, useRef, useState } from "react";
import type { KiranaBillDB, LocalVoiceRecording } from "@/data/db";
import type { BillLine } from "@/data/voiceBilling";
import type { VoiceJobOutcome } from "@/data/voiceJob";
import { audioOf, enqueueRecording, markAppended, recordingsForBill, removeRecording, saveOutcome, unsentRecordings } from "@/data/voiceQueue";
import { aiAnswerBill } from "@/domain/aiAnswerBill";
import type { ParserCatalog } from "@/domain/catalogIndex";
import type { ParsedItem } from "@/domain/grammar";
import type { ReviewFlag } from "@/domain/reviewFlags";

// KB-385 step 4 (owner, 10 Nov 2026; doc 25 §5, §6, §8; D107): one path for every order.
//   Generate -> the phone's queue (src/data/voiceQueue) -> sent (or kept until the phone is back online) -> the answer -> the bill, built
//   on the phone by src/domain/aiAnswerBill and added ONCE (markAppended), with the transcript ("Heard: ...") and the filled prices.
// Retry resends the SAME recording (a second tap while it is sending is ignored); a recording not yet in the bill blocks Bill Banao
// (`blocking`); Remove takes it out. Every outcome that is not a bill ends in Retry or Add by hand - the screen shows them.

export interface AppendedOrder {
  readonly recordingId: string;
  readonly transcript: string;
  /** Empty when nothing was understood ("No items found"). */
  readonly lines: readonly BillLine[];
  /** itemIndex relative to `lines`, as bill.add expects. */
  readonly flags: readonly ReviewFlag[];
  /** KB-385 step 6: Generate -> the answer on the phone (the pilot numbers' stop -> transcript; offline time included). */
  readonly waitedMs: number;
}

export interface UseVoiceOrdersOptions {
  db: KiranaBillDB | null;
  shopId: string | null;
  /** The bill being built: its recordings, and where their lines go. */
  billLocalId: string | null;
  parser: ParserCatalog | null;
  /** submitRecording with the session (the app); a fake in tests. */
  submit: (recordingId: string, audio: Blob) => Promise<VoiceJobOutcome>;
  onAppend: (order: AppendedOrder) => void;
}

export interface VoiceOrders {
  /** This bill's recordings, oldest first (each "add more by voice" is one more). */
  recordings: LocalVoiceRecording[];
  /** Not yet in the bill - Bill Banao waits for them. */
  blocking: LocalVoiceRecording[];
  /** Being sent / waited for right now. */
  sending: ReadonlySet<string>;
  offline: boolean;
  generate: (audio: Blob, recordedMs: number) => Promise<void>;
  retry: (recordingId: string) => Promise<void>;
  remove: (recordingId: string) => Promise<void>;
}

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function useVoiceOrders({ db, shopId, billLocalId, parser, submit, onAppend }: UseVoiceOrdersOptions): VoiceOrders {
  const [recordings, setRecordings] = useState<LocalVoiceRecording[]>([]);
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [offline, setOffline] = useState(!isOnline());
  const latest = useRef({ submit, onAppend, parser, billLocalId });
  latest.current = { submit, onAppend, parser, billLocalId };
  const inFlight = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setRecordings(db && billLocalId ? await recordingsForBill(db, billLocalId) : []);
  }, [db, billLocalId]);

  /** An answered recording of THIS bill goes into it once. */
  const appendIfFirst = useCallback(
    async (recordingId: string) => {
      const { parser: shop, billLocalId: bill, onAppend: append } = latest.current;
      if (!db || !shop) return;
      const row = await db.voiceQueue.get(recordingId);
      if (!row || row.state !== "done" || row.billLocalId !== bill) return;
      if (!(await markAppended(db, recordingId))) return;
      const transcript = row.transcript ?? "";
      const answer = aiAnswerBill(transcript, (row.items ?? []) as ParsedItem[], shop);
      const filled = new Map(answer.filled.map((f) => [f.index, f.kind]));
      append({
        recordingId,
        transcript,
        lines: answer.lines.map((l, i) => ({ item: l.item, displayName: l.displayName, source: "voice" as const, ...(filled.has(i) ? { filled: filled.get(i) } : {}) })),
        flags: answer.flags,
        waitedMs: Math.max(0, Date.now() - Date.parse(row.createdAt)),
      });
    },
    [db],
  );

  const send = useCallback(
    async (recordingId: string) => {
      if (!db || inFlight.current.has(recordingId)) return;
      if (!isOnline()) {
        setOffline(true);
        return; // it stays queued; sent when the phone is back online
      }
      inFlight.current.add(recordingId); // before any await: a second tap meanwhile is ignored
      setSending(new Set(inFlight.current));
      try {
        const row = await db.voiceQueue.get(recordingId);
        if (!row || row.state === "appended") return;
        let outcome: VoiceJobOutcome;
        try {
          outcome = await latest.current.submit(recordingId, audioOf(row));
        } catch {
          outcome = { kind: "failed", recordingId, reason: "start" };
        }
        await saveOutcome(db, recordingId, outcome);
        await appendIfFirst(recordingId);
      } finally {
        inFlight.current.delete(recordingId);
        setSending(new Set(inFlight.current));
        await refresh();
      }
    },
    [db, appendIfFirst, refresh],
  );

  const generate = useCallback(
    async (audio: Blob, recordedMs: number) => {
      if (!db || !shopId || !billLocalId) return;
      const recordingId = crypto.randomUUID(); // made ONCE per recording (one recording = one bill)
      await enqueueRecording(db, { recordingId, shopId, billLocalId, audio, recordedMs });
      await refresh();
      await send(recordingId);
    },
    [db, shopId, billLocalId, refresh, send],
  );

  const remove = useCallback(
    async (recordingId: string) => {
      if (!db) return;
      await removeRecording(db, recordingId);
      await refresh();
    },
    [db, refresh],
  );

  // On start and whenever the phone comes back online: answered-but-not-added recordings go in (a reload in the middle), queued ones are sent.
  useEffect(() => {
    if (!db || !shopId || !billLocalId) return;
    let alive = true;
    const drain = async () => {
      if (!alive) return;
      setOffline(!isOnline());
      for (const r of await recordingsForBill(db, billLocalId)) if (r.state === "done") await appendIfFirst(r.recordingId);
      await refresh();
      if (!isOnline()) return;
      for (const r of await unsentRecordings(db, shopId)) if (r.billLocalId === billLocalId) await send(r.recordingId);
    };
    const goneOffline = () => setOffline(true);
    const onOnline = () => void drain();
    void drain();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", goneOffline);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", goneOffline);
    };
  }, [db, shopId, billLocalId, appendIfFirst, refresh, send]);

  return { recordings, blocking: recordings.filter((r) => r.state !== "appended"), sending, offline, generate, retry: send, remove };
}
