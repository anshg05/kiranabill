import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import type { CatalogEntry } from "@/domain/catalog";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import type { ParsedItem } from "@/domain/grammar";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags, type ReviewFlag } from "@/domain/reviewFlags";
import { checkGroupKey, checkHeadline, customItem, displayRate, manualItem, unitChoices } from "@/domain/billEdit";
import { amountNeeded } from "@/domain/finalBill";
import { sumPaise } from "@/domain/money";
import { recordingVocabulary } from "@/domain/vocabulary";
import { learnedNoteFor, type LearnedMap } from "@/domain/aliasEvidence";
import { removeLearnedAlias } from "@/data/aliasEvidence";
import { useShopCatalog } from "./useShopCatalog";
import { parseTranscript, warmVoice } from "@/data/voiceApi";
import type { BillLine } from "@/data/voiceBilling";
import { useAuth } from "@/providers/AuthProvider";
import { usePersistentStorage } from "./usePersistentStorage";
import { useUpdateGate } from "@/pwa/updateGate";
import { useShop } from "@/providers/ShopProvider";
import { Receipt, ReceiptNumberText } from "./Receipt";
import { useReceiptShare, type ReceiptShare } from "./useReceiptShare";
import { ShareBar } from "./ShareBar";
import { PrintButton } from "./PrintButton";
import { HistoryScreen } from "./HistoryScreen";
import { reissueState } from "./reissueDraft";
import { useMetricsWiring } from "./useMetricsWiring";
import { afterPaint } from "./afterPaint";
import { reconcileBills, recordColdStart } from "@/data/billMetrics";
import { clearThenSignOut } from "@/data/reviewCapture";
import { CatalogScreen } from "./CatalogScreen";
import { SettingsScreen } from "./SettingsScreen";
import { addCustomProduct, addFromReadyCatalog, saveProductDetails, saveProductPrice, setProductActive } from "@/data/catalogEdit";
import { importProducts } from "@/data/catalogImport";
import { ignorePriceSuggestionFor } from "@/data/learningAudit";
import { renderReceiptFiles } from "./receiptImage";
import type { Receipt as ReceiptModel } from "@/domain/receipt";
import { formatAmount, formatQty, formatRate, paiseText } from "./billFormat";
import { useBillLines, type EditField, type NotAdded, type ShownFlag } from "./useBillLines";
import { useOrderResolver } from "./useOrderResolver";
import { Button } from "./kit/Button";
import { Badge } from "./kit/Badge";
import { BillLine as KitBillLine, PriceNeededLine } from "./kit/BillLine";
import { BottomSheet } from "./kit/BottomSheet";
import { OfflineStrip } from "./kit/Banner";
import { Icon, KB_ICONS } from "./kit/icons";
import { useFinalise } from "./useFinalise";
import { supabase } from "@/data/supabaseClient";
import { requestBillNumber, warmServer } from "@/data/receiptNumbers";
import { syncNow } from "@/data/sync";
import { learnPendingBills } from "@/data/learnBill";
import { recordPhases } from "@/data/phaseTimings";
import { recordVoiceTiming } from "@/data/voiceTimings";
import { runAfterSave } from "./afterSave";
import { coldPhases, markCold } from "./coldMarks";
import { AddItemSheet } from "./AddItemSheet";
import { useT, type Translate } from "./useT";
import { EditableValue } from "./EditableValue";
import { HeaderMenu } from "./HeaderMenu";
import { InstallHint } from "./InstallHint";
import { SyncChipView, ConfirmDialog, signOutWarning, clearBillWarning } from "./OfflineUi";
import type { SyncChip, Unsynced } from "./syncChip";
import { useSyncChip } from "./useSyncChip";
import { IDLE_VOICE, useVoiceBilling, type VoiceView } from "./useVoiceBilling";
import { markRecordingBilled, submitRecording, type VoiceJobOutcome } from "@/data/voiceJob";
import { settleBilledRecordings } from "@/data/voiceQueue";
import { useVoiceOrders } from "./useVoiceOrders";
import { OrderEntries, OrderRecorder, type TakeStore } from "./VoiceOrderPanel";
import { clearRecordingDraft, loadRecordingDraft, saveRecordingDraft } from "@/data/recordingDraft";
import { runBillCommand } from "./voiceCommands";
import { useShopName } from "./useShopName";
import type { Customer } from "./useBillLines";
import { CASH, formatMobile } from "@/domain/customer";

// S3 (05-FRONTEND-SPEC.md §2) - KB-301 is the SHELL only: layout, the line
// list, the pinned TOTAL, the action bar. Voice (KB-302), editing (KB-303),
// flags (KB-304), add item (KB-305), customer fields (KB-306) and finalise
// (KB-307) plug into it later. Design: 13-DESIGN.md §3-§6c, §9.

/** DEV ONLY (owner, 27 Sep 2026): `?try=<utterance>` fills the bill with real
 * parseUtterance() output - against the SHOP's catalog (Q2) - so the layout
 * can be checked in a browser. KB-304: several utterances split by "|", each
 * with its real review flags, so every severity can be seen. `import.meta.env.DEV`
 * is a build-time `false` in production, so this branch and its call are
 * removed from `npm run build`. */
