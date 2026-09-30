import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Menu, Mic, Plus, Square } from "lucide-react";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { extractSpokenNumbers, parseUtterance } from "@/domain/grammar";
import { sumPaise } from "@/domain/money";
import type { ReviewFlag } from "@/domain/reviewFlags";
import { buildVocabularyPrompt } from "@/domain/vocabulary";
import { loadShopCatalog, type ShopCatalog } from "@/data/shopCatalog";
import { parseTranscript } from "@/data/voiceApi";
import { resolveUtterance, type BillLine } from "@/data/voiceBilling";
import { useAuth } from "@/providers/AuthProvider";
import { useShop } from "@/providers/ShopProvider";
import { formatAmount, formatQty, formatRate } from "./billFormat";
import { IDLE_VOICE, useVoiceBilling, VoiceUserError, type VoiceView } from "./useVoiceBilling";

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
  // The bill being built (KB-303/305 will edit and add to it) and every
  // review flag raised so far - stored for KB-304 to display.
  const [lines, setLines] = useState<BillLine[]>([]);
  const [, setFlags] = useState<ReviewFlag[]>([]);
  const linesRef = useRef<BillLine[]>([]);
  linesRef.current = lines;
  const utteranceCount = useRef(0);

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

  useEffect(() => {
    if (parser) setLines((current) => (current.length ? current : devTryLines(parser)));
  }, [parser]);

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
      if (resolved.lines.length === 0) throw new VoiceUserError("No items heard in that — try again");
      // Re-base each flag onto the bill's line numbers; ids stay unique per utterance.
      const offset = linesRef.current.length;
      const u = (utteranceCount.current += 1);
      setLines((current) => [...current, ...resolved.lines]);
      setFlags((current) => [
        ...current,
        ...resolved.flags.map((f) => ({ ...f, id: `u${u}-${f.id}`, itemIndex: f.itemIndex === null ? null : f.itemIndex + offset })),
      ]);
    },
    [accessToken, parser],
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
  return <BillView lines={lines} onSignOut={onSignOut} voice={voice.view} onMicTap={voice.onMicTap} onMicPointerDown={voice.onMicPointerDown} />;
}

interface BillViewProps {
  lines: readonly BillLine[];
  onSignOut: () => void;
  voice?: VoiceView;
  onMicTap?: () => void;
  onMicPointerDown?: () => void;
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
    return (
      <p role="alert" className={`${base} text-danger`}>
        {voice.message}
      </p>
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

export function BillView({ lines, onSignOut, voice = IDLE_VOICE, onMicTap, onMicPointerDown }: BillViewProps) {
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
            {lines.map(({ item: line, displayName }, i) => (
              <li key={i} className="min-h-12 border-b border-line bg-surface px-4 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="capitalize">{displayName}</span>
                  <span className="font-semibold tabular-nums">{formatAmount(line.total)}</span>
                </div>
                <div className="text-[13px] text-ink-soft tabular-nums">
                  <span>{line.qty === null ? formatQty(null) : `${formatQty(line.qty)} ${line.unit}`}</span>
                  {" × "}
                  <span>{formatRate(line)}</span>
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
              </tr>
            </thead>
            <tbody>
              {lines.map(({ item: line, displayName }, i) => (
                <tr key={i} className="h-12 border-b border-line bg-surface">
                  <td className="px-4 capitalize">{displayName}</td>
                  <td className="px-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                  <td className="px-2">{line.qty === null ? formatQty(null) : line.unit}</td>
                  <td className="px-2 text-right tabular-nums">{formatRate(line)}</td>
                  <td className="px-4 text-right font-semibold tabular-nums">{formatAmount(line.total)}</td>
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
