import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Loader2, Menu, Mic, Plus, Square, TriangleAlert, X } from "lucide-react";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import type { ParsedItem } from "@/domain/grammar";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags, type ReviewFlag } from "@/domain/reviewFlags";
import { customItem, displayRate, manualItem, unitChoices } from "@/domain/billEdit";
import { amountNeeded } from "@/domain/finalBill";
import { sumPaise } from "@/domain/money";
import { buildVocabularyPrompt } from "@/domain/vocabulary";
import { loadShopCatalog, type ShopCatalog } from "@/data/shopCatalog";
import { parseTranscript } from "@/data/voiceApi";
import type { BillLine } from "@/data/voiceBilling";
import { useAuth } from "@/providers/AuthProvider";
import { usePersistentStorage } from "./usePersistentStorage";
import { useUpdateGate } from "@/pwa/updateGate";
import { useShop } from "@/providers/ShopProvider";
import { Receipt, ReceiptNumberText } from "./Receipt";
import { useReceiptShare, type ReceiptShare } from "./useReceiptShare";
import { ShareBar } from "./ShareBar";
import { HistoryScreen } from "./HistoryScreen";
import { CatalogScreen } from "./CatalogScreen";
import { SettingsScreen } from "./SettingsScreen";
import { addFromReadyCatalog, saveProductPrice } from "@/data/catalogEdit";
import { renderReceiptFiles } from "./receiptImage";
import type { Receipt as ReceiptModel } from "@/domain/receipt";
import { formatAmount, formatQty, formatRate, paiseText } from "./billFormat";
import { useBillLines, type EditField, type NotAdded, type ShownFlag } from "./useBillLines";
import { useOrderResolver } from "./useOrderResolver";
import { useFinalise } from "./useFinalise";
import { supabase } from "@/data/supabaseClient";
import { topUpReceiptBlock } from "@/data/receiptNumbers";
import { syncNow } from "@/data/sync";
import { learnPendingBills } from "@/data/learnBill";
import { AddItemSheet } from "./AddItemSheet";
import { EditableValue } from "./EditableValue";
import { SyncChipView, ConfirmDialog, signOutWarning, clearBillWarning } from "./OfflineUi";
import type { SyncChip, Unsynced } from "./syncChip";
import { useSyncChip } from "./useSyncChip";
import { IDLE_VOICE, NO_ITEM_FOUND, useVoiceBilling, type VoiceView } from "./useVoiceBilling";
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
 * from `npm run build` (VERIFY greps dist/ for "failparse"). */
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

