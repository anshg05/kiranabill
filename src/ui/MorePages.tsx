import { aliasKeyOf } from "@/domain/aliasEvidence";
import { deriveShopAliases } from "@/data/aliasEvidence";
import { useCallback, useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import type { DeviceDB } from "@/data/device";
import type { KiranaBillDB, LocalLearnedAlias, LocalProvisionalProduct, LocalShop } from "@/data/db";
import { listIgnoredPriceSuggestions, listLearnedAliases, listPendingPriceSuggestions, listProvisionalProducts, resetLearning } from "@/data/learningAudit";
import { updateShopSettings } from "@/data/shopSettings";
import { readStorageStatus, storageStatusText, type StorageStatus } from "@/data/storagePersist";
import type { ReconcileResult } from "@/data/billMetrics";
import type { DeleteOutcome } from "@/data/accountDeletion";
import { BUILD_ID } from "@/pwa/buildId";
import { formatMobile } from "@/domain/customer";
import type { PriceSuggestion } from "@/domain/learning";
import type { Language } from "@/domain/messages";
import type { BillLanguage } from "@/domain/receipt";
import { isNativeApp } from "@/data/nativeSignIn";
import { parseShopName, parseShopPhone } from "@/domain/shopSettings";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { ReceiptPaper } from "./kit/ReceiptPaper";
import { ListCard, ListRow } from "./kit/ListRow";
import { TextField } from "./kit/TextField";
import { PilotNumbers } from "./PilotNumbers";
import { LongTestPrint, PrinterSection, sampleReceipt } from "./PrinterSection";
import { priceDriftText } from "./priceDriftText";
import { Receipt } from "./Receipt";
import { isIos } from "./platform";
import { setScreenLanguage } from "./screenLanguage";
import type { SyncChip, Unsynced } from "./syncChip";
import { useBrowserOnline } from "./useBrowserOnline";
import { useT } from "./useT";
import { InnerPage } from "./InnerPage";
export { InnerPage };

// KB-414 step 4 (owner + reviewer, 18 Nov 2026): More's inner pages - today's Settings (KB-312) split into pages in the new look,
// nothing dropped. Each is an inner page: Back (arrow or Android) goes one level, no nav.

export type MorePage = "shop" | "printer" | "billDesign" | "language" | "sync" | "help" | "developer" | "account";

/** The receipt language labels (fixed - a language's own name is never translated; "Both" is a word, so it is). */
export const RECEIPT_LANGUAGE_NAME: Record<BillLanguage, string> = { en: "English", hi: "हिन्दी", both: "English + हिन्दी" };
// KB-332 (D84): three fixed labels, never translated (a shopkeeper who cannot read the current language must still find his own).
export const SCREEN_LANGUAGES: readonly { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "hl", label: "Hinglish" },
];

export interface SyncState {
  chip: SyncChip | null;
  unsynced: Unsynced;
  detail: { pending: number; conflict: number; lastAttemptAt: string | null };
}

/** The phone's real sync state in a few words: the header chip's words, else "N bills waiting to sync", else "Synced". */
export function useSyncStateText(sync: SyncState): string {
  const { t, tx } = useT();
  const { pending } = sync.unsynced;
  if (sync.chip) return tx(sync.chip.label);
  if (pending > 0) return t(pending === 1 ? "more.waitingOne" : "more.waitingMany", { n: pending });
  return t("more.synced");
}

const showPhone = (phone: string | null) => (phone === null ? "" : /^\d{10}$/.test(phone) ? formatMobile(phone) : phone);


/** A choice of a few, as rows in one card: 58 px, the label 15 / 600, a check on the chosen one. */
function ChoiceList<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="overflow-hidden rounded-[16px] border border-kb-border bg-kb-card">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className="kb-hit flex min-h-[58px] w-full items-center gap-3 border-b border-kb-border px-[14px] text-left last:border-b-0"
        >
          <span className="min-w-0 flex-1 text-kb-15 font-semibold">{o.label}</span>
          {o.value === value && <Icon icon={KB_ICONS.Check} size={20} className="text-kb-primary" />}
        </button>
      ))}
    </div>
  );
}

const help = "text-kb-13 text-kb-sub";