function devTryUtterances(shop: ParserCatalog): { transcript: string; lines: BillLine[]; flags: ReviewFlag[] }[] {
  if (!import.meta.env.DEV) return [];
  const tried = new URLSearchParams(window.location.search).get("try") ?? "";
  return tried
    .split("|")
    .map((t) => t.trim())
    .flatMap((transcript) => {
      const items = transcript ? parseUtterance(transcript, shop) : null;
      if (!items) return [];
      const lines = items.map((item): BillLine => ({ item, displayName: (item.catalogId && shop.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" }));
      return [{ transcript, lines, flags: [...evaluateReviewFlags(transcript, items, shop.entries)] }];
    });
}

/** DEV ONLY (owner, KB-319): `?failparse=timeout|502|429|network` makes the
 * FIRST parse of each transcript fail that way, so the "Not added" / Retry
 * flow can be seen in a browser; the Retry then goes to the real /voice.
 * `timeout` never answers, so the real 8 s client deadline fires. Removed
 * from `npm run build` (VERIFY greps dist/ for "failparse").
 * LIMIT: it only fails the Layer 2 parse REQUEST, so it only affects orders the
 * fast path can't read - an order Layer 1 reads on the device never sends one. */
function devFailParseFetch(): typeof fetch | undefined {
  if (!import.meta.env.DEV) return undefined;
  const mode = new URLSearchParams(window.location.search).get("failparse");
  if (!mode) return undefined;
  const failedOnce = new Set<string>();
  return async (input, init) => {
    const meta = JSON.parse(String((init?.body as FormData).get("meta"))) as { transcript?: string };
    const key = meta.transcript ?? "";
    if (failedOnce.has(key)) return fetch(input, init);
    failedOnce.add(key);
    console.info(`[voice] dev ?failparse=${mode}: failing the first parse of`, key);
    if (mode === "timeout") return new Promise<Response>(() => {});
    if (mode === "network") throw new TypeError("Failed to fetch (dev ?failparse=network)");
    return new Response(JSON.stringify({ error: `dev ?failparse=${mode}` }), { status: mode === "429" ? 429 : 502 });
  };
}

/** DEV ONLY (KB-385): `?voicefake=done|empty|failed|session|limit|gaveup` - the order recorder records from a SILENT microphone (the
 * preview browser has none) and every send answers that way after ~2.5 s, so each screen state is seen with NO Gemini call. "done" bills
 * a filled shop price, a repeated item's earlier price and an A47-style ear mistake (₹102) to catch in "Heard". Offline is the browser's
 * own offline mode. Removed from `npm run build` (VERIFY greps dist/ for "voicefake"). */
function devVoiceFake(): ((recordingId: string, audio: Blob) => Promise<VoiceJobOutcome>) | undefined {
  if (!import.meta.env.DEV) return undefined;
  const mode = new URLSearchParams(window.location.search).get("voicefake");
  if (!mode) return undefined;
  const silentMic = async () => {
    const ctx = new AudioContext();
    const out = ctx.createMediaStreamDestination();
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const tone = ctx.createOscillator();
    tone.connect(mute).connect(out);
    tone.start();
    return out.stream;
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: silentMic } });
  const it = (spokenName: string, qty: number, unit: string, priceType: "rate" | "total" | "default", rate: number | null, total: number | null) =>
    ({ spokenName, catalogId: null, isCustom: true, matchStatus: "none" as const, qty, unit, rate, rateUnit: rate === null ? null : unit, total, priceType });
  return async (recordingId) => {
    console.info(`[voice] dev ?voicefake=${mode}`);
    await new Promise((r) => setTimeout(r, 2500));
    if (mode === "done") {
      return {
        kind: "done", recordingId,
        transcript: "2 किलो चीनी, 1 बंसल तेल 1 लीटर 150 रुपए, फुटाने 102 रुपए किलो 1 किलो, 1 बंसल तेल 1 लीटर",
        items: [it("चीनी", 2, "kg", "default", null, null), it("बंसल तेल", 1, "liter", "total", null, 15000), it("फुटाने", 1, "kg", "rate", 10200, null), it("बंसल तेल", 1, "liter", "default", null, null)],
      };
    }
    if (mode === "empty") return { kind: "done", recordingId, transcript: "हाँ जी बोलिए", items: [] };
    if (mode === "gaveup") return { kind: "gave_up", recordingId };
    return { kind: "failed", recordingId, reason: mode === "session" ? "session" : mode === "limit" ? "rate_limited" : "failed" };
  };
}

export function BillingScreen() {
  const { signOut, session, deviceDb } = useAuth();
  const { shop, localDb, deviceId } = useShop();
  // THIS shop's catalog, from Dexie (works offline) - Layer 1, the Layer 2
  // slice, reviewFlags and the Whisper vocabulary all use it (Q2, D4).
  // KB-311: reload() after a Catalog save - new lines use the new price; lines already on the bill keep their own.
  // KB-350: also reloaded by every sync pull that moved the catalog, shop settings or learning (another phone's change).
  const { catalog: shopCatalog, reload: reloadCatalog, pulls: catalogPulls } = useShopCatalog(localDb ?? null, shop?.id);
  // KB-352: rebuilt only when the products themselves changed - a bill that only moves usage counts keeps the same `entries`.
  const parser = useMemo(() => (shopCatalog ? prepareParserCatalog(shopCatalog.entries) : null), [shopCatalog?.entries]);
  const vocabulary = useMemo(
    () => (shopCatalog ? recordingVocabulary(shopCatalog.entries, shopCatalog.usageById) : []),
    [shopCatalog],
  );

  // KB-303: the bill being built - its lines, edits, removals and flags
  // (useBillLines; KB-304 will display the flags, KB-305 adds items).
  // KB-313: the half-built bill is kept in this user's own database and comes back after a reload.
  const bill = useBillLines(parser?.entries ?? NO_ENTRIES, localDb && shop ? { db: localDb, shopId: shop.id } : undefined);
  const { add: addToBill, rows } = bill;
  // KB-404 (D80): the bill's measurements - a write-only sink (the bill never reads from it). The hook itself is called after the
  // finaliser exists (it needs the saved bill); the voice and resolver hooks reach it through this ref.
  const wiringRef = useRef<ReturnType<typeof useMetricsWiring> | null>(null);
  useEffect(() => {
    if (parser && bill.ready && rows.length === 0) {
      for (const u of devTryUtterances(parser)) addToBill(u.lines, u.flags, u.transcript);
    }
    // only when the catalog arrives - a dev ?try= bill, once
  }, [parser, bill.ready]);

  // DEV: the bill's flags after every change - there is no flag UI until KB-304.
  useEffect(() => {
    if (import.meta.env.DEV && bill.rows.length) {
      console.info("[bill] flags", bill.flags.map((f) => `${f.severity} ${f.code}@${f.itemIndex}`));
    }
  }, [bill.flags, bill.rows.length]);

  const accessToken = session?.access_token ?? null;
  const [devFetch] = useState(devFailParseFetch);
  const parse = useCallback(
    (text: string, catalogSlice: Parameters<typeof parseTranscript>[1]["catalogSlice"]) => {
      if (!accessToken) throw new Error("no live session"); // the mic is disabled without one
      return parseTranscript(text, { accessToken, catalogSlice, fetchImpl: devFetch });
    },
    [accessToken, devFetch],
  );
  // KB-319: transcript -> lines; a failed parse stays on the bill as "Not added".
  const { onTranscript, retry } = useOrderResolver({ shop: parser, bill, parse, onUtterance: (r) => wiringRef.current?.onUtterance(r) });

  // Voice needs a LIVE session (offline-session mode has none - D38).
  const voice = useVoiceBilling({
    accessToken,
    vocabulary,
    onTranscript,
    onTurn: () => wiringRef.current?.onTurn(),
    // KB-339 (D86): a spoken command, decided before parsing - "hatao" removes the last line (Undo brings it back); the rest only hint.
    onCommand: (command) => runBillCommand(command, rows, bill.remove),
    onTranscribed: (ms) => wiringRef.current?.onTranscribed(ms),
    onVoiceTiming: (t) => void (localDb && recordVoiceTiming(localDb, t)),
    onMicStart: () => warmVoice(), // KB-353: wake /voice while the person starts speaking
    notReadyReason: parser && bill.ready ? null : "Loading your catalog…",
  });
  // KB-385 (D101, D107): the V3 voice path - one path for every order. The recording is kept on the phone (voiceQueue) until its bill
  // exists, sent through Supabase Storage + /voice-run, and its answer becomes lines on the phone (aiAnswerBill), added once. It works
  // offline (queued, sent when back online); with no live session the send ends as "session" (sign in, then Retry).
  const [devSubmit] = useState(devVoiceFake);
  const submitVoice = useCallback(
    (recordingId: string, audio: Blob) =>
      devSubmit
        ? devSubmit(recordingId, audio)
        : accessToken && shop
        ? submitRecording({ client: supabase, shopId: shop.id, recordingId, audio, accessToken })
        : Promise.resolve({ kind: "failed" as const, recordingId, reason: "session" }),
    [accessToken, devSubmit, shop],
  );
  const orders = useVoiceOrders({
    db: localDb ?? null,
    shopId: shop?.id ?? null,
    billLocalId: bill.ready ? bill.localId : null,
    parser,
    submit: submitVoice,
    onAppend: (order) => {
      const w = wiringRef.current;
      w?.onTranscribed(order.waitedMs); // KB-404: Generate -> the answer (stop -> transcript)
      if (order.lines.length > 0) addToBill(order.lines, order.flags, order.transcript);
      const lines = order.lines.map((l) => ({ name: l.displayName, qty: l.item.qty, unit: l.item.unit, rate: l.item.rate, total: l.item.total }));
      w?.onUtterance({ path: lines.length > 0 ? "voice" : "failed", transcript: order.transcript, transcriptToItemsMs: lines.length > 0 ? 0 : null, lines });
    },
  });
  // KB-307: Bill Banao - one atomic local write; after it commits, start a sync (D38's loop would anyway). Neither is
  // awaited: the bill is already saved, and neither can fail it.
  // KB-307 commit 3: then learning (08 §8: after the receipt, its own
  // transaction, never able to fail the bill), then the sync - so the bill and
  // its learning rows push in one cycle.
  const { discardDraft } = bill;
  // KB-401 (KI-68): ask for persistent storage now (signed in, shop loaded) and again after each bill until granted.
  const protectStorage = usePersistentStorage(deviceDb);
  // KB-401 (D67): a waiting app update waits while the draft or the catalog is still loading.
  useUpdateGate(bill.ready && parser !== null);
  // KB-352 (owner, 28 Oct 2026): this runs a frame AFTER the receipt has painted (useFinalise starts it), never awaited by Bill Banao.
  // Learning, then the catalog reload (an alias this bill promoted reads from the next utterance on), then the sync - one step at a time,
  // each in an idle moment and each timed for the Pilot numbers panel. Only the two tiny local writes are immediate.
  const onSaved = useCallback(
    (_result: unknown, billLocalId: string) => {
      protectStorage();
      void discardDraft().catch((err: unknown) => console.warn("[billDraft] discard failed:", err));
      // KB-385: the bill exists - its recordings leave the phone and are marked billed (best effort; the 7-day clock, D105)
      if (localDb) void settleBilledRecordings(localDb, billLocalId, accessToken ? (id) => markRecordingBilled(supabase, id) : undefined).catch((err: unknown) => console.warn("[voice] settling recordings failed:", err));
      if (!localDb || !shop || !deviceId) return;
      return runAfterSave(
        {
          learn: () => learnPendingBills(localDb, shop.id),
          reload: () => reloadCatalog(),
          sync: () => syncNow({ client: supabase, localDb, shopId: shop.id, deviceId, pull: "probe" }),
        },
        (phases) => void recordPhases(localDb, billLocalId, phases),
      );
    },
    [accessToken, deviceId, discardDraft, localDb, protectStorage, shop],
  );
  // Recovery (owner): a final bill whose learning was interrupted is learned on start.
  useEffect(() => {
    if (!localDb || !shop) return;
    void learnPendingBills(localDb, shop.id).catch((err: unknown) => console.warn("[learning] recovery failed:", err));
  }, [localDb, shop]);
  // KB-351 (D92): Bill Banao takes the shop's next number from the server (one bounded round trip) - only with a live session;
  // offline, or when the server is slow, the bill saves at once with an offline number. The connection is warmed when the bill's
  // first line is added, so the first Bill Banao of a session is not the slow one.
  const getNumber = useMemo(() => (accessToken && shop ? (billLocalId: string) => requestBillNumber(supabase, shop.id, billLocalId) : undefined), [accessToken, shop]);
  const hasLines = rows.length > 0;
  useEffect(() => {
    if (hasLines && accessToken && shop) warmServer(supabase, shop.id);
  }, [hasLines, accessToken, shop]);
  const finaliser = useFinalise({ localDb, shopId: shop?.id ?? null, deviceId, getNumber, onSaved });
  const share = useReceiptShare({ localDb, saved: finaliser.saved, render: renderReceiptFiles });
  const { finalise, clear: clearSaved } = finaliser;
  const { reset: resetBill, draft } = bill;
  // KB-404: the measurement wiring (after the finaliser: it writes the bill's row once the receipt is on screen).
  const wiring = useMetricsWiring({
    localDb: localDb ?? null,
    shopId: shop?.id ?? null,
    deviceId: deviceId ?? null,
    billLocalId: bill.localId,
    ready: bill.ready,
    rows: bill.rows,
    flags: bill.flags,
    removed: draft.discarded.length,
    saved: finaliser.saved,
  });
  wiringRef.current = wiring;
  const onFinalise = useCallback(() => {
    wiring.beforeFinalise();
    void finalise(draft);
  }, [draft, finalise, wiring]);
  // App cold start (budget < 2 s): once per page load - process start to the billing screen interactive with the mic enabled.
  // KB-352: with the milestones on the way (the page, the JS, the sign-in check, the local database, the shop, the catalog, the mic).
  useEffect(() => {
    if (shop) markCold("shop");
  }, [shop]);
  const micReady = Boolean(accessToken) && parser !== null && bill.ready;
  useEffect(() => {
    if (parser && bill.ready) markCold("catalog");
    if (micReady) markCold("mic");
  }, [parser, bill.ready, micReady]);
  const coldStartDone = useRef(false);
  useEffect(() => {
    // With a live session the start is complete when the mic is enabled; with none (offline) the mic never will be - the billing screen is.
    if (!localDb || !parser || !bill.ready || coldStartDone.current || (accessToken && !micReady)) return;
    coldStartDone.current = true;
    const nav = typeof performance.getEntriesByType === "function" ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined) : undefined;
    if (!nav || (nav.type !== "navigate" && nav.type !== "reload")) return; // a back/forward restore is not a cold start
    afterPaint(() => void recordColdStart(localDb, performance.now(), undefined, { ...coldPhases(), html: nav.responseEnd, ...(navigator.serviceWorker?.controller ? { sw: 1 } : { sw: 0 }) }));
  }, [localDb, parser, bill.ready, accessToken, micReady]);
  const onNewBill = useCallback(() => {
    resetBill();
    clearSaved();
  }, [clearSaved, resetBill]);
  // KB-325 (D79): a bill is "in progress" while it has lines, a not-added utterance or a customer - and is not the one just saved.
  const billInProgress = !finaliser.saved && (bill.rows.length > 0 || bill.notAdded.length > 0 || bill.customer.name !== CASH || bill.customer.mobile !== null);
  // "Cancel and make a new bill": the cancelled bill's stored lines become the replacement's draft, under the id its cancellation points to.
  const { startFrom } = bill;
  const onReissue = useCallback(
    (billLocalId: string, replacementLocalId: string) => {
      if (!localDb) return;
      void Promise.all([localDb.bills.get(billLocalId), localDb.billItems.where("billLocalId").equals(billLocalId).sortBy("lineNo")])
        .then(([stored, items]) => {
          if (!stored) return;
          onNewBill();
          startFrom(reissueState(stored, items, replacementLocalId, new Date().toISOString()));
          setHistoryOpen(false);
        })
        .catch((err: unknown) => console.warn("[reissue] could not build the new bill:", err instanceof Error ? err.message : err));
    },
    [localDb, onNewBill, startFrom],
  );

  const onSignOut = () => {
    voice.releaseMic(); // the warm mic goes off before anything else (D45)
    // KB-404 (D80): the review capture (heard / billed pairs) is cleared when the shopkeeper signs out.
    void clearThenSignOut(localDb ?? null, shop?.id ?? null, signOut);
  };
  // KB-310: History opens over the bill - the bill in progress stays as it is.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // KB-340 (D86): the shop's name in the header; re-read when Settings closes, so a rename shows at once.
  const shopName = useShopName(localDb ?? null, shop?.id, shop?.name, `${settingsOpen}:${catalogPulls}`);
  const sync = useSyncChip(localDb);
  // KB-413 step 2 (owner, answer 1): the stopped recording on this phone, so 10 survives the app closing
  const takes = useMemo<TakeStore | undefined>(
    () =>
      localDb && shop?.id
        ? { load: () => loadRecordingDraft(localDb, shop.id), save: (tk) => saveRecordingDraft(localDb, { ...tk, shopId: shop.id }), clear: () => clearRecordingDraft(localDb, shop.id) }
        : undefined,
    [localDb, shop?.id],
  );
  return (
    <>
    <BillView
      shopName={shopName}
      lines={bill.rows}
      onSignOut={onSignOut}
      orderBar={(openAdd, noteSlot) => (
        <OrderRecorder
          orders={orders}
          shopName={shopName ?? ""}
          takes={takes}
          noteSlot={noteSlot}
          hasLines={bill.rows.length > 0}
          disabledReason={parser && bill.ready ? null : "Loading your catalog…"}
          onGenerate={(audio, ms) => (wiring.onTurn(), void orders.generate(audio, ms))}
          onAddByHand={openAdd}
        />
      )}
      orderEntries={(openAdd, part) => <OrderEntries orders={orders} onAddByHand={openAdd} part={part} />}
      onEdit={(id, field, value) => (wiring.touch(), bill.edit(id, field, value))}
      onRemove={(id) => (wiring.touch(), bill.remove(id))}
      removed={bill.removed}
      onUndo={bill.undo}
      flags={bill.flags}
      pending={bill.pending + orders.blocking.length}
      waitingRecordings={orders.waiting.length}
      onAcknowledge={(key) => (wiring.touch(), bill.acknowledge(key))}
      notAdded={bill.notAdded}
      onRetry={retry}
      onDismiss={bill.dismiss}
      catalog={parser}
      usage={shopCatalog?.usageById}
      learned={shopCatalog?.learned}
      onChangeProduct={bill.changeProduct}
      onNotThis={localDb && shop && deviceId ? (alias, catalogId) => void removeLearnedAlias(localDb, shop.id, deviceId, alias, catalogId).then(() => reloadCatalog()).catch((err: unknown) => console.warn("[learning] could not remove the alias:", err)) : undefined}
      onAddByHand={(item, name) => (wiring.touch(), bill.addByHand(item, name))}
      focusLineId={bill.focusLineId}
      customer={bill.customer}
      onCustomerName={(t) => (wiring.touch(), bill.setCustomerName(t))}
      onCustomerMobile={(t) => (wiring.touch(), bill.setCustomerMobile(t))}
      reviewMode={wiring.reviewOn}
      onFinalise={onFinalise}
      saving={finaliser.phase === "saving"}
      saved={finaliser.saved}
      saveError={finaliser.error}
      onNewBill={onNewBill}
      share={share}
      onOpenHistory={localDb && shop ? () => setHistoryOpen(true) : undefined}
      onOpenCatalog={localDb && shop && deviceId ? () => setCatalogOpen(true) : undefined}
      onOpenSettings={localDb && shop && deviceId ? () => setSettingsOpen(true) : undefined}
      syncChip={sync.chip}
      syncDetail={sync.detail}
      unsynced={sync.unsynced}
      onClearBill={() => {
        // KB-385: a cleared bill takes its recordings off the phone too (not billed - the server deletes them 7 days after upload)
        if (localDb && bill.ready) void settleBilledRecordings(localDb, bill.localId).catch(() => {});
        void bill.clearBill();
      }}
      covered={historyOpen || catalogOpen || settingsOpen}
    />
    {historyOpen && localDb && shop && (
      <HistoryScreen
        localDb={localDb}
        shopId={shop.id}
        deviceId={deviceId ?? undefined}
        billInProgress={billInProgress}
        onReissue={onReissue}
        render={renderReceiptFiles}
        onClose={() => setHistoryOpen(false)}
      />
    )}
    {settingsOpen && localDb && shop && deviceId && (
      <SettingsScreen localDb={localDb} shopId={shop.id} deviceId={deviceId} deviceDb={deviceDb} reconcile={() => reconcileBills(supabase, localDb, shop.id)} onClose={() => setSettingsOpen(false)} />
    )}
    {catalogOpen && localDb && shop && deviceId && (
      <CatalogScreen
        localDb={localDb}
        shopId={shop.id}
        save={(id, pricePaise) => saveProductPrice(supabase, localDb, shop.id, id, pricePaise)}
        add={(base) => addFromReadyCatalog(supabase, localDb, shop.id, deviceId, base)}
        importRows={(rows, onProgress) => importProducts(supabase, localDb, shop.id, deviceId, rows, onProgress)}
        saveDetails={(id, patch) => saveProductDetails(supabase, localDb, shop.id, id, patch)}
        setActive={(id, active) => setProductActive(supabase, localDb, shop.id, id, active)}
        create={(product) => addCustomProduct(supabase, localDb, shop.id, deviceId, product)}
        ignoreSuggestion={(id) => ignorePriceSuggestionFor(localDb, shop.id, id, deviceId, Date.now())}
        removeAlias={(alias, id) => removeLearnedAlias(localDb, shop.id, deviceId, alias, id)}
        onChanged={() => reloadCatalog()}
        onClose={() => setCatalogOpen(false)}
      />
    )}
    </>
  );
}

const NO_ENTRIES: never[] = [];

interface BillViewProps {
  /** KB-340 (D86): the shop's name for the header (truncated to one line); "KiranaBill" when there is none. */
  shopName?: string;
  /** KB-303: the bill is always editable - every line has a stable id. */
  lines: readonly (BillLine & { readonly id: string })[];
  onSignOut: () => void;
  /** KB-385 (D101): the V3 order recorder in the bottom bar - when given, it replaces the old mic (voice / onMicTap). */
  /** noteSlot: where the recorder's warnings go - the bill's scrolling list (KB-413 step-2 fix 1), never the bottom panel */
  orderBar?: (openAdd: () => void, noteSlot: HTMLElement | null) => ReactNode;
  /** KB-385: the bill's recordings (processing, failed, "Heard: …") under the lines. */
  /** KB-413: called twice - "heard" (the Heard cards, above the lines) and "pending" (recordings not in the bill yet, under them). */
  orderEntries?: (openAdd: (query: string) => void, part: "heard" | "pending") => ReactNode;
  voice?: VoiceView;
  onMicTap?: () => void;
  onMicPointerDown?: () => void;
  onEdit: (id: string, field: EditField, value: string) => string | null;
  onRemove: (id: string) => void;
  /** The line "Undo" would bring back, while it can. */
  removed?: { readonly displayName: string } | null;
  onUndo?: () => void;
  /** KB-304: the bill's flags, placed, and the unacknowledged HIGH count. */
  flags?: readonly ShownFlag[];
  pending?: number;
  /** KB-413 step 3 (24-Offline): how many of `pending` are recordings waiting to be read (queued or being read - not failed); when
   *  they are ALL Bill Banao waits for, the panel says "Waiting for 1 recording" and the locked button "Bill Banao after the order arrives" */
  waitingRecordings?: number;
  onAcknowledge?: (key: string) => void;
  /** KB-319: heard but not on the bill yet - Retry (text only) or dismiss. */
  notAdded?: readonly NotAdded[];
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
  /** KB-305: the SHOP's catalog to add from by hand (null while it loads), its use counts. */
  catalog?: ParserCatalog | null;
  usage?: Readonly<Record<string, { readonly useCount?: number }>>;
  /** KB-323: promoted learned aliases, for the first-use note; "Not this" removes one (a local, append-only event). */
  learned?: LearnedMap;
  onNotThis?: (alias: string, catalogId: string) => void;
  onAddByHand?: (item: ParsedItem, displayName: string) => void;
  /** KB-336 (D83): tap a line's name -> pick another product (null = done, a message = refused). Needs `catalog`. */
  onChangeProduct?: (id: string, entry: CatalogEntry) => string | null | void;
  /** KB-305: the hand-added line whose qty editor opens on arrival. */
  focusLineId?: string | null;
  /** KB-306: who the bill is for, and the editors' commits (message or null). */
  customer?: Customer;
  onCustomerName?: (text: string) => string | null;
  onCustomerMobile?: (text: string) => string | null;
  /** KB-307: Bill Banao - offered only with >=1 line and pending = 0. */
  onFinalise?: () => void;
  saving?: boolean;
  /** Set once the bill is saved: the screen turns read-only, with New bill. */
  saved?: { readonly receiptNumber: string; readonly receipt?: ReceiptModel | null } | null;
  saveError?: string | null;
  onNewBill?: () => void;
  /** KB-309: share the saved receipt (image, PDF, WhatsApp). */
  share?: ReceiptShare | null;
  /** KB-310: the ≡ menu's History. */
  onOpenHistory?: () => void;
  /** KB-311: the ≡ menu's Catalog. */
  onOpenCatalog?: () => void;
  /** KB-312: the ≡ menu's Settings. */
  onOpenSettings?: () => void;
  /** KB-313: the header chip (05 §7) and what its detail says. A status only - it never blocks billing. */
  /** KB-404 (D80): the review capture is on - a visible badge while it is. */
  reviewMode?: boolean;
  syncChip?: SyncChip | null;
  syncDetail?: { readonly pending: number; readonly conflict: number; readonly lastAttemptAt: string | null };
  /** KB-313: bills that haven't reached the server (pending) or never will on their own (conflict) - the sign-out warning. */
  unsynced?: Unsynced;
  /** KB-313: "Clear bill" in the ≡ menu - offered only while the bill has lines. */
  onClearBill?: () => void;
  /** KB-342: a full-screen overlay (History, Catalog, Settings) is open over this screen - nothing behind it may be reached by keyboard or screen reader. */
  covered?: boolean;
}

const NO_FLAGS: readonly ShownFlag[] = [];

const NONE_NOT_ADDED: readonly NotAdded[] = [];
const NO_CUSTOMER: Customer = { name: CASH, mobile: null };

/**
 * KB-319 (KI-57; owner): an utterance that was heard but isn't on the bill -
 * shown like a HIGH flag (it blocks Bill Banao: nothing said may go unbilled
 * unnoticed) until the shopkeeper taps Retry (the text only - no re-record)
 * or ✕. Several can be pending; new recordings carry on.
 */
function NotAddedList({
  entries,
  onRetry,
  onDismiss,
  onAddByHand,
}: {
  entries: readonly NotAdded[];
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
  /** KB-331: opens the add panel with this entry's words. The entry stays until Retry works or ✕ (D50). */
  onAddByHand?: (query: string) => void;
}) {
  const { t, tx } = useT();
  if (entries.length === 0) return null;
  return (
    <ul aria-label={t("notadded.list")} className="flex flex-col gap-[10px]">
      {entries.map((n) => (
        <li key={n.id} data-severity="HIGH" className="font-kb flex flex-wrap items-center gap-2 rounded-[16px] border-[1.5px] border-kb-warn-border bg-kb-warn-bg py-3 px-[14px] text-kb-14 text-kb-warn-text">
          <Icon icon={KB_ICONS.TriangleAlert} size={17} />
          <span className="sr-only">{t("flag.mustCheck")} </span>
          <span className="min-w-0 font-bold">{t("notadded.line", { text: n.transcript })}</span>
          <span className="min-w-0">{tx(n.message)}</span>
          <span className="flex w-full flex-wrap items-center gap-2">
            <button
              type="button"
              data-pending-target
              aria-label={t("retry.label", { text: n.transcript })}
              disabled={n.retrying}
              onClick={() => onRetry?.(n.id)}
              className="kb-hit kb-press flex-none whitespace-nowrap min-h-[48px] rounded-[12px] bg-kb-ink px-4 text-kb-15 font-bold text-kb-card disabled:opacity-50"
            >
              {n.retrying ? t("retry.reading") : t("retry.button")}
            </button>
            {onAddByHand && (
              <button
                type="button"
                aria-label={t("byhand.label", { text: n.transcript })}
                onClick={() => onAddByHand(n.transcript)}
                className="kb-hit flex-none whitespace-nowrap min-h-[48px] rounded-[12px] border border-kb-border bg-kb-card px-4 text-kb-15 font-bold text-kb-ink"
              >
                {t("byhand.button")}
              </button>
            )}
            <button
              type="button"
              aria-label={t("dismiss.label", { text: n.transcript })}
              onClick={() => onDismiss?.(n.id)}
              className="kb-hit-icon ml-auto flex size-11 shrink-0 items-center justify-center rounded-[10px] text-kb-sub"
            >
              <Icon icon={KB_ICONS.X} size={18} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "1 check pending", "3 checks pending". */
function checksText(n: number, t: Translate): string {
  return t(n === 1 ? "checks.one" : "checks.many", { n });
}

/**
 * KB-382 (D103 item 3b): a line wildly out of proportion. Shown like "Price needed" - red, an icon, the reason - with NO "Theek hai":
 * only an edit to the line clears it (billFlags re-checks an edited line). One warning per line: it replaces the line's HIGH check.
 */
function BlockCheck({ flags }: { flags: readonly ShownFlag[] }) {
  const { t, tx } = useT();
  return (
    <div data-severity="BLOCK" className="flex items-start gap-[6px] text-kb-14 font-bold text-kb-err">
      <Icon icon={KB_ICONS.TriangleAlert} size={17} className="mt-px" />
      <span className="sr-only">{t("flag.mustCheck")} </span>
      <span className="min-w-0">{tx(flags[0]!.message)}</span>
    </div>
  );
}

/**
 * KB-304 + KB-363b (owner, 29 Oct 2026): ONE HIGH check per line (or per what was said) - 05 §2: a red inline sentence, the most
 * important reason, short, and ONE "Theek hai" acknowledge button (13-DESIGN §6b: 1px DANGER border, transparent). Never colour
 * alone (05 §9): a triangle icon and, for screen readers, "Must check". Acknowledged, the warning AND the "Heard: ..." text collapse
 * to a tiny ✓ - the line looks normal; a tap on the ✓ shows every reason. The full list stays in the record (finalBill) either way.
 */
function HighCheck({ flags, name, transcript, onAcknowledge }: { flags: readonly ShownFlag[]; name: string | null; transcript: string | null; onAcknowledge: (flags: readonly ShownFlag[]) => void }) {
  const { t, tx } = useT();
  const [open, setOpen] = useState(false);
  if (flags.every((f) => f.acknowledged)) {
    return (
      <div data-severity="HIGH" className="text-kb-13 text-kb-sub">
        <button
          type="button"
          aria-expanded={open}
          aria-label={t("flag.checked", { name: name ?? t("flag.thisOrder") })}
          onClick={() => setOpen((o) => !o)}
          className="kb-hit-icon flex size-9 shrink-0 items-center justify-center rounded-full bg-kb-ok-pale font-bold text-kb-ok"
        >
          ✓
        </button>
        {open && (
          <div>
            {transcript && <p>{t("flag.heard", { text: transcript })}</p>}
            <ul>
              {flags.map((f) => (
                <li key={f.key}>{tx(f.message)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  const sentence = tx(checkHeadline(flags));
  return (
    <div>
      {transcript && <p className="mb-2 text-kb-13 text-kb-warn-text">{t("flag.heard", { text: transcript })}</p>}
      <div data-severity="HIGH" className="flex flex-wrap items-center gap-x-[6px] gap-y-2 text-kb-14 font-bold text-kb-warn-text">
        <Icon icon={KB_ICONS.TriangleAlert} size={17} className="self-start mt-px" />
        <span className="sr-only">{t("flag.mustCheck")} </span>
        {/* the reason keeps at least 160 px; when the row is narrower, Theek hai moves under it */}
        <span className="min-w-0 flex-[1_1_160px]">{sentence}</span>
        <button
          type="button"
          data-pending-target
          aria-label={t("flag.okLabel", { text: `${name ? `${name}: ` : ""}${sentence}` })}
          onClick={() => onAcknowledge(flags.filter((f) => !f.acknowledged))}
          className="kb-hit kb-press flex-none whitespace-nowrap min-h-[48px] rounded-[12px] bg-kb-ink px-4 text-kb-15 font-bold text-kb-card"
        >
          {t("flag.okButton")}
        </button>
      </div>
    </div>
  );
}

/**
 * KB-304: MEDIUM (an amber REVIEW badge) and LOW (a grey dot) inform, never
 * block (04 §5). Their sentences open on tap (owner: the numbers stay the
 * loudest thing on the line, 05 §8 rule 5); each carries an accessible name.
 */
function FlagNote({ severity, name, messages }: { severity: "MEDIUM" | "LOW"; name: string; messages: readonly string[] }) {
  const { t, tx } = useT();
  const [open, setOpen] = useState(false);
  const medium = severity === "MEDIUM";
  return (
    <div data-severity={severity} className="text-kb-13">
      <button
        type="button"
        aria-expanded={open}
        aria-label={medium ? t("flag.reviewLabel", { name }) : t("flag.noteLabel", { name })}
        onClick={() => setOpen((o) => !o)}
        className={
          medium
            ? "kb-hit min-h-[26px] whitespace-nowrap rounded-full bg-kb-warn-bg px-[10px] text-kb-11 font-bold tracking-[0.04em] text-kb-warn-text"
            : "kb-hit-icon flex size-7 shrink-0 items-center justify-center rounded-full"
        }
      >
        {medium ? t("flag.review") : <span aria-hidden className="size-2 rounded-full bg-kb-sub" />}
      </button>
      {open && (
        <ul className={`mt-1 ${medium ? "text-kb-warn-text" : "text-kb-sub"}`}>
          {messages.map((m) => (
            <li key={m}>{tx(m)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A line's (or an utterance's) flags: ONE HIGH check for all its HIGH reasons, then one REVIEW
 * badge and one note dot for the rest. `transcript` is the "Heard: ..." text of a bill-level group (it collapses with the check). */
function FlagList({ flags, name, transcript = null, onAcknowledge }: { flags: readonly ShownFlag[]; name: string | null; transcript?: string | null; onAcknowledge: (flags: readonly ShownFlag[]) => void }) {
  const medium = flags.filter((f) => f.severity === "MEDIUM").map((f) => f.message);
  const low = flags.filter((f) => f.severity === "LOW").map((f) => f.message);
  const block = flags.filter((f) => f.severity === "BLOCK");
  const high = flags.filter((f) => f.severity === "HIGH");
  return (
    <div className="flex flex-col gap-2">
      {block.length > 0 && <BlockCheck flags={block} />}
      {block.length === 0 && high.length > 0 && <HighCheck flags={high} name={name} transcript={transcript} onAcknowledge={onAcknowledge} />}
      {(medium.length > 0 || low.length > 0) && (
        <div className="flex flex-wrap items-start gap-2 [--kb-gap-x:8px] [--kb-gap-y:8px]">
          {medium.length > 0 && <FlagNote severity="MEDIUM" name={name ?? "this order"} messages={medium} />}
          {low.length > 0 && <FlagNote severity="LOW" name={name ?? "this order"} messages={low} />}
        </div>
      )}
    </div>
  );
}

/** KB-303 (owner, decision 3): only compatible units are offered. */
function UnitPicker({ label, fieldId, line, onPick }: { label: string; fieldId: string; line: BillLine["item"]; onPick: (unit: string) => void }) {
  return (
    <select id={fieldId} name={fieldId} aria-label={label} value={line.unit} onChange={(e) => onPick(e.target.value)} className="min-h-11 rounded-[6px] border border-line bg-surface px-1">
      {/* KB-338 (D86): "—" (no unit) is a choice on every line, for every product - it changes no number. */}
      <option value="">—</option>
      {unitChoices(line).map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The one line above the buttons: offline reason, failure, listening
 * timer, or the transcript (05-FRONTEND-SPEC.md section 2 voice states). */
function VoiceStatus({ voice, onAddByHand }: { voice: VoiceView; onAddByHand?: (query: string) => void }) {
  const { t, tx } = useT();
  const base = "min-h-6 px-4 pt-2 text-[13px]";
  if (voice.disabledReason) return <p className={`${base} text-ink-soft`}>{tx(voice.disabledReason)}</p>;
  if (voice.phase === "failed" && voice.message) {
    // KB-317 commit 5: a transcript that was heard stays visible above the failure.
    return (
      <>
        {voice.transcript && (
          <p data-testid="voice-transcript" className={`${base} text-ink`}>
            “{voice.transcript}”
          </p>
        )}
        <p role="alert" className={`${base} text-danger`}>
          {tx(voice.message)}
          {/* KB-305 / KB-331: every failure opens the add panel - the heard words in the search, or empty. It adds nothing itself. */}
          {onAddByHand && (
            <button
              type="button"
              aria-label={voice.transcript ? t("byhand.labelVoice", { text: voice.transcript }) : t("byhand.button")}
              onClick={() => onAddByHand(voice.transcript ?? "")}
              className="ml-2 min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink"
            >
              {t("byhand.button")}
            </button>
          )}
        </p>
      </>
    );
  }
  if (voice.phase === "listening") {
    return (
      <p className={`${base} text-indigo tabular-nums`}>
        {t("voice.listening")} {mmss(voice.elapsedMs)}
      </p>
    );
  }
  if (voice.phase === "transcribing") return <p className={`${base} text-ink-soft`}>{t("voice.understanding")}</p>;
  if (voice.transcript) {
    return (
      <>
        <p data-testid="voice-transcript" className={`${base} text-ink`}>
          “{voice.transcript}”
        </p>
        {voice.phase === "resolving" && <p className={`${base} text-ink-soft`}>{t("voice.understanding")}</p>}
        {voice.notice && (
          <p role="status" data-testid="voice-notice" className={`${base} text-ink-soft`}>
            {tx(voice.notice)}
          </p>
        )}
      </>
    );
  }
  return <p className={base} />;
}

function MicButton({ voice, onMicTap, onMicPointerDown }: { voice: VoiceView; onMicTap?: () => void; onMicPointerDown?: () => void }) {
  const { t } = useT();
  const cls =
    "flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] bg-indigo px-3 font-medium text-surface disabled:opacity-50";
  const icon = { size: 20, strokeWidth: 1.5, "aria-hidden": true } as const;
  if (voice.phase === "listening") {
    return (
      <button type="button" onClick={onMicTap} aria-label={t("mic.stopLabel")} className={`${cls} animate-pulse`}>
        <Square {...icon} />
        {t("mic.stop")}
      </button>
    );
  }
  if (voice.phase === "requesting") {
    return (
      <button type="button" disabled className={cls}>
        <Mic {...icon} />
        {t("mic.permission")}
      </button>
    );
  }
  if (voice.phase === "transcribing" || voice.phase === "resolving") {
    return (
      <button type="button" disabled className={cls}>
        <Loader2 {...icon} className="animate-spin" />
        {t("voice.understanding")}
      </button>
    );
  }
  return (
    <button
      type="button"
      onPointerDown={onMicPointerDown}
      onClick={onMicTap}
      disabled={!onMicTap || voice.disabledReason !== null}
      className={cls}
    >
      <Mic {...icon} />
      {t("mic.idle")}
    </button>
  );
}

export function BillView({
  lines,
  onSignOut,
  orderBar,
  orderEntries,
  voice = IDLE_VOICE,
  onMicTap,
  onMicPointerDown,
  onEdit,
  onRemove,
  removed,
  onUndo,
  flags = NO_FLAGS,
  pending = 0,
  waitingRecordings = 0,
  onAcknowledge,
  notAdded = NONE_NOT_ADDED,
  onRetry,
  onDismiss,
  catalog = null,
  usage,
  learned,
  onNotThis,
  onAddByHand,
  onChangeProduct,
  focusLineId = null,
  customer = NO_CUSTOMER,
  onCustomerName,
  onCustomerMobile,
  onFinalise,
  saving = false,
  saved = null,
  saveError = null,
  onNewBill,
  share = null,
  onOpenHistory,
  onOpenCatalog,
  onOpenSettings,
  syncChip = null,
  syncDetail,
  reviewMode,
  unsynced,
  onClearBill,
  covered,
}: BillViewProps) {
  const { t, tx } = useT();
  // KB-307: once saved, the bill is immutable - shown read-only until New bill.
  const readOnly = saved !== null;
  // KB-305: the add-item panel, and what its search starts with.
  const [addItem, setAddItem] = useState<{ query: string } | null>(null);
  const [changing, setChanging] = useState<string | null>(null); // KB-336: the line whose product is being changed
  const [confirm, setConfirm] = useState<"signout" | "clear" | null>(null);
  const canAdd = catalog !== null && onAddByHand !== undefined;
  // KB-401 (D67): a waiting app update may reload the page only while NOTHING here would be lost: an empty bill, no
  // utterance in flight, nothing typed, no saved-bill screen to leave, no panel or dialog open.
  const voiceBusy = voice.phase === "requesting" || voice.phase === "listening" || voice.phase === "transcribing" || voice.phase === "resolving";
  useUpdateGate(lines.length === 0 && notAdded.length === 0 && customer.name === CASH && customer.mobile === null && !voiceBusy && !saving && saved === null && saveError === null && addItem === null && confirm === null);
  // KB-304: flags per line, and each utterance's bill-level flags under its last line.
  const billLevelAfter = (id: string) => flags.filter((f) => f.lineId === null && f.anchorLineId === id);
  // KB-363b: a line's own reasons and the reasons about what was said (anchored under the utterance's last line) are ONE check
  const lineFlags = (id: string) => [...flags.filter((f) => f.lineId === id), ...billLevelAfter(id)];
  const nameOfLine = new Map(lines.map((l) => [l.id, l.displayName]));
  const hasHigh = (id: string) => lineFlags(id).filter((f) => f.severity === "HIGH" || f.severity === "BLOCK");

  // Screen readers (05 §9): a new HIGH flag is announced once, with the count;
  // "Theek hai" announces the new count.
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const fresh = flags.filter((f) => (f.severity === "BLOCK" || (f.severity === "HIGH" && !f.acknowledged)) && !announced.current.has(f.key));
    for (const f of flags) announced.current.add(f.key);
    if (fresh.length) {
      // one sentence per check (KB-363b), not one per reason
      const groups = new Map<string, ShownFlag[]>();
      for (const f of fresh) groups.set(checkGroupKey(f), [...(groups.get(checkGroupKey(f)) ?? []), f]);
      const said = [...groups.values()].map((g) => (g[0]!.lineId ? `${nameOfLine.get(g[0]!.lineId)}: ${tx(checkHeadline(g))}` : tx(checkHeadline(g)))).join(" ");
      setAnnouncement(`${said} ${checksText(pending, t)}.`);
    }
    // nameOfLine is derived from lines, which flags already follow
  }, [flags, pending]);
  const acknowledge = (group: readonly ShownFlag[]) => {
    for (const f of group) onAcknowledge?.(f.key);
    setAnnouncement(`${t("checks.checked")} ${checksText(pending - 1, t)}.`);
  };
  const [notThis, setNotThis] = useState<ReadonlySet<string>>(new Set());
  const noteOf = (id: string) => {
    const row = lines.find((l) => l.id === id);
    return row && !readOnly && learned && !notThis.has(id) ? learnedNoteFor(row.item.spokenName, row.item.catalogId, learned) : null;
  };
  // 05 §2: a line with an unacknowledged HIGH flag gets a 3px DANGER left
  // border; once acknowledged, a quiet LINE one.
  const needOf = (id: string) => {
    const row = lines.find((l) => l.id === id);
    return row && !readOnly ? amountNeeded(row.item) : null;
  };
  // KB-303: the editable pieces of a line - since KB-413 (owner, answer 9) they live in the line's edit sheet; the field ids say so.
  const qtyOf = (id: string, line: BillLine["item"], name: string) => (
    <EditableValue
      label={t("line.quantity", { name })}
      fieldId={`sheet-${id}-qty`}
      text={formatQty(line.qty)}
      initial={line.qty === null ? "" : String(line.qty)}
      onCommit={(v) => onEdit(id, "qty", v)}
      startOpen={editingAt?.id === id && editingAt.qtyOpen}
    />
  );
  const unitOf = (id: string, line: BillLine["item"], name: string) => (
    <UnitPicker label={t("line.unit", { name })} fieldId={`sheet-${id}-unit`} line={line} onPick={(u) => onEdit(id, "unit", u)} />
  );
  const rateOf = (id: string, line: BillLine["item"], name: string) => (
    <EditableValue label={t("line.rate", { name })} fieldId={`sheet-${id}-rate`} text={formatRate(line)} initial={paiseText(displayRate(line)?.paise ?? null)} onCommit={(v) => onEdit(id, "rate", v)} />
  );
  // KB-337 (D85): the amount is editable on EVERY line (it reversed KB-303 decision 1). Typing one makes it a total line.
  const amountOf = (id: string, line: BillLine["item"], name: string) => (
    <EditableValue label={t("line.amount", { name })} fieldId={`sheet-${id}-amount`} text={formatAmount(line.total)} initial={paiseText(line.total || null)} onCommit={(v) => onEdit(id, "amount", v)} />
  );

  // KB-307 (owner): a Bill Banao tap while checks are pending goes to the
  // first one, in bill order - a HIGH flag's "Theek hai", a missing amount or
  // quantity, then a not-added utterance's Retry.
  const itemsRef = useRef<HTMLDivElement>(null);
  const canFinalise = onFinalise !== undefined && !readOnly && !saving && lines.length > 0 && pending === 0;
  // Scrolled to the middle of the screen; the ring comes from index.css ([data-pending-target]:focus) because Chrome shows no
  // :focus-visible for focus moved by a script after a tap. (jsdom has no layout: first target.)
  const focusFirstPending = () => {
    const targets = [...(itemsRef.current?.querySelectorAll<HTMLElement>("[data-pending-target]") ?? [])];
    const target = targets.find((el) => el.getClientRects().length > 0) ?? targets[0];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center" });
    setAnnouncement(`${checksText(pending, t)}.`);
  };
  const tapBillBanao = () => {
    if (canFinalise) onFinalise?.();
    else if (pending > 0) focusFirstPending();
  };
  // Owner (decision 4): on the saved screen the mic and Add item start the next bill.
  const nextBillThen = (then?: () => void) => () => {
    onNewBill?.();
    then?.();
  };

  // The one way into the Add item panel (button, voice failure, Not-added entry); on the saved screen it starts the next bill first.
  const openAdd = canAdd ? (query: string) => (readOnly ? nextBillThen(() => setAddItem({ query }))() : setAddItem({ query })) : undefined;

  // Unpriced lines add nothing - they're "—", not ₹0 (13-DESIGN.md §6c).
  const total = sumPaise(lines.flatMap((l) => (l.item.total === null ? [] : [l.item.total])));

  // 05 §2: the most recently added line scrolls into view.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length, notAdded.length]);

  // The edit button's name is the catalog's "Edit {name}" (the same words in every language - one message, catalog.editLabel).
  // KB-413 (owner, answer 9): the line being edited in its sheet; a line added by hand opens its sheet with the quantity ready (KB-305).
  // `qtyOpen` is kept with it: the app clears focusLineId once the line is shown, before the sheet's editors mount.
  const [editingAt, setEditingAt] = useState<{ id: string; qtyOpen: boolean } | null>(null);
  const editing = editingAt?.id ?? null;
  const setEditing = (id: string | null) => setEditingAt(id ? { id, qtyOpen: false } : null);
  useEffect(() => {
    if (focusLineId && !readOnly) setEditingAt({ id: focusLineId, qtyOpen: true });
  }, [focusLineId, readOnly]);
  const editingRow = editing && !readOnly ? lines.find((l) => l.id === editing) : undefined;
  // The Price needed line's own field (rate or amount as today: the AMOUNT is what it asks for - D110 8.8; the sheet keeps the rate).
  const [needDraft, setNeedDraft] = useState<Readonly<Record<string, string>>>({});
  const [needError, setNeedError] = useState<Readonly<Record<string, string | null>>>({});
  const commitNeed = (id: string, need: "price" | "quantity") => {
    const error = onEdit(id, need === "price" ? "amount" : "qty", needDraft[id] ?? "");
    setNeedError((e) => ({ ...e, [id]: error ? tx(error) : null }));
    if (!error) setNeedDraft((d) => ({ ...d, [id]: "" }));
  };
  // "2 kg × ₹45" as drawn; a line with no rate shows only what it has ("5 kg").
  const detailOf = (line: BillLine["item"]) => {
    const qty = line.qty === null ? "—" : `${formatQty(line.qty)}${line.unit ? ` ${line.unit}` : ""}`;
    return line.rate === null ? qty : `${qty} × ${formatRate(line)}`;
  };
  const pendingId = "kb-bill-pending";
  const [noteSlot, setNoteSlot] = useState<HTMLElement | null>(null);
  // Owner, 15 Nov 2026: when everything Bill Banao waits for is one kind - lines without a price, or without a quantity - say that kind.
  const priceMissing = lines.filter((l) => needOf(l.id) === "price").length;
  const qtyMissing = lines.filter((l) => needOf(l.id) === "quantity").length;
  const onlyRecordings = pending > 0 && pending === waitingRecordings;
  const waitingFor = onlyRecordings
    ? t(pending === 1 ? "need.recOne" : "need.recMany", { n: pending })
    : pending > 0 && pending === priceMissing
      ? t(pending === 1 ? "need.priceOne" : "need.priceMany", { n: pending })
      : pending > 0 && pending === qtyMissing
        ? t(pending === 1 ? "need.qtyOne" : "need.qtyMany", { n: pending })
        : checksText(pending, t);
  const soFar = t(lines.length === 1 ? "bill.soFarOne" : "bill.soFarMany", { n: lines.length });

  return (
    <div inert={covered} aria-hidden={covered || undefined} className="font-kb h-dvh bg-kb-bg text-kb-ink">
      <div className="mx-auto flex h-full w-full max-w-[480px] flex-col">
        {/* KB-413 step 3 (24-Offline): no internet - the ink strip across the top says so, in place of the "Offline" chip */}
        {syncChip?.kind === "offline" && <OfflineStrip>{t("offline.strip")}</OfflineStrip>}
        {/* 12-BillReview's top bar (owner, answer 1): no Back arrow until Home (08) exists; today's menu stays on the right. */}
        <header className="flex items-center gap-2 pt-3 pl-4 pr-3 pb-1">
          {/* KB-413 (owner, 15 Nov 2026): "New bill" as 12-BillReview draws it - replaces KB-340's shop name in this header (the name is
              on the receipt and, with KB-414, on Home). */}
          <h1 className="min-w-0 flex-1 text-kb-18 font-bold">{readOnly ? t("bill.savedLabel") : t("bill.new")}</h1>
          <SyncChipView chip={syncChip?.kind === "offline" ? null : syncChip} detail={syncDetail} />
          {reviewMode && (
            <span data-testid="review-badge" className="flex-none whitespace-nowrap rounded-full bg-kb-muted px-[10px] py-[5px] text-kb-12 font-bold text-kb-sub">
              {t("review.badge")}
            </span>
          )}
          {!readOnly && (
            <span className="flex-none">
              <Badge kind="draft">{t("bill.draftBadge")}</Badge>
            </span>
          )}
          <HeaderMenu
            label={t("menu.label")}
            closeWhen={addItem !== null || changing !== null || confirm !== null || voiceBusy || editing !== null}
            items={[
              ...(onOpenHistory ? [{ key: "history", label: t("menu.history"), onSelect: onOpenHistory }] : []),
              ...(onOpenCatalog ? [{ key: "catalog", label: t("menu.catalog"), onSelect: onOpenCatalog }] : []),
              ...(onOpenSettings ? [{ key: "settings", label: t("menu.settings"), onSelect: onOpenSettings }] : []),
              ...(onClearBill && lines.length > 0 && !saved ? [{ key: "clear", label: t("menu.clear"), onSelect: () => setConfirm("clear" as const) }] : []),
              {
                key: "signout",
                label: t("menu.signout"),
                // 16 §2: never a silent sign-out over bills that haven't reached the server.
                onSelect: () => (unsynced && unsynced.pending + unsynced.conflict > 0 ? setConfirm("signout" as const) : onSignOut()),
              },
            ]}
          />
        </header>

        <InstallHint eligible={lines.length === 0 && !saved} />

        {confirm === "signout" && unsynced && (
          <ConfirmDialog {...signOutWarning(unsynced, lines.length > 0 && !saved)} confirmLabel={t("signout.anyway")} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); onSignOut(); }} />
        )}
        {confirm === "clear" && (
          <ConfirmDialog {...clearBillWarning(lines.length)} confirmLabel={t("menu.clear")} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); onClearBill?.(); }} />
        )}

        <div className="relative min-h-0 flex-1">
        {/* data-scroll-list: the bill list scrolls by design - the dev sheets count what its edge cuts apart from real clipping */}
        <div ref={itemsRef} data-scroll-list className="flex h-full flex-col gap-[10px] overflow-y-auto px-4 pt-1 pb-[10px]">
          {/* KB-308: after Bill Banao, the receipt of the bill as stored (KB-309 shares it). Screen 13's look is KB-413 step 4. */}
          {saved?.receipt ? (
            <div className="py-2">
              <Receipt receipt={saved.receipt} />
              {/* KB-408 S5: Print next to Share (inside the Android app only); the first copy after Bill Banao is the original. */}
              <PrintButton key={saved.receiptNumber} receipt={saved.receipt} firstIsOriginal />
              {share && <ShareBar share={share} />}
            </div>
          ) : (
          <>
          {/* KB-385: what was heard, for every recording - the Heard cards come first (12-BillReview). */}
          {orderEntries?.((query) => openAdd?.(query), "heard")}

          {/* KB-306 (D6): the customer defaults to Cash, is editable any time and never blocks or asks (hard rule 6). Mobile is optional,
              10 digits. KB-413 (owner, answer 2): a small row under the Heard card. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-kb-14">
            <span className="text-kb-13 font-semibold text-kb-sub">{t("customer.label")}</span>
            {onCustomerName && !readOnly ? (
              <EditableValue kind="text" label={t("customer.name")} fieldId="customer-name" text={customer.name} initial={customer.name} onCommit={onCustomerName} />
            ) : (
              <span>{customer.name}</span>
            )}
            {readOnly && customer.mobile && <span className="tabular-nums">{formatMobile(customer.mobile)}</span>}
            {onCustomerMobile && !readOnly && (
              <EditableValue
                kind="tel"
                label={t("customer.mobile")}
                fieldId="customer-mobile"
                text={customer.mobile ? formatMobile(customer.mobile) : t("customer.addMobile")}
                initial={customer.mobile ?? ""}
                onCommit={onCustomerMobile}
              />
            )}
          </div>

          <ul aria-label={t("bill.items")} className="flex flex-col gap-[10px]">
            {lines.map(({ item: line, displayName, id, filled }) => {
              const need = needOf(id);
              const own = lineFlags(id);
              const note = noteOf(id);
              const tone = own.some((f) => f.severity === "BLOCK") ? "err" : hasHigh(id).some((f) => !f.acknowledged) ? "warn" : "normal";
              const hasExtra = !!note || notThis.has(id) || own.length > 0;
              const extra = hasExtra ? (
                <>
                  {note && (
                    <div data-testid="learned-note" className="flex flex-wrap items-center gap-2 text-kb-13 text-kb-sub">
                      <span>{t("learned.note", { alias: note.alias, name: displayName })}</span>
                      <button
                        type="button"
                        aria-label={t("learned.notThisLabel", { name: displayName })}
                        onClick={() => {
                          setNotThis((s) => new Set(s).add(id));
                          onNotThis?.(note.alias, note.catalogId);
                        }}
                        className="kb-hit min-h-[36px] rounded-[10px] border border-kb-border bg-kb-card px-3 text-kb-13 font-bold text-kb-ink"
                      >
                        {t("learned.notThis")}
                      </button>
                    </div>
                  )}
                  {!note && notThis.has(id) && <p className="text-kb-13 text-kb-sub">{t("learned.forgotten", { name: displayName })}</p>}
                  {own.length > 0 && <FlagList flags={own} name={displayName} transcript={billLevelAfter(id)[0]?.transcript ?? null} onAcknowledge={acknowledge} />}
                </>
              ) : null;
              return (
                <li key={id}>
                  {need && !readOnly ? (
                    <PriceNeededLine
                      name={displayName}
                      detail={need === "price" ? detailOf(line) : formatAmount(line.total)}
                      needLabel={t(need === "price" ? "need.price" : "need.quantity")}
                      inputLabel={t(need === "price" ? "line.amount" : "line.quantity", { name: displayName })}
                      placeholder={t(need === "price" ? "col.amount" : "col.qty")}
                      prefix={need === "price" ? "₹" : ""}
                      inputMode={need === "price" ? "decimal" : "numeric"}
                      value={needDraft[id] ?? ""}
                      onChange={(v) => setNeedDraft((d) => ({ ...d, [id]: v }))}
                      addLabel={t("common.add")}
                      onAdd={() => commitNeed(id, need)}
                      error={needError[id] ?? null}
                      pendingTarget
                      editLabel={t("catalog.editLabel", { name: displayName })}
                      onEdit={() => setEditing(id)}
                    >
                      {extra}
                    </PriceNeededLine>
                  ) : (
                    <KitBillLine
                      name={displayName}
                      detail={detailOf(line)}
                      amount={formatAmount(line.total)}
                      mark={filled ? t(filled === "repeat" ? "filled.repeat" : "filled.shop") : undefined}
                      editLabel={t("catalog.editLabel", { name: displayName })}
                      onEdit={readOnly ? undefined : () => setEditing(id)}
                      tone={tone}
                    >
                      {extra}
                    </KitBillLine>
                  )}
                </li>
              );
            })}
          </ul>
          </>
          )}
          <NotAddedList entries={notAdded} onRetry={onRetry} onDismiss={onDismiss} onAddByHand={openAdd} />
          {orderEntries?.((query) => openAdd?.(query), "pending")}
          {/* the recorder's warnings (mic refused, nothing recorded, still loading) - in the list like a failed recording (step-2 fix 1) */}
          <div ref={setNoteSlot} className="empty:hidden" />
          {/* Add item (KB-305), dashed as drawn: disabled only while the shop catalog loads (the reason is a tooltip - a disabled button
              fires no hover events, so the title sits on a wrapper). On the saved screen it starts the next bill (decision 4). */}
          <span title={canAdd ? undefined : t("voice.loadingCatalog")}>
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => openAdd!("")}
              className="kb-hit flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-kb-border text-kb-15 font-bold text-kb-primary disabled:opacity-50"
            >
              <Icon icon={KB_ICONS.Plus} size={18} />
              {t("add.title")}
            </button>
          </span>
          <div ref={endRef} />
        </div>
        {editingRow && (
          <BottomSheet backKey="kbEditLine" title={t("catalog.editLabel", { name: editingRow.displayName })} onClose={() => setEditing(null)}>
            <div className="grid grid-cols-2 gap-3 text-kb-15">
              {(
                [
                  ["col.qty", qtyOf(editingRow.id, editingRow.item, editingRow.displayName)],
                  ["col.unit", unitOf(editingRow.id, editingRow.item, editingRow.displayName)],
                  ["col.rate", rateOf(editingRow.id, editingRow.item, editingRow.displayName)],
                  ["col.amount", amountOf(editingRow.id, editingRow.item, editingRow.displayName)],
                ] as const
              ).map(([label, editor]) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-kb-13 font-semibold text-kb-sub">{t(label)}</span>
                  {editor}
                </div>
              ))}
            </div>
            {onChangeProduct && catalog && (
              <Button
                variant="secondary"
                icon={KB_ICONS.RefreshCw}
                ariaLabel={t("line.change", { name: editingRow.displayName })}
                onClick={() => {
                  setChanging(editingRow.id);
                  setEditing(null);
                }}
              >
                {t("change.title")}
              </Button>
            )}
            <Button
              variant="destructive-text"
              icon={KB_ICONS.X}
              onClick={() => {
                onRemove(editingRow.id);
                setEditing(null);
              }}
            >
              {t("line.remove", { name: editingRow.displayName })}
            </Button>
          </BottomSheet>
        )}
        {changing && catalog && onChangeProduct && lines.some((l) => l.id === changing) && (
          <AddItemSheet
            catalog={catalog}
            usage={usage}
            billTotal={total}
            billCount={lines.length}
            change={{ name: lines.find((l) => l.id === changing)!.displayName }}
            onPick={(entry) => {
              onChangeProduct(changing, entry);
              setChanging(null);
            }}
            onClose={() => setChanging(null)}
          />
        )}
        {addItem && canAdd && (
          <AddItemSheet
            catalog={catalog}
            usage={usage}
            initialQuery={addItem.query}
            billTotal={total}
            billCount={lines.length}
            onPick={(entry) => {
              onAddByHand(manualItem(entry), entry.displayName);
              setAddItem(null);
            }}
            onCustom={(name) => {
              onAddByHand(customItem(name), name);
              setAddItem(null);
            }}
            onClose={() => setAddItem(null)}
          />
        )}
        </div>

        {/* The sticky panel (12-BillReview): what the bill adds up to, what Bill Banao waits for, and the two actions. */}
        <div className="safe-bottom flex flex-col gap-[10px] border-t border-kb-border bg-kb-card pt-[14px] px-[18px] shadow-kb-panel">
          {/* KB-303: one-level undo for a removed line (owner) - never a confirm dialog, which would be a question mid-bill (hard rule 6). */}
          {removed && onUndo && !readOnly && (
            <div role="status" className="flex items-center justify-between gap-3 text-kb-14">
              <span className="min-w-0">{t("undo.removed", { name: removed.displayName })}</span>
              <button type="button" onClick={onUndo} className="kb-hit min-h-[40px] flex-none px-3 text-kb-15 font-bold text-kb-primary">
                {t("undo.button")}
              </button>
            </div>
          )}
          {saved && (
            <div role="status" aria-label={t("bill.savedLabel")} className="flex items-center gap-2 text-kb-15 font-bold text-kb-ok">
              <Icon icon={KB_ICONS.Check} size={18} />
              <span>
                {t("bill.savedBefore")} <ReceiptNumberText value={saved.receiptNumber} /> {t("bill.savedAfter")}
              </span>
            </div>
          )}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              {!readOnly && lines.length > 0 && <div className="text-kb-13 text-kb-sub">{soFar}</div>}
              {/* Unacknowledged HIGH flags, missing amounts (KB-307) and not-added utterances (KB-319) - what Bill Banao waits for. */}
              {pending > 0 && !readOnly && (
                <p id={pendingId} data-testid="checks-pending" className={`mt-[2px] text-kb-13 font-bold ${onlyRecordings ? "text-kb-sub" : "text-kb-warn-text"}`}>
                  {waitingFor}
                </p>
              )}
              {!readOnly && lines.length === 0 && !saving && <p className="text-kb-13 text-kb-sub">{t("reason.emptyBill")}</p>}
              {saving && <p className="text-kb-13 text-kb-sub">{t("reason.saving")}</p>}
              {saveError && (
                <p role="alert" className="text-kb-13 font-bold text-kb-err">
                  {tx(saveError)}
                </p>
              )}
            </div>
            <div className="flex-none text-right">
              <span className="sr-only">{t("bill.total")} </span>
              <span data-testid="bill-total" className="whitespace-nowrap text-kb-30 font-extrabold tracking-[-0.5px] tabular-nums">
                {formatAmount(total)}
              </span>
            </div>
          </div>

          {!orderBar && <VoiceStatus voice={voice} onAddByHand={openAdd} />}
          <div data-testid="flag-announcer" aria-live="polite" className="sr-only">
            {announcement}
          </div>

          <div className="flex flex-wrap gap-[10px]">
            {orderBar ? (
              !readOnly && orderBar(() => openAdd?.(""), noteSlot)
            ) : (
              <MicButton voice={voice} onMicTap={readOnly && onMicTap ? nextBillThen(onMicTap) : onMicTap} onMicPointerDown={onMicPointerDown} />
            )}
            {readOnly ? (
              <Button variant="primary" height={56} onClick={onNewBill} className="min-w-[150px] flex-1">
                {t("bill.new")}
              </Button>
            ) : canFinalise ? (
              <Button variant="primary" height={56} onClick={tapBillBanao} className="min-w-[150px] flex-1">
                {t("bill.finalise")}
              </Button>
            ) : (
              // KB-307: aria-disabled, not disabled - a tap while checks are pending must still land, to take the shopkeeper to the first one.
              <Button variant="locked" reasonId={pending > 0 ? pendingId : undefined} lockIcon={!onlyRecordings} onClick={tapBillBanao} className="min-w-[150px] flex-1">
                {onlyRecordings ? t(pending === 1 ? "bill.afterOrder" : "bill.afterOrders") : t("bill.finalise")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