export function BillingScreen() {
  const { signOut, session, deviceDb } = useAuth();
  const { shop, localDb, deviceId } = useShop();
  // THIS shop's catalog, from Dexie (works offline) - Layer 1, the Layer 2
  // slice, reviewFlags and the Whisper vocabulary all use it (Q2, D4).
  const [shopCatalog, setShopCatalog] = useState<ShopCatalog | null>(null);
  // KB-311: bumped after a Catalog save - new lines use the new price; lines
  // already on the bill keep their own.
  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    if (!localDb || !shop) return;
    let active = true;
    void loadShopCatalog(localDb, shop.id).then((c) => {
      if (active) setShopCatalog(c);
    });
    return () => {
      active = false;
    };
  }, [localDb, shop, catalogVersion]);
  const parser = useMemo(() => (shopCatalog ? prepareParserCatalog(shopCatalog.entries) : null), [shopCatalog]);
  const vocabulary = useMemo(
    () => (shopCatalog ? buildVocabularyPrompt(shopCatalog.entries, shopCatalog.usageById).names : []),
    [shopCatalog],
  );

  // KB-303: the bill being built - its lines, edits, removals and flags
  // (useBillLines; KB-304 will display the flags, KB-305 adds items).
  // KB-313: the half-built bill is kept in this user's own database and comes back after a reload.
  const bill = useBillLines(parser?.entries ?? NO_ENTRIES, localDb && shop ? { db: localDb, shopId: shop.id } : undefined);
  const { add: addToBill, rows } = bill;
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
  const { onTranscript, retry } = useOrderResolver({ shop: parser, bill, parse });

  // Voice needs a LIVE session (offline-session mode has none - D38).
  const voice = useVoiceBilling({
    accessToken,
    vocabulary,
    onTranscript,
    notReadyReason: parser && bill.ready ? null : "Loading your catalog…",
  });
  // KB-307: Bill Banao - one atomic local write; after it commits, top the
  // receipt block up and start a sync (D38's loop would anyway). Neither is
  // awaited: the bill is already saved, and neither can fail it.
  // KB-307 commit 3: then learning (08 §8: after the receipt, its own
  // transaction, never able to fail the bill), then the sync - so the bill and
  // its learning rows push in one cycle.
  const { discardDraft } = bill;
  // KB-401 (KI-68): ask for persistent storage now (signed in, shop loaded) and again after each bill until granted.
  const protectStorage = usePersistentStorage(deviceDb);
  // KB-401 (D67): a waiting app update waits while the draft or the catalog is still loading.
  useUpdateGate(bill.ready && parser !== null);
  const onSaved = useCallback(() => {
    protectStorage();
    void discardDraft().catch((err: unknown) => console.warn("[billDraft] discard failed:", err));
    if (!localDb || !shop || !deviceId) return;
    void topUpReceiptBlock(supabase, localDb, shop.id, deviceId).catch((err: unknown) => console.warn("[finalise] block top-up failed:", err));
    void learnPendingBills(localDb, shop.id)
      .catch((err: unknown) => console.warn("[learning] failed (the bill is saved; retried on next start):", err))
      .finally(() => void syncNow({ client: supabase, localDb, shopId: shop.id, deviceId }).catch((err: unknown) => console.warn("[finalise] sync failed:", err)));
  }, [deviceId, discardDraft, localDb, protectStorage, shop]);
  // Recovery (owner): a final bill whose learning was interrupted is learned on start.
  useEffect(() => {
    if (!localDb || !shop) return;
    void learnPendingBills(localDb, shop.id).catch((err: unknown) => console.warn("[learning] recovery failed:", err));
  }, [localDb, shop]);
  const finaliser = useFinalise({ localDb, shopId: shop?.id ?? null, deviceId, onSaved });
  const share = useReceiptShare({ localDb, saved: finaliser.saved, render: renderReceiptFiles });
  const { finalise, clear: clearSaved } = finaliser;
  const { reset: resetBill, draft } = bill;
  const onFinalise = useCallback(() => void finalise(draft), [draft, finalise]);
  const onNewBill = useCallback(() => {
    resetBill();
    clearSaved();
  }, [clearSaved, resetBill]);

  const onSignOut = () => {
    voice.releaseMic(); // the warm mic goes off before anything else (D45)
    void signOut();
  };
  // KB-310: History opens over the bill - the bill in progress stays as it is.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sync = useSyncChip(localDb);
  return (
    <>
    <BillView
      lines={bill.rows}
      onSignOut={onSignOut}
      voice={voice.view}
      onMicTap={voice.onMicTap}
      onMicPointerDown={voice.onMicPointerDown}
      onEdit={bill.edit}
      onRemove={bill.remove}
      removed={bill.removed}
      onUndo={bill.undo}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      notAdded={bill.notAdded}
      onRetry={retry}
      onDismiss={bill.dismiss}
      catalog={parser}
      usage={shopCatalog?.usageById}
      onAddByHand={bill.addByHand}
      focusLineId={bill.focusLineId}
      customer={bill.customer}
      onCustomerName={bill.setCustomerName}
      onCustomerMobile={bill.setCustomerMobile}
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
      onClearBill={() => void bill.clearBill()}
    />
    {historyOpen && localDb && shop && (
      <HistoryScreen localDb={localDb} shopId={shop.id} render={renderReceiptFiles} onClose={() => setHistoryOpen(false)} />
    )}
    {settingsOpen && localDb && shop && deviceId && (
      <SettingsScreen localDb={localDb} shopId={shop.id} deviceId={deviceId} deviceDb={deviceDb} onClose={() => setSettingsOpen(false)} />
    )}
    {catalogOpen && localDb && shop && deviceId && (
      <CatalogScreen
        localDb={localDb}
        shopId={shop.id}
        save={(id, pricePaise) => saveProductPrice(supabase, localDb, shop.id, id, pricePaise)}
        add={(base) => addFromReadyCatalog(supabase, localDb, shop.id, deviceId, base)}
        onChanged={() => setCatalogVersion((v) => v + 1)}
        onClose={() => setCatalogOpen(false)}
      />
    )}
    </>
  );
}

const NO_ENTRIES: never[] = [];

