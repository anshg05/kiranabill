import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { KiranaBillDB, LocalBaseProduct, LocalProvisionalProduct, LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { ImportOutcome, ImportRow } from "@/data/catalogImport";
import { listPendingPriceSuggestions, listProvisionalProducts } from "@/data/learningAudit";
import { loadShopCatalog } from "@/data/shopCatalog";
import { MAX_RATE_PAISE, parseMoneyInput } from "@/domain/billEdit";
import { prepareParserCatalog, searchCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import type { PriceSuggestion } from "@/domain/learning";
import { formatRupees } from "@/domain/money";
import { CatalogImportSheet } from "./CatalogImportSheet";
import { EditableValue } from "./EditableValue";
import { useBackEntry } from "./useBackEntry";
import { priceDriftText } from "./priceDriftText";
import { useBrowserOnline } from "./useBrowserOnline";

// KB-311 (owner, 8 Oct 2026): S4 Catalog, over the bill in progress.
// - Rows: this shop's active products, most used first, then by name. Search
//   is the Add item index (aliases included); filters by source.
// - Edits are ONLINE only (Q1): a price edit and "Add from ready catalog" go
//   through `save` / `add` (data/catalogEdit.ts - Postgres, then the re-pull).
//   This screen never writes Dexie; it re-reads it after a write.
// - Suggestions (only here, never in billing): a price paid on 3 bills,
//   applied only by a tap through the same save; provisional products are
//   read-only (KB-320 saves them).

type Filter = "all" | LocalShopProduct["source"];
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
  { value: "learned", label: "Learned" },
  { value: "base", label: "From base catalog" },
];
const READY_SHOWN = 100;
const OFFLINE = "Needs internet to change the catalog";
const SAVE_FAILED = "Couldn't save — check the internet and try again";

const priceText = (paise: number, unit: string) => `${formatRupees(paise)} / ${unit}`;
const usedText = (n: number) => (n === 0 ? "Not used yet" : n === 1 ? "Used once" : `Used ${n} times`);
const byUseThenName = (a: LocalShopProduct, b: LocalShopProduct) => b.useCount - a.useCount || a.displayName.localeCompare(b.displayName);

interface CatalogScreenProps {
  localDb: KiranaBillDB;
  shopId: string;
  save: (productId: string, pricePaise: number) => Promise<CatalogWriteResult>;
  add: (base: LocalBaseProduct) => Promise<CatalogWriteResult>;
  /** KB-314: bulk import from a file (data/catalogImport.ts). Absent = no "Import from file". */
  importRows?: (rows: ImportRow[], onProgress: (done: number, total: number) => void) => Promise<ImportOutcome>;
  /** After a write the server accepted - billing reloads its catalog (new lines use it). */
  onChanged: () => void;
  onClose: () => void;
}

interface Loaded {
  products: LocalShopProduct[]; // active, this shop
  all: LocalShopProduct[]; // incl. inactive - for "already in the shop"
  parser: ParserCatalog;
  suggestions: readonly PriceSuggestion[];
  provisional: LocalProvisionalProduct[];
}

export function CatalogScreen({ localDb, shopId, save, add, importRows, onChanged, onClose }: CatalogScreenProps) {
  useBackEntry("kbCatalog", onClose);
  const online = useBrowserOnline();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [readyOpen, setReadyOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const reload = useCallback(async () => {
    const [all, catalog, suggestions, provisional] = await Promise.all([
      localDb.shopProducts.where("shopId").equals(shopId).toArray(),
      loadShopCatalog(localDb, shopId),
      listPendingPriceSuggestions(localDb, shopId, Date.now()),
      listProvisionalProducts(localDb, shopId),
    ]);
    setLoaded({
      all,
      products: all.filter((p) => p.isActive),
      parser: prepareParserCatalog(catalog.entries),
      suggestions,
      provisional: provisional.filter((p) => p.promotedAt === null),
    });
  }, [localDb, shopId]);

  useEffect(() => {
    reload().catch((err: unknown) => console.warn("[catalog] load failed:", err instanceof Error ? err.message : err));
  }, [reload]);

  const savePrice = (p: LocalShopProduct, pricePaise: number) => {
    setSaving((s) => new Set(s).add(p.id));
    setFailed((s) => without(s, p.id));
    save(p.id, pricePaise)
      .then(async (r) => {
        if (!r.ok) return setFailed((s) => new Set(s).add(p.id));
        await reload();
        onChanged();
      })
      .catch(() => setFailed((s) => new Set(s).add(p.id)))
      .finally(() => setSaving((s) => without(s, p.id)));
  };

  const typed = query.trim();
  const shown = useMemo(() => {
    if (!loaded) return [];
    const byId = new Map(loaded.products.map((p) => [p.id, p]));
    const usage = Object.fromEntries(loaded.products.map((p) => [p.id, { useCount: p.useCount }]));
    const list = [...typed].length >= 2
      ? searchCatalog(loaded.parser, typed, usage, loaded.products.length).flatMap((r) => byId.get(r.entry.id) ?? [])
      : [...loaded.products].sort(byUseThenName);
    return filter === "all" ? list : list.filter((p) => p.source === filter);
  }, [loaded, typed, filter]);

  const productById = useMemo(() => new Map(loaded?.products.map((p) => [p.id, p])), [loaded]);
  const priceSuggestions = (loaded?.suggestions ?? []).flatMap((s) => {
    const p = productById.get(s.catalogId);
    return p && p.pricePaise !== s.suggestedPricePaise ? [{ s, p }] : [];
  });
  const hasSuggestions = priceSuggestions.length > 0 || (loaded?.provisional.length ?? 0) > 0;

  return (
    <section aria-label="Catalog" className="fixed inset-0 z-20 flex flex-col bg-paper text-ink text-[15px]">
      <div inert={readyOpen || importOpen} aria-hidden={readyOpen || importOpen || undefined} className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Catalog</h2>
        </header>
        <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
          {!online && <p className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">{OFFLINE}</p>}
          <input
            type="search"
            aria-label="Search products"
            placeholder="Name or what customers say"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 w-full rounded-[6px] border border-line bg-surface px-3"
          />
          <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <label key={f.value} className="flex min-h-11 cursor-pointer items-center rounded-[6px] border border-line px-3 has-checked:border-ink has-checked:bg-ink has-checked:text-paper">
                <input type="radio" name="catalog-filter" value={f.value} checked={filter === f.value} onChange={() => setFilter(f.value)} className="sr-only" />
                {f.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={!online}
              onClick={online ? () => setReadyOpen(true) : undefined}
              className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
            >
              Add from ready catalog
            </button>
            {importRows && (
              <button
                type="button"
                aria-disabled={!online}
                onClick={online ? () => setImportOpen(true) : undefined}
                className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
              >
                Import from file
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {hasSuggestions && loaded && (
            <section aria-label="Suggestions" className="border-b border-line px-4 py-3">
              <h3 className="text-[13px] font-medium tracking-[0.02em] text-ink-soft">Suggestions</h3>
              <ul className="mt-1 flex flex-col gap-2">
                {priceSuggestions.map(({ s, p }) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {priceDriftText(p.displayName, p.unit, s.suggestedPricePaise, s.observationCount, p.pricePaise)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Use ${formatRupees(s.suggestedPricePaise)} for ${p.displayName}`}
                      aria-disabled={!online || saving.has(p.id)}
                      onClick={online && !saving.has(p.id) ? () => savePrice(p, s.suggestedPricePaise) : undefined}
                      className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium aria-disabled:opacity-50"
                    >
                      Use {formatRupees(s.suggestedPricePaise)}
                    </button>
                  </li>
                ))}
                {loaded.provisional.map((p) => (
                  <li key={p.localId} className="text-ink-soft [overflow-wrap:anywhere]">
                    “{p.spokenName}” — said {p.seenCount} times, not in the catalog
                  </li>
                ))}
              </ul>
            </section>
          )}
          {loaded && loaded.products.length > 0 && shown.length === 0 && (
            <p className="px-4 py-6 text-center">{typed ? "No products found." : "No products of this kind."}</p>
          )}
          {loaded && loaded.products.length === 0 && !typed && (
            <p className="px-4 py-6 text-center">No products yet — add them from the ready catalog or import a file.</p>
          )}
          {loaded && (
            <ul aria-label="Products">
              {shown.map((p) => (
                <li key={p.id} className="flex min-h-12 items-center gap-3 border-b border-line bg-surface px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span data-testid="name" className="block font-medium [overflow-wrap:anywhere]">{p.displayName}</span>
                    <span className="block text-[13px] text-ink-soft">{usedText(p.useCount)}</span>
                  </span>
                  <span className="flex flex-col items-end">
                    {online && !saving.has(p.id) ? (
                      <EditableValue
                        label={`Price of ${p.displayName}`}
                        fieldId={`price-${p.id}`}
                        text={priceText(p.pricePaise, p.unit)}
                        initial={formatRupees(p.pricePaise).slice(1)}
                        onCommit={(text) => {
                          const r = parseMoneyInput(text, MAX_RATE_PAISE);
                          if (!r.ok) return r.error;
                          if (r.value !== p.pricePaise) savePrice(p, r.value);
                          return null;
                        }}
                      />
                    ) : (
                      <span className="tabular-nums">{priceText(p.pricePaise, p.unit)}</span>
                    )}
                    {saving.has(p.id) && <span className="text-[13px] text-ink-soft">Saving…</span>}
                    {failed.has(p.id) && (
                      <span role="alert" className="text-[13px] text-danger">
                        {SAVE_FAILED}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {importOpen && loaded && importRows && (
        <CatalogImportSheet
          existing={loaded.all}
          online={online}
          run={async (rows, onProgress) => {
            const outcome = await importRows(rows, onProgress);
            await reload(); // even a stopped run may have added some
            if (outcome.added > 0) onChanged();
            return outcome;
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
      {readyOpen && loaded && (
        <ReadyCatalog
          localDb={localDb}
          inShop={loaded.all}
          online={online}
          add={async (b) => {
            const r = await add(b);
            if (r.ok || r.reason === "duplicate") await reload(); // a duplicate's row was just re-pulled
            if (r.ok) onChanged();
            return r;
          }}
          onClose={() => setReadyOpen(false)}
        />
      )}
    </section>
  );
}

function without(s: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(s);
  next.delete(id);
  return next;
}

/** The base products not yet in the shop (by base id or by name); Add copies one in at its suggested price. */
function ReadyCatalog({ localDb, inShop, online, add, onClose }: {
  localDb: KiranaBillDB;
  inShop: readonly LocalShopProduct[];
  online: boolean;
  add: (base: LocalBaseProduct) => Promise<CatalogWriteResult>;
  onClose: () => void;
}) {
  useBackEntry("kbReadyCatalog", onClose);
  const [bases, setBases] = useState<LocalBaseProduct[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    localDb.baseProducts
      .toArray()
      .then((b) => live && setBases(b.filter((x) => x.isActive).sort((x, y) => x.displayName.localeCompare(y.displayName))))
      .catch((err: unknown) => console.warn("[catalog] ready catalog load failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [localDb]);

  const typed = query.trim();
  const { available, matched } = useMemo(() => {
    const ids = new Set(inShop.flatMap((p) => (p.baseProductId ? [p.baseProductId] : [])));
    const names = new Set(inShop.map((p) => p.displayName.toLowerCase()));
    const q = typed.toLowerCase();
    const matching = (bases ?? []).filter((b) => !q || [b.displayName, ...b.aliases].some((a) => a.toLowerCase().includes(q)));
    return { matched: matching.length, available: matching.filter((b) => !ids.has(b.id) && !names.has(b.displayName.toLowerCase())) };
  }, [bases, inShop, typed]);

  const onAdd = (b: LocalBaseProduct) => {
    setBusy(b.id);
    setMessage(null);
    add(b)
      .then((r) =>
        setMessage(
          r.ok
            ? { text: `${b.displayName} added — ${priceText(b.suggestedPricePaise, b.defaultUnit)}`, error: false }
            : { text: r.reason === "duplicate" ? `${b.displayName} is already in your catalog` : "Couldn't add — check the internet and try again", error: true },
        ),
      )
      .catch(() => setMessage({ text: "Couldn't add — check the internet and try again", error: true }))
      .finally(() => setBusy(null));
  };

  return (
    <section aria-label="Ready catalog" className="fixed inset-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Ready catalog</h2>
        </header>
        <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
          {!online && <p className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">{OFFLINE}</p>}
          <input
            type="search"
            aria-label="Search ready catalog"
            placeholder="Name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 w-full rounded-[6px] border border-line bg-surface px-3"
          />
          {message && (
            <p role={message.error ? "alert" : "status"} className={`text-[13px] ${message.error ? "text-danger" : "text-ink-soft"}`}>
              {message.text}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {bases !== null && bases.length === 0 && <p className="px-4 py-6 text-center">The ready catalog isn't on this phone yet.</p>}
          {bases !== null && bases.length > 0 && available.length === 0 && (
            <p className="px-4 py-6 text-center [overflow-wrap:anywhere]">
              {!typed
                ? "Your shop already has every product in the ready catalog."
                : matched > 0
                  ? `“${typed}” is already in your catalog.`
                  : `No ready product matches “${typed}”. Add it from a bill: Add item → + Add “${typed}” as a new product.`}
            </p>
          )}
          <ul aria-label="Ready products">
            {available.slice(0, READY_SHOWN).map((b) => (
              <li key={b.id} className="flex min-h-12 items-center gap-3 border-b border-line bg-surface px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span data-testid="ready-name" className="block font-medium [overflow-wrap:anywhere]">{b.displayName}</span>
                  <span className="block text-[13px] tabular-nums text-ink-soft">{priceText(b.suggestedPricePaise, b.defaultUnit)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Add ${b.displayName}`}
                  aria-disabled={!online || busy !== null}
                  onClick={online && busy === null ? () => onAdd(b) : undefined}
                  className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
                >
                  {busy === b.id ? "Adding…" : "Add"}
                </button>
              </li>
            ))}
          </ul>
          {available.length > READY_SHOWN && (
            <p className="px-4 py-4 text-center text-[13px] text-ink-soft">
              Showing {READY_SHOWN} of {available.length} — search to find more.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
