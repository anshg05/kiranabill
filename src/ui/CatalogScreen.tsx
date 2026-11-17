import { deriveShopAliases } from "@/data/aliasEvidence";
import { PROMOTE_AT } from "@/domain/aliasEvidence";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { KiranaBillDB, LocalBaseProduct, LocalProvisionalProduct, LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { ImportOutcome, ImportRow } from "@/data/catalogImport";
import type { NewProduct, OtherProduct, ProductPatch } from "@/domain/catalogEdit";
import { listPendingPriceSuggestions, listProvisionalProducts } from "@/data/learningAudit";
import { subscribeCatalogPulled } from "@/data/catalogPullStatus";
import { loadShopCatalog } from "@/data/shopCatalog";
import { nameKey } from "@/domain/catalogImport";
import { prepareParserCatalog, searchCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import type { PriceSuggestion } from "@/domain/learning";
import { formatRupees } from "@/domain/money";
import type { LucideIcon } from "lucide-react";
import { CatalogImportSheet } from "./CatalogImportSheet";
import { AddProductSheet } from "./AddProductSheet";
import { EditProductSheet, SAVE_FAILED_TEXT } from "./EditProductSheet";
import { FromBillsPage } from "./FromBillsPage";
import { BottomSheet } from "./kit/BottomSheet";
import { Button } from "./kit/Button";
import { FilterChip, FilterChipRow } from "./kit/Chip";
import { Icon, KB_ICONS } from "./kit/icons";
import { LinkBanner } from "./kit/Banner";
import { SearchField } from "./kit/TextField";
import { ScreenTitle } from "./kit/TopBar";
import { useBackEntry } from "./useBackEntry";
import { useHidesNav } from "./AppTabs";
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
  const [addMenu, setAddMenu] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [billsOpen, setBillsOpen] = useState(false);
  const [editing, setEditing] = useState<LocalShopProduct | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // KB-414 step 3: the bar at the bottom - "“X” archived · Undo", or "X added — ₹.. / unit" (only after an action)
  const [note, setNote] = useState<{ text: string; undoId?: string } | null>(null);
  // the "From your bills" page's own line ("Suggestion for X hidden for 90 days")
  const [billsNote, setBillsNote] = useState<string | null>(null);

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
  // KB-350: another phone's change (a sync pull) refreshes the open screen. The Edit page keeps his typing (it holds its own text and
  // only shows a note).
  useEffect(() => subscribeCatalogPulled(localDb.name, () => void reload().catch((err: unknown) => console.warn("[catalog] reload failed:", err instanceof Error ? err.message : err))), [localDb, reload]);

  /** "Use ₹X" on a price suggestion: today's price writer. */
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
        setBillsNote(`Suggestion for ${p.displayName} hidden for 90 days`);
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
  // the banner's line: only what is there ("2 prices to check · 1 new name · 3 learned names")
  const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => (n === 0 ? [] : [n === 1 ? t(one) : t(many, { n })]);
  const fromBills = loaded
    ? [
        ...count(priceSuggestions.length, "items.pricesOne", "items.pricesMany"),
        ...count(loaded.provisional.length, "items.newNameOne", "items.newNameMany"),
        ...count(loaded.learnedNames.length, "items.learnedOne", "items.learnedMany"),
      ]
    : [];
  const covered = addMenu || readyOpen || importOpen || billsOpen || editing !== null || addOpen;
  /** "+ Add" sheet: the sheet closes, then its page opens (each its own Back entry). */
  const pick = (open: () => void) => () => {
    setAddMenu(false);
    open();
  };

  return (
    <section aria-label={t("nav.items")} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-[var(--kb-tab-bottom,0px)] z-20 flex flex-col bg-kb-bg text-kb-ink">
      <div inert={covered} aria-hidden={covered || undefined} className="mx-auto flex h-full w-full max-w-[480px] flex-col">
        {/* KB-414 step 3: 16's title and "+ Add"; no back arrow (the nav and Android Back go Home); the search; today's filters as chips;
            then the list - the extras are behind "+ Add", the banner, the Archived chip and the Undo bar */}
        <ScreenTitle title={t("nav.items")} action={{ label: t("common.add"), icon: KB_ICONS.Plus, onClick: () => setAddMenu(true) }} />
        <div className="px-4 pt-[6px]">
          <SearchField label={t("add.search")} placeholder={t("catalog.searchPlaceholder")} value={query} onChange={setQuery} />
        </div>
        <div role="group" aria-label={t("catalog.show")} className="px-4 pt-3 pb-1">
          <FilterChipRow>
            {FILTERS.map((f) => (
              <FilterChip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.value === "all" ? t("items.all", { n: loaded?.products.length ?? 0 }) : tx(f.label)}
              </FilterChip>
            ))}
          </FilterChipRow>
        </div>

        <div data-scroll-list className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-4 pt-[10px] pb-3">
          {!online && <p className="px-1 text-kb-13 text-kb-sub">{tx(OFFLINE)}</p>}
          {loaded && filter !== "archived" && fromBills.length > 0 && (
            <LinkBanner icon={KB_ICONS.Lightbulb} title={t("items.fromBills")} sub={fromBills.join(" · ")} onClick={() => setBillsOpen(true)} />
          )}
          {loaded && filter === "archived" && shown.length === 0 && <p className="px-1 py-6 text-center text-kb-15">{t(typed ? "catalog.noneFound" : "catalog.noneArchived")}</p>}
          {loaded && filter !== "archived" && loaded.products.length > 0 && shown.length === 0 && (
            <p className="px-1 py-6 text-center text-kb-15">{t(typed ? "catalog.noneFound" : "catalog.noneOfKind")}</p>
          )}
          {loaded && filter !== "archived" && loaded.products.length === 0 && !typed && <p className="px-1 py-6 text-center text-kb-15">{t("catalog.noneYet")}</p>}
          {loaded && (
            <ul aria-label={t("add.products")} className={shown.length > 0 ? "overflow-hidden rounded-[16px] border border-kb-border bg-kb-card" : ""}>
              {shown.map((p) => (
                <li key={p.id} className="flex items-center border-b border-kb-border last:border-b-0">
                  <ItemCard p={p} onOpen={saveDetails ? () => setEditing(p) : undefined} />
                  {!p.isActive && setActive && (
                    <span className="flex flex-none flex-col items-end gap-1 pr-[14px]">
                      <Button
                        variant="secondary"
                        height={46}
                        fill={false}
                        className="px-3"
                        ariaLabel={t("catalog.restoreLabel", { name: p.displayName })}
                        ariaDisabled={!online || saving.has(p.id)}
                        onClick={online && !saving.has(p.id) ? () => restore(p) : undefined}
                      >
                        {t("catalog.restore")}
                      </Button>
                      {failed.has(p.id) && <span role="alert" className="text-kb-13 text-kb-err">{tx(SAVE_FAILED)}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {note && (
          <div className="flex-none px-4 pb-3">
            <p role="status" className="flex flex-wrap items-center justify-between gap-x-3 rounded-[12px] bg-kb-ink px-[14px] py-1 text-kb-14 text-kb-card">
              <span className="py-2 [overflow-wrap:anywhere]">{tx(note.text)}</span>
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
                  className="kb-hit min-h-11 font-bold text-kb-primary-line"
                >
                  {t("undo.button")}
                </button>
              )}
            </p>
          </div>
        )}
      </div>
      {addMenu && (
        <BottomSheet backKey="kbAddItems" title={t("items.addTitle")} onClose={() => setAddMenu(false)}>
          <div className="flex flex-col gap-[10px]">
            {create && <AddOption icon={KB_ICONS.Plus} title={t("items.newItem")} sub={t("items.newItemSub")} online={online} onClick={pick(() => setAddOpen(true))} />}
            <AddOption icon={KB_ICONS.Package} title={t("catalog.addReady")} sub={t("items.readySub")} online={online} onClick={pick(() => setReadyOpen(true))} />
            {importRows && <AddOption icon={KB_ICONS.FileText} title={t("catalog.import")} sub={t("items.importSub")} online={online} onClick={pick(() => setImportOpen(true))} />}
            {!online && <p className="rounded-[12px] border border-kb-border bg-kb-card px-3 py-[10px] text-kb-13 text-kb-sub">{tx(OFFLINE)}</p>}
          </div>
        </BottomSheet>
      )}
      {billsOpen && loaded && (
        <FromBillsPage
          suggestions={priceSuggestions}
          provisional={loaded.provisional}
          learned={loaded.learnedNames}
          online={online}
          saving={saving}
          failed={failed}
          note={billsNote}
          ignoreFailed={ignoreFailed}
          onUse={savePrice}
          onIgnore={ignoreSuggestion ? ignore : undefined}
          onRemove={removeAlias ? (l) => void removeAlias(l.alias, l.catalogId).then(wrote).catch((err: unknown) => console.warn("[catalog] could not remove the alias:", err)) : undefined}
          onClose={() => (setBillsOpen(false), setBillsNote(null))}
        />
      )}
      {editing && loaded && saveDetails && (
        <EditProductSheet
          key={editing.id}
          product={editing}
          others={others(editing.id)}
          online={online}
          used={usedText(t, loaded.freq[editing.id] ?? 0, editing.useCount)}
          onSave={async (patch, pricePaise) => {
            const details = Object.keys(patch).length > 0;
            if (details) {
              const r = await saveDetails(editing.id, patch);
              if (!r.ok) return r;
            }
            if (pricePaise !== null) {
              const r = await save(editing.id, pricePaise);
              if (!r.ok) {
                // the details were saved before the price failed: show them, and tell billing - nothing else changed
                if (details) await wrote();
                return r;
              }
            }
            await wrote();
            setEditing(null);
            return { ok: true };
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
          changedNote={changedNoteFor(editing, loaded.all, t)}
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

/** 16's card: the first-letter tile, the name, the other names (never the name itself), "learned", the price "per unit". A tap opens
 *  Edit item (the price is edited there - owner, 17 Nov 2026). */
function ItemCard({ p, onOpen }: { p: LocalShopProduct; onOpen?: () => void }) {
  const { t } = useT();
  const own = nameKey(p.displayName);
  const aliases = p.aliases.filter((a) => nameKey(a) !== own);
  const body = (
    <>
      <span data-testid="tile" aria-hidden="true" className="flex size-[42px] flex-none items-center justify-center rounded-[12px] bg-kb-muted text-kb-18 font-bold">
        {[...p.displayName][0]?.toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span data-testid="name" className="text-kb-16 font-semibold [overflow-wrap:anywhere]">{p.displayName}</span>
        {(aliases.length > 0 || p.source === "learned") && (
          <span className="flex flex-wrap items-center gap-x-[6px] gap-y-1 text-kb-13 text-kb-sub">
            {aliases.length > 0 && <span data-testid="aliases" className="[overflow-wrap:anywhere]">{aliases.join(" · ")}</span>}
            {p.source === "learned" && (
              <span className="inline-flex items-center gap-[3px] rounded-full bg-kb-primary-pale px-2 py-[2px] text-kb-11 font-bold text-kb-primary">
                <Icon icon={KB_ICONS.Sparkles} size={11} />
                {t("items.learned")}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="flex flex-none flex-col items-end text-right">
        <span className="whitespace-nowrap text-kb-16 font-extrabold tabular-nums">{formatRupees(p.pricePaise)}</span>
        <span className="whitespace-nowrap text-kb-12 text-kb-sub">{t("items.perUnit", { unit: p.unit })}</span>
      </span>
    </>
  );
  const row = "flex min-h-[68px] min-w-0 flex-1 items-center gap-3 px-[14px] py-3 text-left";
  return onOpen ? (
    <button type="button" aria-label={t("catalog.editLabel", { name: p.displayName })} onClick={onOpen} className={`kb-hit kb-press ${row}`}>
      {body}
    </button>
  ) : (
    <div className={row}>{body}</div>
  );
}

/** One way to add, in the "+ Add" sheet (mock B): a 40 px pale tile, the title 16 / 700 over its line. Offline it waits. */
function AddOption({ icon, title, sub, online, onClick }: { icon: LucideIcon; title: string; sub: string; online: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-disabled={!online}
      onClick={online ? onClick : undefined}
      className="kb-hit kb-press flex w-full items-center gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px] text-left aria-disabled:opacity-50"
    >
      <span className="flex size-10 flex-none items-center justify-center rounded-[12px] bg-kb-primary-pale text-kb-primary">
        <Icon icon={icon} size={20} />
      </span>
      <span className="flex min-w-0 flex-col">
        <b className="text-kb-16 font-bold">{title}</b>
        <span className="text-kb-13 text-kb-sub">{sub}</span>
      </span>
    </button>
  );
}

/** KB-350: what changed on another phone for the product whose Edit sheet is open (price, then name, then archived), or null. */
function changedNoteFor(opened: LocalShopProduct, all: readonly LocalShopProduct[], t: Translate): string | null {
  const now = all.find((p) => p.id === opened.id);
  if (!now) return null;
  if (opened.isActive && !now.isActive) return t("catalog.changedElsewhere", { now: t("catalog.nowArchived") });
  if (now.pricePaise !== opened.pricePaise) return t("catalog.changedElsewhere", { now: formatRupees(now.pricePaise) });
  if (now.displayName !== opened.displayName) return t("catalog.changedElsewhere", { now: `“${now.displayName}”` });
  return null;
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
  useHidesNav(); // KB-414: no nav over this page (it is drawn inside a tab screen, under the nav)
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
    <section aria-label={t("ready.title")} className="fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
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