interface BillViewProps {
  /** KB-303: the bill is always editable - every line has a stable id. */
  lines: readonly (BillLine & { readonly id: string })[];
  onSignOut: () => void;
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
  onAcknowledge?: (key: string) => void;
  /** KB-319: heard but not on the bill yet - Retry (text only) or dismiss. */
  notAdded?: readonly NotAdded[];
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
  /** KB-305: the SHOP's catalog to add from by hand (null while it loads), its use counts. */
  catalog?: ParserCatalog | null;
  usage?: Readonly<Record<string, { readonly useCount?: number }>>;
  onAddByHand?: (item: ParsedItem, displayName: string) => void;
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
  syncChip?: SyncChip | null;
  syncDetail?: { readonly pending: number; readonly conflict: number; readonly lastAttemptAt: string | null };
  /** KB-313: bills that haven't reached the server (pending) or never will on their own (conflict) - the sign-out warning. */
  unsynced?: Unsynced;
  /** KB-313: "Clear bill" in the ≡ menu - offered only while the bill has lines. */
  onClearBill?: () => void;
}

const NO_FLAGS: readonly ShownFlag[] = [];

/** Whether a CSS media query matches - and keeps matching as the window changes. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
}
const NONE_NOT_ADDED: readonly NotAdded[] = [];
const NO_CUSTOMER: Customer = { name: CASH, mobile: null };

/**
 * KB-319 (KI-57; owner): an utterance that was heard but isn't on the bill -
 * shown like a HIGH flag (it blocks Bill Banao: nothing said may go unbilled
 * unnoticed) until the shopkeeper taps Retry (the text only - no re-record)
 * or ✕. Several can be pending; new recordings carry on.
 */
