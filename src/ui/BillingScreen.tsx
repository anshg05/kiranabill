import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Menu, Mic, Plus, Square, X } from "lucide-react";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { extractSpokenNumbers, parseUtterance } from "@/domain/grammar";
import { displayRate, unitChoices } from "@/domain/billEdit";
import { sumPaise } from "@/domain/money";
import { buildVocabularyPrompt } from "@/domain/vocabulary";
import { loadShopCatalog, type ShopCatalog } from "@/data/shopCatalog";
import { parseTranscript } from "@/data/voiceApi";
import { resolveUtterance, type BillLine } from "@/data/voiceBilling";
import { useAuth } from "@/providers/AuthProvider";
import { useShop } from "@/providers/ShopProvider";
import { formatAmount, formatQty, formatRate, paiseText } from "./billFormat";
import { useBillLines, type EditField } from "./useBillLines";
import { IDLE_VOICE, NO_ITEM_FOUND, useVoiceBilling, VoiceUserError, type VoiceView } from "./useVoiceBilling";

// S3 (05-FRONTEND-SPEC.md §2) - KB-301 is the SHELL only: layout, the line
// list, the pinned TOTAL, the action bar. Voice (KB-302), editing (KB-303),
// flags (KB-304), add item (KB-305), customer fields (KB-306) and finalise
// (KB-307) plug into it later. Design: 13-DESIGN.md §3-§6c, §9.

/** DEV ONLY (owner, 27 Sep 2026): `?try=<utterance>` fills the bill with real
 * parseUtterance() output - against the SHOP's catalog (Q2) - so the layout
 * can be checked in a browser. `import.meta.env.DEV` is a build-time `false`
 * in production, so this branch and its call are removed from `npm run build`. */
function devTryLines(shop: ParserCatalog): BillLine[] {
  if (!import.meta.env.DEV) return [];
  const utterance = new URLSearchParams(window.location.search).get("try");
  const items = (utterance && parseUtterance(utterance, shop)) || [];
  return items.map((item) => ({ item, displayName: item.spokenName, source: "fastpath" }));
}

