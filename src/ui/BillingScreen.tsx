import { useEffect, useRef, useState } from "react";
import { Menu, Mic, Plus } from "lucide-react";
import { parseUtterance, type ParsedItem } from "@/domain/grammar";
import { sumPaise } from "@/domain/money";
import { useAuth } from "@/providers/AuthProvider";
import { formatAmount, formatQty, formatRate } from "./billFormat";

// S3 (05-FRONTEND-SPEC.md §2) - KB-301 is the SHELL only: layout, the line
// list, the pinned TOTAL, the action bar. Voice (KB-302), editing (KB-303),
// flags (KB-304), add item (KB-305), customer fields (KB-306) and finalise
// (KB-307) plug into it later. Design: 13-DESIGN.md §3-§6c, §9.

/** DEV ONLY (owner, 27 Sep 2026): `?try=<utterance>` fills the bill with real
 * parseUtterance() output so the layout can be checked in a browser before
 * voice exists. `import.meta.env.DEV` is a build-time `false` in production,
 * so this branch and its call are removed from `npm run build`. */
function devTryLines(): ParsedItem[] {
  if (!import.meta.env.DEV) return [];
  const utterance = new URLSearchParams(window.location.search).get("try");
  return (utterance && parseUtterance(utterance)) || [];
}

export function BillingScreen() {
  const { signOut } = useAuth();
  // The bill being built. KB-302/303/305 write into it; the shell only reads.
  const [lines] = useState<ParsedItem[]>(devTryLines);
  return <BillView lines={lines} onSignOut={() => void signOut()} />;
}

interface BillViewProps {
  lines: readonly ParsedItem[];
  onSignOut: () => void;
}

const label = "text-[13px] font-medium tracking-[0.02em] text-ink-soft";

export function BillView({ lines, onSignOut }: BillViewProps) {
  // Unpriced lines add nothing - they're "—", not ₹0 (13-DESIGN.md §6c).
  const total = sumPaise(lines.flatMap((l) => (l.total === null ? [] : [l.total])));

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
            {lines.map((line, i) => (
              <li key={i} className="min-h-12 border-b border-line bg-surface px-4 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="capitalize">{line.spokenName}</span>
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
              {lines.map((line, i) => (
                <tr key={i} className="h-12 border-b border-line bg-surface">
                  <td className="px-4 capitalize">{line.spokenName}</td>
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

        <div className="grid grid-cols-2 gap-2 border-t border-line px-4 py-3">
          {/* Disabled until their tickets land; the reason is a tooltip only
              (owner, 27 Sep 2026). A disabled button fires no hover events,
              so the title sits on a wrapper. */}
          <span title="Voice billing isn't available yet">
            <button
              type="button"
              disabled
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] bg-indigo px-3 font-medium text-surface disabled:opacity-50"
            >
              <Mic size={20} strokeWidth={1.5} aria-hidden />
              बोलने के लिए दबाएं
            </button>
          </span>
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
