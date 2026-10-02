import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CatalogEntry } from "@/domain/catalog";
import { searchCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { displayRate } from "@/domain/billEdit";
import { formatRupees, type Paise } from "@/domain/money";
import { formatAmount } from "./billFormat";

// KB-305 (05 S3a; owner, 2 Oct 2026): add an item by hand. A NON-modal panel
// over the item list - TOTAL, the mic and Bill Banao stay visible and usable
// (05 §8 rule 1: no modal between the mic and the receipt). Type-ahead over
// the SHOP's catalog; a tap adds at once. "+ Add “x” as a new product" adds a
// bill line only - never a shop_product (L1 at KB-307+, owner decision 2).

/** The catalog price as shown: per the coarser unit (SG-09) - "₹45/kg". */
function priceText(entry: CatalogEntry): string {
  const shown = displayRate({ rate: entry.suggestedPricePaise, rateUnit: entry.unit, unit: entry.unit });
  return shown ? `${formatRupees(shown.paise)}/${shown.unit}` : "—";
}

const sameWords = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The matched alias is shown only when it explains an unexpected result
 * ("chi" -> "Poha · chiwda") - not when it's the name or what was typed. */
const aliasWorthShowing = (alias: string, name: string, typed: string) => !sameWords(alias, name) && !sameWords(alias, typed);

/** History-entry marker: the Android back gesture closes the panel instead of
 * leaving the app (owner) - the bill isn't saved until KB-313. */
const HISTORY_KEY = "kbAddItem";

export interface AddItemSheetProps {
  catalog: ParserCatalog;
  usage?: Readonly<Record<string, { readonly useCount?: number }>>;
  /** Pre-filled and selected - typing replaces it ("Couldn't find an item"). */
  initialQuery?: string;
  billTotal: Paise;
  billCount: number;
  onPick: (entry: CatalogEntry) => void;
  onCustom: (name: string) => void;
  onClose: () => void;
}

export function AddItemSheet({ catalog, usage, initialQuery = "", billTotal, billCount, onPick, onCustom, onClose }: AddItemSheetProps) {
  const [query, setQuery] = useState(initialQuery);
  const results = useMemo(() => searchCatalog(catalog, query, usage), [catalog, query, usage]);

  // Android back: a history entry while open; popstate closes. A normal close
  // takes the entry back off, so the next back isn't swallowed. StrictMode
  // (dev) mounts, unmounts and re-mounts at once: the entry is pushed once, and
  // the unmount's back() is deferred so the re-mount can cancel it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const entry = useRef<{ token: string; pendingBack: ReturnType<typeof setTimeout> | null } | null>(null);
  useEffect(() => {
    if (!entry.current) {
      entry.current = { token: crypto.randomUUID(), pendingBack: null };
      // Re-opened before the last close's back() ran: take over its entry, never stack a second.
      const current = window.history.state as Record<string, unknown> | null;
      if (typeof current?.[HISTORY_KEY] === "string") window.history.replaceState({ [HISTORY_KEY]: entry.current.token }, "");
      else window.history.pushState({ [HISTORY_KEY]: entry.current.token }, "");
    }
    const mine = entry.current;
    if (mine.pendingBack) clearTimeout(mine.pendingBack);
    mine.pendingBack = null;
    const onOurEntry = () => (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY] === mine.token;
    let closedByBack = false;
    const onPop = () => {
      if (onOurEntry()) return; // came forward onto it again - nothing to close
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedByBack) mine.pendingBack = setTimeout(() => onOurEntry() && window.history.back(), 0);
    };
  }, []);

  const typed = query.trim();
  return (
    <section
      aria-label="Add item"
      className="absolute inset-0 z-10 flex flex-col border-t border-line bg-surface shadow-[0_-1px_0_var(--color-line),0_-8px_24px_rgb(0_0_0/0.08)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4">
        <span className="text-[13px] text-ink-soft tabular-nums">
          Bill so far · {formatAmount(billTotal)} · {billCount} {billCount === 1 ? "item" : "items"}
        </span>
        <button type="button" aria-label="Close add item" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
          <X size={18} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="px-4 py-2">
        <input
          type="search"
          id="add-item-search"
          name="add-item-search"
          aria-label="Search products"
          placeholder="Search — chini, चीनी…"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="h-11 w-full rounded-[6px] border border-line bg-paper px-3"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul aria-label="Products">
          {results.map(({ entry, alias }) => (
            <li key={entry.id}>
              <button type="button" onClick={() => onPick(entry)} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-line px-4 text-left">
                <span>
                  {entry.displayName}
                  {aliasWorthShowing(alias, entry.displayName, query) && <span className="text-[13px] text-ink-soft"> · {alias}</span>}
                </span>
                <span className="tabular-nums text-ink-soft">{priceText(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
        {typed && (
          <button type="button" onClick={() => onCustom(typed)} className="min-h-11 w-full px-4 text-left font-medium text-indigo">
            + Add “{typed}” as a new product
          </button>
        )}
      </div>
    </section>
  );
}