function NotAddedList({ entries, onRetry, onDismiss }: { entries: readonly NotAdded[]; onRetry?: (id: string) => void; onDismiss?: (id: string) => void }) {
  if (entries.length === 0) return null;
  return (
    <ul aria-label="Not added">
      {entries.map((n) => (
        <li key={n.id} data-severity="HIGH" className="flex flex-wrap items-center gap-x-2 border-b border-line border-l-[3px] border-l-danger bg-surface px-4 py-1 text-[13px] text-danger">
          <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="sr-only">Must check: </span>
          <span className="text-ink">Not added: “{n.transcript}”</span>
          <span>{n.message}</span>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-pending-target
              aria-label={`Retry “${n.transcript}”`}
              disabled={n.retrying}
              onClick={() => onRetry?.(n.id)}
              className="min-h-11 rounded-[6px] border border-danger bg-transparent px-3 font-medium text-danger disabled:opacity-50"
            >
              {n.retrying ? "Reading…" : "Retry"}
            </button>
            <button
              type="button"
              aria-label={`Dismiss “${n.transcript}”`}
              onClick={() => onDismiss?.(n.id)}
              className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft"
            >
              <X size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "1 check pending", "3 checks pending". */
function checksText(n: number): string {
  return `${n} ${n === 1 ? "check" : "checks"} pending`;
}

/**
 * KB-307 (owner, decision 2): a line with no amount can't be on a receipt.
 * Shown like a HIGH flag but with no "Theek hai" - only a value clears it.
 */
function AmountNeeded({ need }: { need: "price" | "quantity" }) {
  return (
    <div data-severity="HIGH" className="flex items-center gap-x-2 py-1 text-[13px] text-danger">
      <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
      <span className="sr-only">Must check: </span>
      <span>{need === "price" ? "Price needed" : "Quantity needed"}</span>
    </div>
  );
}

/**
 * KB-304: one HIGH flag - 05 §2: a red inline sentence and a "Theek hai"
 * acknowledge button (13-DESIGN §6b: 1px DANGER border, transparent). Never
 * colour alone (05 §9): a triangle icon and, for screen readers, "Must check".
 * Acknowledged, the sentence stays readable, muted, marked "✓ Theek hai".
 */
function HighFlag({ flag, name, onAcknowledge }: { flag: ShownFlag; name: string | null; onAcknowledge: (flag: ShownFlag) => void }) {
  return (
    <div data-severity="HIGH" className={`flex flex-wrap items-center gap-x-2 text-[13px] ${flag.acknowledged ? "text-ink-soft" : "text-danger"}`}>
      <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
      <span className="sr-only">Must check: </span>
      <span>{flag.message}</span>
      {flag.acknowledged ? (
        <span className="font-medium">✓ Theek hai</span>
      ) : (
        <button
          type="button"
          data-pending-target
          aria-label={`Theek hai — ${name ? `${name}: ` : ""}${flag.message}`}
          onClick={() => onAcknowledge(flag)}
          className="min-h-11 rounded-[6px] border border-danger bg-transparent px-3 font-medium text-danger"
        >
          Theek hai
        </button>
      )}
    </div>
  );
}

/**
 * KB-304: MEDIUM (an amber REVIEW badge) and LOW (a grey dot) inform, never
 * block (04 §5). Their sentences open on tap (owner: the numbers stay the
 * loudest thing on the line, 05 §8 rule 5); each carries an accessible name.
 */
function FlagNote({ severity, name, messages }: { severity: "MEDIUM" | "LOW"; name: string; messages: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const medium = severity === "MEDIUM";
  return (
    <div data-severity={severity} className="text-[13px]">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${medium ? "REVIEW" : "Note"} — ${name}`}
        onClick={() => setOpen((o) => !o)}
        className={
          medium
            ? "min-h-11 rounded-[6px] border border-warn px-2 text-[11px] font-semibold tracking-[0.04em] text-warn"
            : "flex size-11 items-center justify-center rounded-[6px]"
        }
      >
        {medium ? "REVIEW" : <span aria-hidden className="size-2 rounded-full bg-muted" />}
      </button>
      {open && (
        <ul className={medium ? "text-warn" : "text-ink-soft"}>
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A line's (or an utterance's) flags: every HIGH sentence, then one REVIEW
 * badge and one note dot for the rest. */
function FlagList({ flags, name, onAcknowledge }: { flags: readonly ShownFlag[]; name: string | null; onAcknowledge: (flag: ShownFlag) => void }) {
  const medium = flags.filter((f) => f.severity === "MEDIUM").map((f) => f.message);
  const low = flags.filter((f) => f.severity === "LOW").map((f) => f.message);
  return (
    <div className="flex flex-col gap-1 py-1">
      {flags
        .filter((f) => f.severity === "HIGH")
        .map((f) => (
          <HighFlag key={f.key} flag={f} name={name} onAcknowledge={onAcknowledge} />
        ))}
      {(medium.length > 0 || low.length > 0) && (
        <div className="flex flex-wrap items-start gap-2">
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
      {!line.unit && <option value="">—</option>}
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
  const base = "min-h-6 px-4 pt-2 text-[13px]";
  if (voice.disabledReason) return <p className={`${base} text-ink-soft`}>{voice.disabledReason}</p>;
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
          {voice.message}
          {/* KB-305: "Couldn't find an item — add it manually" opens the add panel with the heard words. */}
          {voice.message === NO_ITEM_FOUND && voice.transcript && onAddByHand && (
            <button
              type="button"
              aria-label={`Add “${voice.transcript}” by hand`}
              onClick={() => onAddByHand(voice.transcript!)}
              className="ml-2 min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink"
            >
              Add by hand
            </button>
          )}
        </p>
      </>
    );
  }
  if (voice.phase === "listening") {
    return (
      <p className={`${base} text-indigo tabular-nums`}>
        सुन रहे हैं… {mmss(voice.elapsedMs)}
      </p>
    );
  }
  if (voice.phase === "transcribing") return <p className={`${base} text-ink-soft`}>सुन रहे हैं…</p>;
  if (voice.transcript) {
    return (
      <p data-testid="voice-transcript" className={`${base} text-ink`}>
        “{voice.transcript}”
      </p>
    );
  }
  return <p className={base} />;
}

function MicButton({ voice, onMicTap, onMicPointerDown }: { voice: VoiceView; onMicTap?: () => void; onMicPointerDown?: () => void }) {
  const cls =
    "flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] bg-indigo px-3 font-medium text-surface disabled:opacity-50";
  const icon = { size: 20, strokeWidth: 1.5, "aria-hidden": true } as const;
  if (voice.phase === "listening") {
    return (
      <button type="button" onClick={onMicTap} aria-label="Stop recording" className={`${cls} animate-pulse`}>
        <Square {...icon} />
        रोकें
      </button>
    );
  }
  if (voice.phase === "requesting") {
    return (
      <button type="button" disabled className={cls}>
        <Mic {...icon} />
        Mic permission…
      </button>
    );
  }
  if (voice.phase === "transcribing" || voice.phase === "resolving") {
    return (
      <button type="button" disabled className={cls}>
        <Loader2 {...icon} className="animate-spin" />
        सुन रहे हैं…
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
      बोलने के लिए दबाएं
    </button>
  );
}

const label = "text-[13px] font-medium tracking-[0.02em] text-ink-soft";

export function BillView({
  lines,
  onSignOut,
  voice = IDLE_VOICE,
  onMicTap,
  onMicPointerDown,
  onEdit,
  onRemove,
  removed,
  onUndo,
  flags = NO_FLAGS,
  pending = 0,
  onAcknowledge,
  notAdded = NONE_NOT_ADDED,
  onRetry,
  onDismiss,
  catalog = null,
  usage,
  onAddByHand,
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
  unsynced,
  onClearBill,
}: BillViewProps) {
  // KB-307: once saved, the bill is immutable - shown read-only until New bill.
  const readOnly = saved !== null;
  // KB-305: the add-item panel, and what its search starts with.
  const [addItem, setAddItem] = useState<{ query: string } | null>(null);
  const [confirm, setConfirm] = useState<"signout" | "clear" | null>(null);
  const canAdd = catalog !== null && onAddByHand !== undefined;
  // KB-401 (D67): a waiting app update may reload the page only while NOTHING here would be lost: an empty bill, no
  // utterance in flight, nothing typed, no saved-bill screen to leave, no panel or dialog open.
  const voiceBusy = voice.phase === "requesting" || voice.phase === "listening" || voice.phase === "transcribing" || voice.phase === "resolving";
  useUpdateGate(lines.length === 0 && notAdded.length === 0 && customer.name === CASH && customer.mobile === null && !voiceBusy && !saving && saved === null && saveError === null && addItem === null && confirm === null);
  // Both markups are in the DOM (CSS picks one); a new line's qty editor opens
  // only in the visible one, so exactly one input takes focus.
  // KB-307 fix: follows the window - decided once at mount, it went stale when
  // the window was resized (owner's real-Chrome check).
  const wide = useMediaQuery("(min-width: 48rem)");
  // KB-304: flags per line, and each utterance's bill-level flags under its last line.
  const lineFlags = (id: string) => flags.filter((f) => f.lineId === id);
  const billLevelAfter = (id: string) => flags.filter((f) => f.lineId === null && f.anchorLineId === id);
  const nameOfLine = new Map(lines.map((l) => [l.id, l.displayName]));
  const hasHigh = (id: string) => lineFlags(id).filter((f) => f.severity === "HIGH");

  // Screen readers (05 §9): a new HIGH flag is announced once, with the count;
  // "Theek hai" announces the new count.
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const fresh = flags.filter((f) => f.severity === "HIGH" && !f.acknowledged && !announced.current.has(f.key));
    for (const f of flags) announced.current.add(f.key);
    if (fresh.length) {
      const said = fresh.map((f) => (f.lineId ? `${nameOfLine.get(f.lineId)}: ${f.message}` : f.message)).join(" ");
      setAnnouncement(`${said} ${checksText(pending)}.`);
    }
    // nameOfLine is derived from lines, which flags already follow
  }, [flags, pending]);
  const acknowledge = (flag: ShownFlag) => {
    onAcknowledge?.(flag.key);
    setAnnouncement(`Checked. ${checksText(pending - 1)}.`);
  };
  const flagsBlock = (id: string, name: string) => {
    const own = lineFlags(id);
    const need = needOf(id);
    if (own.length === 0 && !need) return null;
    return (
      <>
        {need && <AmountNeeded need={need} />}
        {own.length > 0 && <FlagList flags={own} name={name} onAcknowledge={acknowledge} />}
      </>
    );
  };
  const billLevelBlock = (id: string) => {
    const after = billLevelAfter(id);
    if (after.length === 0) return null;
    return (
      <div className="py-1">
        <p className="text-[13px] text-ink-soft">Heard: “{after[0]!.transcript}”</p>
        <FlagList flags={after} name={null} onAcknowledge={acknowledge} />
      </div>
    );
  };
  // 05 §2: a line with an unacknowledged HIGH flag gets a 3px DANGER left
  // border; once acknowledged, a quiet LINE one.
  const needOf = (id: string) => {
    const row = lines.find((l) => l.id === id);
    return row && !readOnly ? amountNeeded(row.item) : null;
  };
  const edge = (id: string) => {
    if (needOf(id)) return "border-l-[3px] border-l-danger";
    const high = hasHigh(id);
    if (high.length === 0) return "";
    return high.some((f) => !f.acknowledged) ? "border-l-[3px] border-l-danger" : "border-l-[3px] border-l-line";
  };

  // KB-303: the editable pieces of a line. `view` keeps field ids unique -
  // the card list and the table are both in the DOM (CSS picks one).
  type View = "card" | "table";
  const qtyOf = (view: View, id: string, line: BillLine["item"], name: string) =>
    readOnly ? (
      <span>{formatQty(line.qty)}</span>
    ) : (
    <EditableValue
      label={`${name} quantity`}
      fieldId={`${view}-${id}-qty`}
      text={formatQty(line.qty)}
      initial={line.qty === null ? "" : String(line.qty)}
      onCommit={(v) => onEdit(id, "qty", v)}
      startOpen={id === focusLineId && (view === "table") === wide}
      pendingTarget={amountNeeded(line) === "quantity"}
    />
    );
  const unitOf = (view: View, id: string, line: BillLine["item"], name: string) =>
    readOnly ? (
      <span>{line.unit || "—"}</span>
    ) : (
    <UnitPicker label={`${name} unit`} fieldId={`${view}-${id}-unit`} line={line} onPick={(u) => onEdit(id, "unit", u)} />
  );
  const rateOf = (view: View, id: string, line: BillLine["item"], name: string) =>
    readOnly ? (
      <span>{formatRate(line)}</span>
    ) : (
    <EditableValue label={`${name} rate`} fieldId={`${view}-${id}-rate`} text={formatRate(line)} initial={paiseText(displayRate(line)?.paise ?? null)} onCommit={(v) => onEdit(id, "rate", v)} />
  );
  // The amount is editable only where no rate exists (owner, decision 1).
  const amountOf = (view: View, id: string, line: BillLine["item"], name: string) =>
    line.rate === null && !readOnly ? (
      <EditableValue
        label={`${name} amount`}
        fieldId={`${view}-${id}-amount`}
        text={formatAmount(line.total)}
        initial={paiseText(line.total || null)}
        onCommit={(v) => onEdit(id, "amount", v)}
        pendingTarget={amountNeeded(line) === "price"}
      />
    ) : (
      formatAmount(line.total)
    );
  const removeOf = (id: string, name: string) =>
    readOnly ? null : (
    <button type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(id)} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
      <X size={18} strokeWidth={1.5} aria-hidden />
    </button>
  );

  // KB-307 (owner): a Bill Banao tap while checks are pending goes to the
  // first one, in bill order - a HIGH flag's "Theek hai", a missing amount or
  // quantity, then a not-added utterance's Retry - in the markup that's visible.
  const itemsRef = useRef<HTMLDivElement>(null);
  const canFinalise = onFinalise !== undefined && !readOnly && !saving && lines.length > 0 && pending === 0;
  // The target is the first one actually RENDERED (it has layout boxes): the
  // card list and the table are both in the DOM and CSS hides one - focusing an
  // element inside the hidden one does nothing (the owner's real-Chrome bug).
  // Scrolled to the middle of the screen; the ring comes from index.css
  // ([data-pending-target]:focus) because Chrome shows no :focus-visible for
  // focus moved by a script after a tap. (jsdom has no layout: first target.)
  const focusFirstPending = () => {
    const targets = [...(itemsRef.current?.querySelectorAll<HTMLElement>("[data-pending-target]") ?? [])];
    const target = targets.find((el) => el.getClientRects().length > 0) ?? targets[0];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center" });
    setAnnouncement(`${checksText(pending)}.`);
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

  // Unpriced lines add nothing - they're "—", not ₹0 (13-DESIGN.md §6c).
  const total = sumPaise(lines.flatMap((l) => (l.item.total === null ? [] : [l.item.total])));

  // 05 §2: the most recently added line scrolls into view.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length, notAdded.length]);

  return (
    <div className="h-dvh bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-[20px] font-semibold">KiranaBill</h1>
            <SyncChipView chip={syncChip} detail={syncDetail} />
          </div>
          <details className="relative">
            <summary
              aria-label="Menu"
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-[6px] text-ink-soft [&::-webkit-details-marker]:hidden"
            >
              <Menu size={20} strokeWidth={1.5} aria-hidden />
            </summary>
            <div className="absolute right-0 z-10 mt-1 min-w-40 rounded-[6px] border border-line bg-surface py-1">
              {onOpenHistory && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    onOpenHistory();
                  }}
                  className="block min-h-11 w-full px-4 text-left"
                >
                  History
                </button>
              )}
              {onOpenCatalog && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    onOpenCatalog();
                  }}
                  className="block min-h-11 w-full px-4 text-left"
                >
                  Catalog
                </button>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    onOpenSettings();
                  }}
                  className="block min-h-11 w-full px-4 text-left"
                >
                  Settings
                </button>
              )}
              {onClearBill && lines.length > 0 && !saved && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    setConfirm("clear");
                  }}
                  className="block min-h-11 w-full px-4 text-left"
                >
                  Clear bill
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  // 16 §2: never a silent sign-out over bills that haven't reached the server.
                  if (unsynced && unsynced.pending + unsynced.conflict > 0) setConfirm("signout");
                  else onSignOut();
                }}
                className="block min-h-11 w-full px-4 text-left"
              >
                Sign out
              </button>
            </div>
          </details>
        </header>

        {confirm === "signout" && unsynced && (
          <ConfirmDialog {...signOutWarning(unsynced, lines.length > 0 && !saved)} confirmLabel="Sign out anyway" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); onSignOut(); }} />
        )}
        {confirm === "clear" && (
          <ConfirmDialog {...clearBillWarning(lines.length)} confirmLabel="Clear bill" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); onClearBill?.(); }} />
        )}

        {/* KB-306 (D6): the customer defaults to Cash, is editable any time and
            never blocks or asks (hard rule 6). Mobile is optional, 10 digits. */}
        {/* KB-308: with the receipt shown, the customer row goes - the receipt
            prints the name, and the mobile is never on screen (D52). */}
        {!saved?.receipt && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-1">
          <span className={label}>Customer</span>
          {onCustomerName && !readOnly ? (
            <EditableValue kind="text" label="Customer name" fieldId="customer-name" text={customer.name} initial={customer.name} onCommit={onCustomerName} />
          ) : (
            <span>{customer.name}</span>
          )}
          {readOnly && customer.mobile && <span className="tabular-nums">{formatMobile(customer.mobile)}</span>}
          {onCustomerMobile && !readOnly && (
            <EditableValue
              kind="tel"
              label="Customer mobile"
              fieldId="customer-mobile"
              text={customer.mobile ? formatMobile(customer.mobile) : "+ Mobile"}
              initial={customer.mobile ?? ""}
              onCommit={onCustomerMobile}
            />
          )}
        </div>
        )}

        <div className="relative min-h-0 flex-1">
        <div ref={itemsRef} className="h-full overflow-y-auto">
          {/* KB-308: after Bill Banao, the receipt of the bill as stored (KB-309 shares it). */}
          {saved?.receipt ? (
            <div className="px-4 py-4">
              <Receipt receipt={saved.receipt} />
              {share && <ShareBar share={share} />}
            </div>
          ) : (
          <>
          {/* Mobile first: one card per line (05 §2). */}
          <ul aria-label="Bill items" className="md:hidden">
            {lines.map(({ item: line, displayName, id }) => (
              <li key={id} className={`min-h-12 border-b border-line bg-surface px-4 py-1 ${edge(id)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="capitalize">{displayName}</span>
                  <span className="ml-auto font-semibold tabular-nums">{amountOf("card", id, line, displayName)}</span>
                  {removeOf(id, displayName)}
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[13px] text-ink-soft tabular-nums">
                  {qtyOf("card", id, line, displayName)}
                  {unitOf("card", id, line, displayName)}
                  <span aria-hidden>×</span>
                  {rateOf("card", id, line, displayName)}
                </div>
                {flagsBlock(id, displayName)}
                {billLevelBlock(id)}
              </li>
            ))}
          </ul>

          {/* md and up: a table (05 §2). */}
          <table className="hidden w-full border-collapse md:table">
            <thead>
              <tr className={`border-b border-line text-left ${label}`}>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-2 py-2 text-right font-medium">Qty</th>
                <th className="px-2 py-2 font-medium">Unit</th>
                <th className="px-2 py-2 text-right font-medium">Rate</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="w-11 px-1 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ item: line, displayName, id }) => [
                <tr key={id} className="h-12 border-b border-line bg-surface">
                  <td className={`px-4 capitalize ${edge(id)}`}>{displayName}</td>
                  <td className="px-2 text-right tabular-nums">{qtyOf("table", id, line, displayName)}</td>
                  <td className="px-2">{unitOf("table", id, line, displayName)}</td>
                  <td className="px-2 text-right tabular-nums">{rateOf("table", id, line, displayName)}</td>
                  <td className="px-4 text-right font-semibold tabular-nums">{amountOf("table", id, line, displayName)}</td>
                  <td className="px-1">{removeOf(id, displayName)}</td>
                </tr>,
                (lineFlags(id).length > 0 || needOf(id)) && (
                  <tr key={`${id}-flags`} className="border-b border-line bg-surface">
                    <td colSpan={6} className={`px-4 ${edge(id)}`}>
                      {flagsBlock(id, displayName)}
                    </td>
                  </tr>
                ),
                billLevelAfter(id).length > 0 && (
                  <tr key={`${id}-heard`} className="border-b border-line bg-surface">
                    <td colSpan={6} className="border-l-[3px] border-l-danger px-4">
                      {billLevelBlock(id)}
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
          </>
          )}
          <NotAddedList entries={notAdded} onRetry={onRetry} onDismiss={onDismiss} />
          <div ref={endRef} />
        </div>
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

        {/* Pinned: TOTAL and the actions never scroll away (05 §2). */}
        <div className="flex items-baseline justify-between border-t border-line px-4 py-3">
          <span className={label}>TOTAL</span>
          <span data-testid="bill-total" className="text-[32px] font-bold tabular-nums">
            {formatAmount(total)}
          </span>
        </div>

        {/* KB-303: one-level undo for a removed line (owner) - never a confirm
            dialog, which would be a question mid-bill (hard rule 6). */}
        {saved && (
          <div role="status" aria-label="Bill saved" className="flex items-center gap-2 border-t border-line bg-surface px-4 py-2 font-medium text-ok">
            <Check size={18} strokeWidth={1.5} aria-hidden />
            <span>
              Bill <ReceiptNumberText value={saved.receiptNumber} /> saved
            </span>
          </div>
        )}

        {removed && onUndo && !readOnly && (
          <div role="status" className="flex items-center justify-between border-t border-line px-4 text-[13px]">
            <span>{removed.displayName} removed</span>
            <button type="button" onClick={onUndo} className="min-h-11 px-3 font-medium text-indigo">
              Undo
            </button>
          </div>
        )}

        <div className="border-t border-line">
          <VoiceStatus voice={voice} onAddByHand={canAdd ? (query) => setAddItem({ query }) : undefined} />
        </div>
        <div data-testid="flag-announcer" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          {/* Add item (KB-305): disabled only while the shop catalog loads; Bill
              Banao until KB-307. The reason is a tooltip only (owner, 27 Sep
              2026) - a disabled button fires no hover events, so the title sits
              on a wrapper. */}
          <MicButton voice={voice} onMicTap={readOnly && onMicTap ? nextBillThen(onMicTap) : onMicTap} onMicPointerDown={onMicPointerDown} />
          <span title={canAdd ? undefined : "Loading your catalog…"}>
            <button
              type="button"
              disabled={!canAdd}
              onClick={readOnly ? nextBillThen(() => setAddItem({ query: "" })) : () => setAddItem({ query: "" })}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink disabled:opacity-50"
            >
              <Plus size={20} strokeWidth={1.5} aria-hidden className="text-ink-soft" />
              Add item
            </button>
          </span>
          {/* Unacknowledged HIGH flags, missing amounts (KB-307) and not-added utterances (KB-319) - what Bill Banao waits for. */}
          {pending > 0 && !readOnly && (
            <p data-testid="checks-pending" className="col-span-2 text-center text-[13px] font-medium text-danger">
              {checksText(pending)}
            </p>
          )}
          {saveError && (
            <p role="alert" className="col-span-2 text-center text-[13px] font-medium text-danger">
              {saveError}
            </p>
          )}
          {readOnly ? (
            <button type="button" onClick={onNewBill} className="col-span-2 min-h-11 w-full rounded-[6px] bg-ink px-3 font-semibold text-surface">
              New bill
            </button>
          ) : (
            // KB-307: aria-disabled, not disabled - a tap while checks are pending
            // must still land, to take the shopkeeper to the first one.
            <button
              type="button"
              aria-disabled={!canFinalise}
              onClick={tapBillBanao}
              className={`col-span-2 min-h-11 w-full rounded-[6px] bg-ink px-3 font-semibold text-surface ${canFinalise ? "" : "opacity-50"}`}
            >
              Bill Banao
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