export function BillingScreen() {
  const { signOut, session } = useAuth();
  const { shop, localDb } = useShop();
  // THIS shop's catalog, from Dexie (works offline) - Layer 1, the Layer 2
  // slice, reviewFlags and the Whisper vocabulary all use it (Q2, D4).
  const [shopCatalog, setShopCatalog] = useState<ShopCatalog | null>(null);
  useEffect(() => {
    if (!localDb || !shop) return;
    let active = true;
    void loadShopCatalog(localDb, shop.id).then((c) => {
      if (active) setShopCatalog(c);
    });
    return () => {
      active = false;
    };
  }, [localDb, shop]);
  const parser = useMemo(() => (shopCatalog ? prepareParserCatalog(shopCatalog.entries) : null), [shopCatalog]);
  const vocabulary = useMemo(
    () => (shopCatalog ? buildVocabularyPrompt(shopCatalog.entries, shopCatalog.usageById).names : []),
    [shopCatalog],
  );

  // KB-303: the bill being built - its lines, edits, removals and flags
  // (useBillLines; KB-304 will display the flags, KB-305 adds items).
  const bill = useBillLines(parser?.entries ?? NO_ENTRIES);
  const { add: addToBill, rows } = bill;
  useEffect(() => {
    if (parser && rows.length === 0) {
      const tried = devTryLines(parser);
      if (tried.length) addToBill(tried, []);
    }
    // only when the catalog arrives - a dev ?try= bill, once
  }, [parser]);

  // DEV: the bill's flags after every change - there is no flag UI until KB-304.
  useEffect(() => {
    if (import.meta.env.DEV && bill.rows.length) {
      console.info("[bill] flags", bill.flags.map((f) => `${f.severity} ${f.code}@${f.itemIndex}`));
    }
  }, [bill.flags, bill.rows.length]);

  const accessToken = session?.access_token ?? null;
  const onTranscript = useCallback(
    async (transcript: string) => {
      if (!parser || !accessToken) throw new VoiceUserError("Couldn't hear that — try again");
      const resolved = await resolveUtterance(transcript, {
        shop: parser,
        parse: (text, catalogSlice) => parseTranscript(text, { accessToken, catalogSlice }),
      });
      if (import.meta.env.DEV) {
        console.info("[voice] resolved", {
          layer: resolved.layer,
          layer1Ms: Number(resolved.timings.layer1Ms.toFixed(2)),
          geminiMs: resolved.timings.layer2Ms === null ? null : Math.round(resolved.timings.layer2Ms),
          lines: resolved.lines.map((l) => `${l.displayName} ${l.item.qty ?? "—"} ${l.item.unit} = ${l.item.total ?? "—"}`),
          flags: resolved.flags.map((f) => `${f.severity} ${f.code}`),
          numbersHeard: extractSpokenNumbers(transcript),
        });
      }
      // KB-317 commit 5: nothing usable in the transcript - it stays on screen, with this under it.
      if (resolved.lines.length === 0) throw new VoiceUserError(NO_ITEM_FOUND);
      addToBill(resolved.lines, resolved.flags);
    },
    [accessToken, addToBill, parser],
  );

  // Voice needs a LIVE session (offline-session mode has none - D38).
  const voice = useVoiceBilling({
    accessToken,
    vocabulary,
    onTranscript,
    notReadyReason: parser ? null : "Loading your catalog…",
  });
  const onSignOut = () => {
    voice.releaseMic(); // the warm mic goes off before anything else (D45)
    void signOut();
  };
  return (
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
    />
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
}

/**
 * KB-303: a tappable value (44px) that becomes an inline number input - the
 * numeric keyboard (inputmode=decimal), Enter / blur commits, Escape cancels.
 * A rejected value keeps the input open with the reason under it; nothing
 * changes until a value is accepted.
 */
function EditableValue({ label, fieldId, text, initial, onCommit }: { label: string; fieldId: string; text: string; initial: string; onCommit: (value: string) => string | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          setDraft(initial);
          setError(null);
        }}
        className="min-h-11 min-w-11 rounded-[6px] border border-line bg-paper px-2 tabular-nums text-ink"
      >
        {text}
      </button>
    );
  }
  const commit = () => {
    const message = onCommit(draft);
    if (message) setError(message);
    else {
      setDraft(null);
      setError(null);
    }
  };
  return (
    <span className="inline-flex flex-col items-end">
      <input
        id={fieldId}
        name={fieldId}
        aria-label={label}
        inputMode="decimal"
        enterKeyHint="done"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
        // Owner: typing replaces the value; a small correction is one keystroke.
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        className="h-11 w-24 rounded-[6px] border border-line bg-surface px-2 text-right tabular-nums"
      />
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </span>
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
function VoiceStatus({ voice }: { voice: VoiceView }) {
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

export function BillView({ lines, onSignOut, voice = IDLE_VOICE, onMicTap, onMicPointerDown, onEdit, onRemove, removed, onUndo }: BillViewProps) {
  // KB-303: the editable pieces of a line. `view` keeps field ids unique -
  // the card list and the table are both in the DOM (CSS picks one).
  type View = "card" | "table";
  const qtyOf = (view: View, id: string, line: BillLine["item"], name: string) => (
    <EditableValue label={`${name} quantity`} fieldId={`${view}-${id}-qty`} text={formatQty(line.qty)} initial={line.qty === null ? "" : String(line.qty)} onCommit={(v) => onEdit(id, "qty", v)} />
  );
  const unitOf = (view: View, id: string, line: BillLine["item"], name: string) => (
    <UnitPicker label={`${name} unit`} fieldId={`${view}-${id}-unit`} line={line} onPick={(u) => onEdit(id, "unit", u)} />
  );
  const rateOf = (view: View, id: string, line: BillLine["item"], name: string) => (
    <EditableValue label={`${name} rate`} fieldId={`${view}-${id}-rate`} text={formatRate(line)} initial={paiseText(displayRate(line)?.paise ?? null)} onCommit={(v) => onEdit(id, "rate", v)} />
  );
  // The amount is editable only where no rate exists (owner, decision 1).
  const amountOf = (view: View, id: string, line: BillLine["item"], name: string) =>
    line.rate === null ? (
      <EditableValue label={`${name} amount`} fieldId={`${view}-${id}-amount`} text={formatAmount(line.total)} initial={paiseText(line.total || null)} onCommit={(v) => onEdit(id, "amount", v)} />
    ) : (
      formatAmount(line.total)
    );
  const removeOf = (id: string, name: string) => (
    <button type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(id)} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
      <X size={18} strokeWidth={1.5} aria-hidden />
    </button>
  );

  // Unpriced lines add nothing - they're "—", not ₹0 (13-DESIGN.md §6c).
  const total = sumPaise(lines.flatMap((l) => (l.item.total === null ? [] : [l.item.total])));

  // 05 §2: the most recently added line scrolls into view.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length]);

  return (
    <div className="h-dvh bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center justify-between border-b border-line px-4 py-2">
          <h1 className="text-[20px] font-semibold">KiranaBill</h1>
          <details className="relative">
            <summary
              aria-label="Menu"
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-[6px] text-ink-soft [&::-webkit-details-marker]:hidden"
            >
              <Menu size={20} strokeWidth={1.5} aria-hidden />
            </summary>
            <div className="absolute right-0 z-10 mt-1 min-w-40 rounded-[6px] border border-line bg-surface py-1">
              <button type="button" onClick={onSignOut} className="block min-h-11 w-full px-4 text-left">
                Sign out
              </button>
            </div>
          </details>
        </header>

        {/* Customer defaults to Cash and never blocks (hard rule 6). KB-306 makes it editable. */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          <span className={label}>Customer</span>
          <span>Cash</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Mobile first: one card per line (05 §2). */}
          <ul aria-label="Bill items" className="md:hidden">
            {lines.map(({ item: line, displayName, id }) => (
              <li key={id} className="min-h-12 border-b border-line bg-surface px-4 py-1">
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
              {lines.map(({ item: line, displayName, id }) => (
                <tr key={id} className="h-12 border-b border-line bg-surface">
                  <td className="px-4 capitalize">{displayName}</td>
                  <td className="px-2 text-right tabular-nums">{qtyOf("table", id, line, displayName)}</td>
                  <td className="px-2">{unitOf("table", id, line, displayName)}</td>
                  <td className="px-2 text-right tabular-nums">{rateOf("table", id, line, displayName)}</td>
                  <td className="px-4 text-right font-semibold tabular-nums">{amountOf("table", id, line, displayName)}</td>
                  <td className="px-1">{removeOf(id, displayName)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={endRef} />
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
        {removed && onUndo && (
          <div role="status" className="flex items-center justify-between border-t border-line px-4 text-[13px]">
            <span>{removed.displayName} removed</span>
            <button type="button" onClick={onUndo} className="min-h-11 px-3 font-medium text-indigo">
              Undo
            </button>
          </div>
        )}

        <div className="border-t border-line">
          <VoiceStatus voice={voice} />
        </div>

        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          {/* Add item / Bill Banao: disabled until KB-305 / KB-307; the reason is
              a tooltip only (owner, 27 Sep 2026). A disabled button fires no
              hover events, so the title sits on a wrapper. */}
          <MicButton voice={voice} onMicTap={onMicTap} onMicPointerDown={onMicPointerDown} />
          <span title="Adding items isn't available yet">
            <button
              type="button"
              disabled
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink disabled:opacity-50"
            >
              <Plus size={20} strokeWidth={1.5} aria-hidden className="text-ink-soft" />
              Add item
            </button>
          </span>
          <span title="Finalising isn't available yet" className="col-span-2">
            <button
              type="button"
              disabled
              className="min-h-11 w-full rounded-[6px] bg-ink px-3 font-semibold text-surface disabled:opacity-50"
            >
              Bill Banao
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