/** The shop card -> today's name + phone form (KB-312): written to this phone first, pushed by the ordinary sync (D64) - works offline. */
export function EditShopPage({ localDb, shopId, onClose }: { localDb: KiranaBillDB; shopId: string; onClose: () => void }) {
  const online = useBrowserOnline();
  const { t, tx } = useT();
  const [shop, setShop] = useState<LocalShop | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saved, setSaved] = useState(false);

  // The shop row, live: an edit that arrives from the server while this is open shows up. A field follows the server unless the
  // shopkeeper has changed it (it differs from the row as it was) - typing is never overwritten.
  const baseline = useRef<LocalShop | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => localDb.shops.get(shopId)).subscribe({
      next: (row) => {
        if (!row) return;
        const prev = baseline.current;
        baseline.current = row;
        setShop(row);
        setName((cur) => (prev === null || cur === prev.name ? row.name : cur));
        setPhone((cur) => (prev === null || cur === showPhone(prev.phone) ? showPhone(row.phone) : cur));
      },
      error: (err: unknown) => console.warn("[more] shop load failed:", err instanceof Error ? err.message : err),
    });
    return () => sub.unsubscribe();
  }, [localDb, shopId]);

  const dirty = shop !== null && (name !== shop.name || phone !== showPhone(shop.phone));

  const save = async () => {
    if (!shop || !dirty) return;
    const n = parseShopName(name);
    const p = parseShopPhone(phone);
    setErrors({ name: n.ok ? undefined : n.error, phone: p.ok ? undefined : p.error });
    if (!n.ok || !p.ok) return;
    await updateShopSettings(localDb, shopId, { name: n.value, phone: p.value });
    setName(n.value);
    setPhone(showPhone(p.value));
    setSaved(true);
  };
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setSaved(false);
  };

  return (
    <InnerPage title={t("more.editShop")} backKey="kbEditShop" onClose={onClose}>
      {shop && (
        <>
          <TextField label={t("settings.shopName")} value={name} onChange={edit(setName)} />
          {errors.name && <p role="alert" className="-mt-2 text-kb-13 text-kb-err">{tx(errors.name)}</p>}
          <TextField label={t("settings.shopPhone")} value={phone} onChange={edit(setPhone)} inputMode="tel" />
          {errors.phone && <p role="alert" className="-mt-2 text-kb-13 text-kb-err">{tx(errors.phone)}</p>}
          <Button variant="primary" ariaDisabled={!dirty} onClick={dirty ? () => void save() : undefined}>
            {t("settings.save")}
          </Button>
          {!dirty && !saved && <p className={help}>{t("reason.noChanges")}</p>}
          {saved && (
            <p role="status" className={help}>
              {online ? t("settings.saved") : t("settings.savedOffline")}
            </p>
          )}
        </>
      )}
    </InnerPage>
  );
}

/** KB-408 S5: the printer, inside the Android app only (More shows the row only there). Stored on this phone. */
export function PrinterPage({ shop, onClose }: { shop: LocalShop; onClose: () => void }) {
  const { t } = useT();
  return (
    <InnerPage title={t("settings.printer")} backKey="kbPrinter" onClose={onClose}>
      <PrinterSection shop={shop} />
    </InnerPage>
  );
}

/**
 * 21 Bill design, with today's parts only: the live preview, the receipt language (saves at once, as today - KI-59: the customer's
 * receipt, not the screen's language), and how item names print. Address, thank-you note and Show phone stay out (KB-422); the
 * name is edited on Edit shop details.
 */
export function BillDesignPage({ localDb, shop, onClose }: { localDb: KiranaBillDB; shop: LocalShop; onClose: () => void }) {
  const { t } = useT();
  const options = (["en", "hi", "both"] as const).map((value) => ({ value, label: value === "both" ? t("settings.receiptBoth") : RECEIPT_LANGUAGE_NAME[value] }));
  return (
    <InnerPage title={t("more.billDesign")} backKey="kbBillDesign" onClose={onClose}>
      <figure aria-label={t("more.preview")} className="flex justify-center rounded-[18px] bg-kb-muted px-3 pt-4 pb-3 [overflow-wrap:normal]">
        <ReceiptPaper width={280} torn>
          <Receipt receipt={sampleReceipt(shop)} />
        </ReceiptPaper>
      </figure>
      <div className="flex flex-col gap-2">
        <span className="text-kb-14 font-semibold">{t("settings.receiptLanguage")}</span>
        <p className={help}>{t("settings.receiptLanguageHelp")}</p>
        <ChoiceList label={t("settings.receiptLanguage")} options={options} value={shop.billLanguage} onChange={(billLanguage) => void updateShopSettings(localDb, shop.id, { billLanguage })} />
        <p className={help}>{t("settings.receiptNote")}</p>
      </div>
      <div role="group" aria-label={t("more.namesOnBill")} className="flex flex-col gap-1 rounded-[16px] border border-kb-border bg-kb-card px-[14px] py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-kb-15 font-semibold">{t("more.namesOnBill")}</span>
          <span className="text-kb-13 text-kb-sub">{t("more.namesAsSaid")}</span>
        </div>
        <p className={help}>{t("more.namesHelp")}</p>
      </div>
    </InnerPage>
  );
}

