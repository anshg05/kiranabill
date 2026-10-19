import { deriveShopAliases } from "@/data/aliasEvidence";
import { PROMOTE_AT } from "@/domain/aliasEvidence";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { KiranaBillDB, LocalBaseProduct, LocalProvisionalProduct, LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { ImportOutcome, ImportRow } from "@/data/catalogImport";
import type { NewProduct, OtherProduct, ProductPatch } from "@/domain/catalogEdit";
import { listPendingPriceSuggestions, listProvisionalProducts } from "@/data/learningAudit";
import { loadShopCatalog } from "@/data/shopCatalog";
import { MAX_RATE_PAISE, parseMoneyInput } from "@/domain/billEdit";
import { nameKey } from "@/domain/catalogImport";
import { prepareParserCatalog, searchCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import type { PriceSuggestion } from "@/domain/learning";
import { formatRupees } from "@/domain/money";
import { CatalogImportSheet } from "./CatalogImportSheet";
import { AddProductSheet } from "./AddProductSheet";
import { EditProductSheet, SAVE_FAILED_TEXT } from "./EditProductSheet";
import { EditableValue } from "./EditableValue";
import { useBackEntry } from "./useBackEntry";
import { useBrowserOnline } from "./useBrowserOnline";
import { useT, type Translate } from "./useT";

// KB-311 (owner, 8 Oct 2026): S4 Catalog, over the bill in progress.
// - Rows: this shop's active products, most used first, then by name. Search
//   is the Add item index (aliases included); filters by source.
// - Edits are ONLINE only (Q1): a price edit and "Add from ready catalog" go
//   through `save` / `add` (data/catalogEdit.ts - Postgres, then the re-pull).
//   This screen never writes Dexie; it re-reads it after a write.
// - KB-330 (D71, D77): Edit (rename, other names, Archive), an "Archived" list with Restore, and "Add product" - all
//   ONLINE like the price edit, through injected writers; absent writers = no button (like importRows).
// - Suggestions (only here, never in billing): a price paid on 3 bills,
//   applied only by a tap through the same save; provisional products are
//   read-only (KB-320 saves them).

type Filter = "all" | "archived" | LocalShopProduct["source"];
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
  { value: "learned", label: "Learned" },
  { value: "base", label: "From base catalog" },
  { value: "archived", label: "Archived" },
];
const READY_SHOWN = 100;
const OFFLINE = "Needs internet to change the catalog";
const SAVE_FAILED = SAVE_FAILED_TEXT;

const priceText = (paise: number, unit: string) => `${formatRupees(paise)} / ${unit}`;
// KB-321: "recent" is bills of the last 30 days from this shop's own bills; the server's use_count (nothing writes it yet) is the fallback.
const usedText = (t: Translate, recent: number, useCount: number) =>
  recent > 0
    ? recent === 1 ? t("catalog.usedOnce30") : t("catalog.usedMany30", { n: recent })
    : useCount === 0 ? t("catalog.notUsed") : useCount === 1 ? t("catalog.usedOnce") : t("catalog.usedMany", { n: useCount });
const byUseThenName = (freq: Readonly<Record<string, number>>) => (a: LocalShopProduct, b: LocalShopProduct) =>
  (freq[b.id] ?? 0) - (freq[a.id] ?? 0) || b.useCount - a.useCount || a.displayName.localeCompare(b.displayName);

interface CatalogScreenProps {
  localDb: KiranaBillDB;
  shopId: string;
  save: (productId: string, pricePaise: number) => Promise<CatalogWriteResult>;
  add: (base: LocalBaseProduct) => Promise<CatalogWriteResult>;
  /** KB-314: bulk import from a file (data/catalogImport.ts). Absent = no "Import from file". */
  importRows?: (rows: ImportRow[], onProgress: (done: number, total: number) => void) => Promise<ImportOutcome>;
  /** KB-330: rename / other names (only the changed columns), archive-restore, and a new product. Absent = no button. */
  saveDetails?: (productId: string, patch: ProductPatch) => Promise<CatalogWriteResult>;
  setActive?: (productId: string, active: boolean) => Promise<CatalogWriteResult>;
  create?: (product: NewProduct) => Promise<CatalogWriteResult>;
  /** KB-329 (D78): [Ignore] on a price suggestion - a local, append-only learning write (works offline). Absent = no button. */
  ignoreSuggestion?: (shopProductId: string) => Promise<void>;
  /** KB-323 (D81): forget a learned phrase - a local, append-only event (works offline). Absent = no Remove button. */
  removeAlias?: (alias: string, shopProductId: string) => Promise<void>;
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
  /** KB-321: bills of the last 30 days per product. */
  freq: Readonly<Record<string, number>>;
  /** KB-323: every alias the evidence still supports, with the product it maps to. */
  learnedNames: readonly { alias: string; catalogId: string; productName: string; confidence: number; inUse: boolean }[];
}

export function CatalogScreen({ localDb, shopId, save, add, importRows, saveDetails, setActive, create, ignoreSuggestion, removeAlias, onChanged, onClose }: CatalogScreenProps) {
  useBackEntry("kbCatalog", onClose);
  const { t, tx } = useT();
  const online = useBrowserOnline();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [readyOpen, setReadyOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<LocalShopProduct | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // One status line: "“X” archived — Undo", or "X added — ₹.. / unit".
  const [note, setNote] = useState<{ text: string; undoId?: string } | null>(null);

  const reload = useCallback(async () => {
    const [all, catalog, suggestions, provisional, derived] = await Promise.all([
      localDb.shopProducts.where("shopId").equals(shopId).toArray(),
      loadShopCatalog(localDb, shopId),
      listPendingPriceSuggestions(localDb, shopId, Date.now()),
      listProvisionalProducts(localDb, shopId),
      deriveShopAliases(localDb, shopId),
    ]);
    const active = new Map(all.filter((p) => p.isActive).map((p) => [p.id, p.displayName]));
    setLoaded({
      all,
      products: all.filter((p) => p.isActive),
      parser: prepareParserCatalog(catalog.entries),
      suggestions,
      provisional: provisional.filter((p) => p.promotedAt === null),
      freq: Object.fromEntries(Object.entries(catalog.usageById).map(([id, u]) => [id, u.recentFrequency ?? 0])),
      learnedNames: derived.flatMap((a) =>
        a.active && active.has(a.catalogId) ? [{ alias: a.alias, catalogId: a.catalogId, productName: active.get(a.catalogId)!, confidence: a.confidence, inUse: a.confidence >= PROMOTE_AT }] : [],
      ),
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

  const others = (except?: string): OtherProduct[] =>
    (loaded?.all ?? []).filter((p) => p.id !== except).map((p) => ({ id: p.id, displayName: p.displayName, aliases: p.aliases, isActive: p.isActive }));
  /** After a write the server accepted: re-read Dexie (the writer re-pulled) and tell billing to reload its catalog. */
  const wrote = async () => {
    await reload();
    onChanged();
  };
  const [ignoreFailed, setIgnoreFailed] = useState(false);
  const ignore = (p: LocalShopProduct) => {
    if (!ignoreSuggestion) return;
    setIgnoreFailed(false);
    ignoreSuggestion(p.id)
      .then(async () => {
        await reload();
        setNote({ text: `Suggestion for ${p.displayName} hidden for 90 days` });
      })
      .catch(() => setIgnoreFailed(true));
  };
  const restore = (p: LocalShopProduct) => {
    if (!setActive) return;
    setSaving((s) => new Set(s).add(p.id));
    setFailed((s) => without(s, p.id));
    setActive(p.id, true)
      .then(async (r) => (r.ok ? wrote() : setFailed((s) => new Set(s).add(p.id))))
      .catch(() => setFailed((s) => new Set(s).add(p.id)))
      .finally(() => setSaving((s) => without(s, p.id)));
  };

  const typed = query.trim();
  const shown = useMemo(() => {
    if (!loaded) return [];
    if (filter === "archived") {
      const q = nameKey(typed);
      return loaded.all
        .filter((p) => !p.isActive && (q === "" || [p.displayName, ...p.aliases].some((a) => nameKey(a).includes(q))))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    const byId = new Map(loaded.products.map((p) => [p.id, p]));
    const usage = Object.fromEntries(loaded.products.map((p) => [p.id, { useCount: p.useCount, recentFrequency: loaded.freq[p.id] ?? 0 }]));
    const list = [...typed].length >= 2
      ? searchCatalog(loaded.parser, typed, usage, loaded.products.length).flatMap((r) => byId.get(r.entry.id) ?? [])
      : [...loaded.products].sort(byUseThenName(loaded.freq));
    return filter === "all" ? list : list.filter((p) => p.source === filter);
  }, [loaded, typed, filter]);

  const productById = useMemo(() => new Map(loaded?.products.map((p) => [p.id, p])), [loaded]);
  const priceSuggestions = (loaded?.suggestions ?? []).flatMap((s) => {
    const p = productById.get(s.catalogId);
    return p && p.pricePaise !== s.suggestedPricePaise ? [{ s, p }] : [];
  });
  const hasSuggestions = priceSuggestions.length > 0 || (loaded?.provisional.length ?? 0) > 0;

  return (
    <section aria-label={t("menu.catalog")} className="fixed inset-0 z-20 flex flex-col bg-paper text-ink text-[15px]">
      <div inert={readyOpen || importOpen || editing !== null || addOpen} aria-hidden={readyOpen || importOpen || editing !== null || addOpen || undefined} className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label={t("settings.back")} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">{t("menu.catalog")}</h2>
        </header>
        <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
          {!online && <p className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">{tx(OFFLINE)}</p>}
          <input
            type="search"
            aria-label={t("add.search")}
            placeholder={t("catalog.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 w-full rounded-[6px] border border-line bg-surface px-3"
          />
          <div role="radiogroup" aria-label={t("catalog.show")} className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <label key={f.value} className="flex min-h-11 cursor-pointer items-center rounded-[6px] border border-line px-3 has-checked:border-ink has-checked:bg-ink has-checked:text-paper">
                <input type="radio" name="catalog-filter" value={f.value} checked={filter === f.value} onChange={() => setFilter(f.value)} className="sr-only" />
                {tx(f.label)}
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
              {t("catalog.addReady")}
            </button>
            {create && (
              <button
                type="button"
                aria-disabled={!online}
                onClick={online ? () => setAddOpen(true) : undefined}
                className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
              >
                {t("product.addTitle")}
              </button>
            )}
            {importRows && (
              <button
                type="button"
                aria-disabled={!online}
                onClick={online ? () => setImportOpen(true) : undefined}
                className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
              >
                {t("catalog.import")}
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {note && (
            <p role="status" className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[13px]">
              <span className="[overflow-wrap:anywhere]">{tx(note.text)}</span>
              {note.undoId && setActive && (
                <button
                  type="button"
                  onClick={() => {
                    const id = note.undoId!;
                    setNote(null);
                    void setActive(id, true)
                      .then((r) => (r.ok ? wrote() : setFailed((s) => new Set(s).add(id))))
                      .catch(() => setFailed((s) => new Set(s).add(id)));
                  }}
                  className="min-h-11 px-3 font-medium text-indigo"
                >
                  {t("undo.button")}
                </button>
              )}
            </p>
          )}
          {ignoreFailed && (
            <p role="alert" className="border-b border-line px-4 py-2 text-[13px] text-danger">
              {t("catalog.hideFailed")}
            </p>
          )}
          {loaded && filter !== "archived" && loaded.learnedNames.length > 0 && (
            <section aria-label={t("catalog.learnedNames")} className="border-b border-line px-4 py-3">
              <h3 className="text-[13px] font-medium tracking-[0.02em] text-ink-soft">{t("catalog.learnedNames")}</h3>
              <ul className="mt-1 flex flex-col gap-2">
                {loaded.learnedNames.map((l) => (
                  <li key={l.alias.toLowerCase()} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {t("catalog.learnedRow", { alias: l.alias, name: l.productName, state: t(l.inUse ? "catalog.inUse" : "catalog.stillLearning"), pct: Math.round(l.confidence * 100) })}
                    </span>
                    {removeAlias && (
                      <button
                        type="button"
                        aria-label={t("catalog.removeLabel", { alias: l.alias, name: l.productName })}
                        onClick={() => void removeAlias(l.alias, l.catalogId).then(wrote).catch((err: unknown) => console.warn("[catalog] could not remove the alias:", err))}
                        className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium"
                      >
                        {t("col.remove")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {hasSuggestions && loaded && filter !== "archived" && (
            <section aria-label={t("catalog.suggestions")} className="border-b border-line px-4 py-3">
              <h3 className="text-[13px] font-medium tracking-[0.02em] text-ink-soft">{t("catalog.suggestions")}</h3>
              <ul className="mt-1 flex flex-col gap-2">
                {priceSuggestions.map(({ s, p }) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {t("catalog.priceDrift", { name: p.displayName, price: formatRupees(s.suggestedPricePaise), unit: p.unit, bills: s.observationCount, now: formatRupees(p.pricePaise) })}
                    </span>
                    <button
                      type="button"
                      aria-label={t("catalog.useLabel", { price: formatRupees(s.suggestedPricePaise), name: p.displayName })}
                      aria-disabled={!online || saving.has(p.id)}
                      onClick={online && !saving.has(p.id) ? () => savePrice(p, s.suggestedPricePaise) : undefined}
                      className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium aria-disabled:opacity-50"
                    >
                      {t("catalog.use", { price: formatRupees(s.suggestedPricePaise) })}
                    </button>
                    {ignoreSuggestion && (
                      <button
                        type="button"
                        aria-label={t("catalog.ignoreLabel", { name: p.displayName })}
                        onClick={() => ignore(p)}
                        className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium"
                      >
                        {t("catalog.ignore")}
                      </button>
                    )}
                  </li>
                ))}
                {loaded.provisional.map((p) => (
                  <li key={p.localId} className="text-ink-soft [overflow-wrap:anywhere]">
                    {t("catalog.provisional", { name: p.spokenName, n: p.seenCount })}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {loaded && filter === "archived" && shown.length === 0 && (
            <p className="px-4 py-6 text-center">{t(typed ? "catalog.noneFound" : "catalog.noneArchived")}</p>
          )}
          {loaded && filter !== "archived" && loaded.products.length > 0 && shown.length === 0 && (
            <p className="px-4 py-6 text-center">{t(typed ? "catalog.noneFound" : "catalog.noneOfKind")}</p>
          )}
          {loaded && filter !== "archived" && loaded.products.length === 0 && !typed && (
            <p className="px-4 py-6 text-center">{t("catalog.noneYet")}</p>
          )}
          {loaded && (
            <ul aria-label={t("add.products")}>
              {shown.map((p) => (
                <li key={p.id} className="flex min-h-12 items-center gap-3 border-b border-line bg-surface px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span data-testid="name" className="block font-medium [overflow-wrap:anywhere]">{p.displayName}</span>
                    <span className="block text-[13px] text-ink-soft">{usedText(t, loaded.freq[p.id] ?? 0, p.useCount)}</span>
                  </span>
                  <span className="flex flex-col items-end">
                    {!p.isActive ? (
                      <span className="tabular-nums">{priceText(p.pricePaise, p.unit)}</span>
                    ) : online && !saving.has(p.id) ? (
                      <EditableValue
                        label={t("catalog.priceOf", { name: p.displayName })}
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
                    {saving.has(p.id) && <span className="text-[13px] text-ink-soft">{t("catalog.saving")}</span>}
                    {failed.has(p.id) && (
                      <span role="alert" className="text-[13px] text-danger">
                        {tx(SAVE_FAILED)}
                      </span>
                    )}
                  </span>
                  {saveDetails && (
                    <span className="flex items-center gap-1">
                      {!p.isActive && setActive && (
                        <button
                          type="button"
                          aria-label={t("catalog.restoreLabel", { name: p.displayName })}
                          aria-disabled={!online || saving.has(p.id)}
                          onClick={online && !saving.has(p.id) ? () => restore(p) : undefined}
                          className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium aria-disabled:opacity-50"
                        >
                          {t("catalog.restore")}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={t("catalog.editLabel", { name: p.displayName })}
                        aria-disabled={!online}
                        onClick={online ? () => setEditing(p) : undefined}
                        className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium aria-disabled:opacity-50"
                      >
                        {t("catalog.edit")}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {editing && loaded && saveDetails && (
        <EditProductSheet
          key={editing.id}
          product={editing}
          others={others(editing.id)}
          online={online}
          onSave={async (patch) => {
            const r = await saveDetails(editing.id, patch);
            if (r.ok) {
              await wrote();
              setEditing(null);
            }
            return r;
          }}
          onArchive={
            editing.isActive && setActive
              ? async () => {
                  const r = await setActive(editing.id, false);
                  if (r.ok) {
                    await wrote();
                    setEditing(null);
                    setNote({ text: `“${editing.displayName}” archived`, undoId: editing.id });
                  }
                  return r;
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
      {addOpen && loaded && create && (
        <AddProductSheet
          existing={others()}
          online={online}
          onCreate={async (product) => {
            const r = await create(product);
            if (r.ok) {
              await wrote();
              setAddOpen(false);
              setNote({ text: `${product.name} added — ${priceText(product.pricePaise, product.unit)}` });
            } else if (r.reason === "duplicate") await reload(); // the other phone's row was just re-pulled
            return r;
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
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
  const { t, tx } = useT();
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
    <section aria-label={t("ready.title")} className="fixed inset-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label={t("settings.back")} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">{t("ready.title")}</h2>
        </header>
        <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
          {!online && <p className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">{tx(OFFLINE)}</p>}
          <input
            type="search"
            aria-label={t("ready.search")}
            placeholder={t("product.name")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 w-full rounded-[6px] border border-line bg-surface px-3"
          />
          {message && (
            <p role={message.error ? "alert" : "status"} className={`text-[13px] ${message.error ? "text-danger" : "text-ink-soft"}`}>
              {tx(message.text)}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {bases !== null && bases.length === 0 && <p className="px-4 py-6 text-center">{t("ready.notOnPhone")}</p>}
          {bases !== null && bases.length > 0 && available.length === 0 && (
            <p className="px-4 py-6 text-center [overflow-wrap:anywhere]">
              {!typed ? t("ready.hasAll") : matched > 0 ? t("ready.alreadyQ", { q: typed }) : t("ready.noMatch", { q: typed })}
            </p>
          )}
          <ul aria-label={t("ready.products")}>
            {available.slice(0, READY_SHOWN).map((b) => (
              <li key={b.id} className="flex min-h-12 items-center gap-3 border-b border-line bg-surface px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span data-testid="ready-name" className="block font-medium [overflow-wrap:anywhere]">{b.displayName}</span>
                  <span className="block text-[13px] tabular-nums text-ink-soft">{priceText(b.suggestedPricePaise, b.defaultUnit)}</span>
                </span>
                <button
                  type="button"
                  aria-label={t("ready.addLabel", { name: b.displayName })}
                  aria-disabled={!online || busy !== null}
                  onClick={online && busy === null ? () => onAdd(b) : undefined}
                  className="min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50"
                >
                  {busy === b.id ? t("ready.adding") : t("common.add")}
                </button>
              </li>
            ))}
          </ul>
          {available.length > READY_SHOWN && (
            <p className="px-4 py-4 text-center text-[13px] text-ink-soft">
              {t("ready.showing", { shown: READY_SHOWN, total: available.length })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