/** KB-332 (D84): the app's language on this phone only - changes at once; the page stays open. */
export function LanguagePage({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT();
  return (
    <InnerPage title={t("more.appLanguage")} backKey="kbLanguage" onClose={onClose}>
      <p className={help}>{t("settings.screenLanguageHelp")}</p>
      <ChoiceList label={t("more.appLanguage")} options={SCREEN_LANGUAGES} value={lang} onChange={setScreenLanguage} />
    </InnerPage>
  );
}

/** KB-313: what the header chip knows, said in full - nothing new is measured. */
export function SyncPage({ sync, onClose }: { sync: SyncState; onClose: () => void }) {
  const { t } = useT();
  const state = useSyncStateText(sync);
  const { pending, conflict, lastAttemptAt } = sync.detail;
  return (
    <InnerPage title={t("more.sync")} backKey="kbSync" onClose={onClose}>
      <p className="text-kb-16 font-semibold">{state}</p>
      {pending > 0 && <p>{t(pending === 1 ? "sync.pending.one" : "sync.pending.many", { n: pending })}</p>}
      {conflict > 0 && <p>{t(conflict === 1 ? "sync.conflict.one" : "sync.conflict.many", { n: conflict })}</p>}
      {sync.chip && lastAttemptAt && <p className={help}>{t("sync.lastTried", { time: timeOf(lastAttemptAt) })}</p>}
      {sync.chip && <p className="font-semibold">{t("sync.continues")}</p>}
    </InnerPage>
  );
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** KB-401 (KI-68): is this phone's storage protected from the browser's clean-up? A fact for the pilot check - never an alarm. */
function StorageLine({ deviceDb }: { deviceDb: DeviceDB }) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  useEffect(() => {
    void readStorageStatus(deviceDb).then((r) => setStatus(r.status));
  }, [deviceDb]);
  return status === null ? null : <p className={help}>{storageStatusText(status, isIos())}</p>;
}

interface Learning {
  /** KB-323: `confidence` is the one DERIVED from the events when they know the phrase (the row is only this phone's cache). */
  aliases: { row: LocalLearnedAlias; product: string; confidence: number }[];
  provisional: LocalProvisionalProduct[];
  suggestions: { s: PriceSuggestion; name: string; unit: string; nowPaise: number }[];
  /** KB-329: suggestions hidden by [Ignore], with the end of each ignore. */
  ignored: { s: PriceSuggestion; name: string; unit: string; nowPaise: number; untilMs: number }[];
}

const times = (n: number) => (n === 1 ? "once" : `${n} times`);
const heading = "text-kb-12 font-bold uppercase tracking-[.5px] text-kb-sub";
const smallBtn = "kb-hit min-h-11 self-start rounded-[12px] border border-kb-border bg-kb-card px-4 font-semibold";

/**
 * 08 section 9 (KB-312), as today's Developer mode, now its own page (English in every language, as before): storage, learned
 * aliases, provisional products, price suggestions, read-only; the pilot numbers; Reset learning behind a confirmation (local-only,
 * NI-27, and it says so); the version.
 */
export function DeveloperPage({ localDb, shopId, deviceId, deviceDb, reconcile, shop, onClose }: {
  localDb: KiranaBillDB;
  /** KB-416: the 60-line printer test (Android app, a printer chosen) */
  shop?: LocalShop;
  shopId: string;
  deviceId: string;
  deviceDb?: DeviceDB;
  reconcile?: () => Promise<ReconcileResult>;
  onClose: () => void;
}) {
  const [learning, setLearning] = useState<Learning | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [aliases, derivedAliases, provisional, suggestions, ignored, products] = await Promise.all([
      listLearnedAliases(localDb, shopId),
      deriveShopAliases(localDb, shopId),
      listProvisionalProducts(localDb, shopId),
      listPendingPriceSuggestions(localDb, shopId, Date.now()),
      listIgnoredPriceSuggestions(localDb, shopId, Date.now()),
      localDb.shopProducts.where("shopId").equals(shopId).toArray(),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const derived = new Map(derivedAliases.map((d) => [d.aliasKey, d]));
    setLearning({
      aliases: [...aliases].sort((a, b) => b.hitCount - a.hitCount).map((row) => {
        const d = derived.get(aliasKeyOf(row.alias));
        const p = byId.get(d?.catalogId ?? row.shopProductId);
        return { row, confidence: d ? (d.active ? d.confidence : 0) : row.confidence, product: p ? (p.isActive ? p.displayName : `${p.displayName} (archived)`) : "(removed product)" }; // KB-330: archived = dormant, not removed
      }),
      provisional: provisional.filter((p) => p.promotedAt === null),
      suggestions: suggestions.flatMap((s) => {
        const p = byId.get(s.catalogId);
        return p && p.pricePaise !== s.suggestedPricePaise ? [{ s, name: p.displayName, unit: p.unit, nowPaise: p.pricePaise }] : [];
      }),
      ignored: ignored.flatMap(({ suggestion: s, ignoredUntilMs: untilMs }) => {
        const p = byId.get(s.catalogId);
        return p && p.pricePaise !== s.suggestedPricePaise ? [{ s, name: p.displayName, unit: p.unit, nowPaise: p.pricePaise, untilMs }] : [];
      }),
    });
  }, [localDb, shopId]);

  useEffect(() => {
    load().catch((err: unknown) => console.warn("[more] learning load failed:", err instanceof Error ? err.message : err));
  }, [load]);

  const reset = async () => {
    const r = await resetLearning(localDb, shopId, Date.now(), deviceId);
    const c = r.clearedCounts;
    await load(); // the lists first, so the message never appears over lists that are still full
    setConfirming(false);
    setResetMessage(
      `Cleared on this phone: ${c.learnedAliases} learned aliases, ${c.provisionalProducts} provisional products, ${c.priceObservations} price records. The server's copy was not deleted.`,
    );
  };

  const empty = learning !== null && learning.aliases.length === 0 && learning.provisional.length === 0 && learning.suggestions.length === 0 && learning.ignored.length === 0;

  return (
    <InnerPage title="Developer" backKey="kbDeveloper" onClose={onClose}>
      <div data-testid="developer" className="flex flex-col gap-4">
        <p className={help}>What the app has learned about this shop on this phone. Nothing here changes a price or a unit.</p>
        {deviceDb && <StorageLine deviceDb={deviceDb} />}
        {shop && isNativeApp() && <LongTestPrint shop={shop} />}
        {learning && (
          <>
            {learning.aliases.length > 0 && (
              <div>
                <h2 className={heading}>Learned aliases</h2>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.aliases.map(({ row, product, confidence }) => (
                    <li key={row.localId}>
                      {row.alias} → {product} · seen {times(row.hitCount)} · {Math.round(confidence * 100)}%
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {learning.provisional.length > 0 && (
              <div>
                <h2 className={heading}>Heard, not in the catalog</h2>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.provisional.map((p) => (
                    <li key={p.localId}>
                      “{p.spokenName}” — said {times(p.seenCount)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {learning.suggestions.length > 0 && (
              <div>
                <h2 className={heading}>Price suggestions</h2>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.suggestions.map(({ s, name, unit, nowPaise }) => (
                    <li key={s.catalogId}>{priceDriftText(name, unit, s.suggestedPricePaise, s.observationCount, nowPaise)}</li>
                  ))}
                </ul>
              </div>
            )}
            {learning.ignored.length > 0 && (
              <div>
                <h2 className={heading}>Ignored price suggestions</h2>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.ignored.map(({ s, name, unit, nowPaise, untilMs }) => (
                    <li key={s.catalogId}>
                      {priceDriftText(name, unit, s.suggestedPricePaise, s.observationCount, nowPaise)} — ignored until{" "}
                      {new Date(untilMs).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {empty && <p>Nothing learned on this phone yet.</p>}
          </>
        )}

        <PilotNumbers localDb={localDb} shopId={shopId} reconcile={reconcile} />

        {resetMessage && (
          <p role="status" className={help}>
            {resetMessage}
          </p>
        )}
        {confirming ? (
          <div role="alertdialog" aria-label="Reset learning?" className="flex flex-col gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px]">
            <p>Clear what the app has learned on this phone? Your bills and catalog are not touched. The server keeps its copy.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming(false)} className={smallBtn}>
                Cancel
              </button>
              <button type="button" onClick={() => void reset()} className={`${smallBtn} text-kb-err`}>
                Clear learning on this phone
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setResetMessage(null);
              setConfirming(true);
            }}
            className={smallBtn}
          >
            Reset learning
          </button>
        )}
        <p className={help}>Version {BUILD_ID}</p>
      </div>
    </InnerPage>
  );
}

/** KB-430: the shop's name as typed - case, outer spaces and runs of spaces do not matter (NFC, so a Hindi name typed two ways is one). */
export const sameShopName = (typed: string, name: string): boolean => {
  const norm = (x: string) => x.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return norm(typed) !== "" && norm(typed) === norm(name);
};

/**
 * KB-430 (D119, owner 20 Nov 2026): More -> Account -> Delete account. What goes is said plainly (the shop, its bills, items and
 * learned names, the login); bills not yet on the server and a bill in progress are named; the shop's name must be typed; offline
 * the button stays off - the server deletes all or nothing, and the phone is cleared only after it (accountDeletion.ts).
 */
export function AccountPage({ localDb, shop, sync, billInProgress, onDeleteAccount, onClose }: {
  localDb: KiranaBillDB;
  shop: LocalShop;
  sync: SyncState;
  billInProgress: boolean;
  onDeleteAccount: () => Promise<DeleteOutcome>;
  onClose: () => void;
}) {
  const { t } = useT();
  const online = useBrowserOnline();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ bills: number; items: number; learned: number } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      localDb.bills.where("[shopId+status]").anyOf([[shop.id, "final"], [shop.id, "cancelled"]]).count(),
      localDb.shopProducts.where("shopId").equals(shop.id).filter((p) => p.isActive).count(),
      deriveShopAliases(localDb, shop.id).then((a) => a.filter((x) => x.active).length),
    ]).then(([bills, items, learned]) => live && setCounts({ bills, items, learned }), () => {});
    return () => {
      live = false;
    };
  }, [localDb, shop.id]);
  const waiting = sync.unsynced.pending + sync.unsynced.conflict;
  const ready = online && !busy && sameShopName(typed, shop.name);
  const onDelete = () => {
    if (!ready) return;
    setBusy(true);
    setNote(null);
    void onDeleteAccount().then((out) => {
      setBusy(false);
      if (out.kind === "offline") setNote(t("account.needsInternet"));
      else if (out.kind === "shared_shop") setNote(t("account.shared"));
      else if (out.kind === "failed") setNote(t("account.failed"));
      // "deleted": the app is signed out and leaves this page
    }, () => {
      setBusy(false);
      setNote(t("account.failed"));
    });
  };
  return (
    <InnerPage title={t("account.title")} backKey="kbAccount" onClose={onClose}>
      {!confirming ? (
        <ListCard>
          <ListRow icon={KB_ICONS.TriangleAlert} title={t("account.deleteRow")} sub={t("account.deleteSub")} onClick={() => setConfirming(true)} />
        </ListCard>
      ) : (
        <>
          <p className="font-semibold">{t("account.whatGoes")}</p>
          <ul className="list-disc pl-5">
            <li>{t("account.shopLine", { name: shop.name })}</li>
            {counts && <li>{t("account.counts", { bills: counts.bills, items: counts.items, learned: counts.learned })}</li>}
            <li>{t("account.loginLine")}</li>
          </ul>
          {waiting > 0 && <p role="alert" className="font-semibold text-kb-err">{t("account.waiting", { n: waiting })}</p>}
          {billInProgress && <p role="alert" className="font-semibold text-kb-err">{t("account.inProgress")}</p>}
          <TextField label={t("account.typeName")} value={typed} onChange={setTyped} placeholder={shop.name} />
          {!online && <p className={help}>{t("account.needsInternet")}</p>}
          {note && <p role="status" className="font-semibold text-kb-err">{note}</p>}
          <Button variant="destructive" ariaDisabled={!ready} onClick={onDelete}>
            {busy ? t("account.deleting") : t("account.deleteButton")}
          </Button>
        </>
      )}
    </InnerPage>
  );
}
