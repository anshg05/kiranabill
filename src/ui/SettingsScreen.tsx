import { useCallback, useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { ArrowLeft } from "lucide-react";
import type { DeviceDB } from "@/data/device";
import type { KiranaBillDB, LocalLearnedAlias, LocalProvisionalProduct, LocalShop } from "@/data/db";
import { listLearnedAliases, listPendingPriceSuggestions, listProvisionalProducts, resetLearning } from "@/data/learningAudit";
import { updateShopSettings } from "@/data/shopSettings";
import { readStorageStatus, storageStatusText, type StorageStatus } from "@/data/storagePersist";
import { BUILD_ID } from "@/pwa/buildId";
import { formatMobile } from "@/domain/customer";
import type { PriceSuggestion } from "@/domain/learning";
import type { BillLanguage } from "@/domain/receipt";
import { parseShopName, parseShopPhone } from "@/domain/shopSettings";
import { priceDriftText } from "./priceDriftText";
import { useBackEntry } from "./useBackEntry";
import { useBrowserOnline } from "./useBrowserOnline";

// KB-312 (owner, 8 Oct 2026): S7 Settings, over the bill in progress.
// - Shop details: name and phone (both print on every receipt). Written to this phone first and pushed by the
//   ordinary sync (D64) - works offline. Address, logo (KB-327) and the receipt prefix are not editable here.
// - Receipt language: what the CUSTOMER's receipt is printed in (not the screen's language - KI-59). Saves at once.
//   A receipt opened from History is built from today's settings, so it changes too.
// - Developer mode (08 section 9): collapsed; this shop's learned aliases, provisional products and price
//   suggestions, read-only, and Reset learning behind a confirmation. The reset is local-only (NI-27) and says so.

const LANGUAGES: readonly { value: BillLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "both", label: "Both" },
];

const showPhone = (phone: string | null) => (phone === null ? "" : /^\d{10}$/.test(phone) ? formatMobile(phone) : phone);
const times = (n: number) => (n === 1 ? "once" : `${n} times`);
const field = "min-h-11 w-full rounded-[6px] border border-line bg-surface px-3";
const heading = "text-[13px] font-medium tracking-[0.02em] text-ink-soft";

interface SettingsScreenProps {
  localDb: KiranaBillDB;
  shopId: string;
  deviceId: string;
  /** KB-401: where "is this phone's storage protected?" is recorded (D67). */
  deviceDb?: DeviceDB;
  onClose: () => void;
}

export function SettingsScreen({ localDb, shopId, deviceId, deviceDb, onClose }: SettingsScreenProps) {
  useBackEntry("kbSettings", onClose);
  const online = useBrowserOnline();
  const [shop, setShop] = useState<LocalShop | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saved, setSaved] = useState(false);

  // The shop row, live: an edit that arrives from the server while this is open shows up. A field follows the
  // server unless the shopkeeper has changed it (it differs from the row as it was) - typing is never overwritten.
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
      error: (err: unknown) => console.warn("[settings] load failed:", err instanceof Error ? err.message : err),
    });
    return () => sub.unsubscribe();
  }, [localDb, shopId]);

  const dirty = shop !== null && (name !== shop.name || phone !== showPhone(shop.phone));

  const saveDetails = async () => {
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

  const chooseLanguage = async (billLanguage: BillLanguage) => {
    await updateShopSettings(localDb, shopId, { billLanguage });
    setSaved(true);
  };

  return (
    <section aria-label="Settings" className="fixed inset-0 z-20 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Settings</h2>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {shop && (
            <>
              <h3 className={heading}>Shop details</h3>
              <div className="mt-2 flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span>Shop name</span>
                  <input
                    type="text"
                    aria-label="Shop name"
                    value={name}
                    autoComplete="off"
                    onChange={(e) => {
                      setName(e.target.value);
                      setSaved(false);
                    }}
                    className={field}
                  />
                  {errors.name && (
                    <span role="alert" className="text-[13px] text-danger">
                      {errors.name}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span>Shop phone (optional)</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    aria-label="Shop phone"
                    value={phone}
                    autoComplete="off"
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setSaved(false);
                    }}
                    className={field}
                  />
                  {errors.phone && (
                    <span role="alert" className="text-[13px] text-danger">
                      {errors.phone}
                    </span>
                  )}
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    aria-disabled={!dirty}
                    onClick={dirty ? () => void saveDetails() : undefined}
                    className="min-h-11 rounded-[6px] border border-line bg-surface px-5 font-medium aria-disabled:opacity-50"
                  >
                    Save
                  </button>
                  {saved && (
                    <span role="status" className="text-[13px] text-ink-soft">
                      {online ? "Saved" : "Saved on this phone — it will sync when you're online"}
                    </span>
                  )}
                </div>
              </div>

              <h3 className={`${heading} mt-6`}>Receipt language</h3>
              <p className="mt-1 text-[13px] text-ink-soft">What your customer's receipt is printed in.</p>
              <div role="radiogroup" aria-label="Receipt language" className="mt-2 flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <label key={l.value} className="flex min-h-11 cursor-pointer items-center rounded-[6px] border border-line px-4 has-checked:border-ink has-checked:bg-ink has-checked:text-paper">
                    <input
                      type="radio"
                      name="bill-language"
                      value={l.value}
                      checked={shop.billLanguage === l.value}
                      onChange={() => void chooseLanguage(l.value)}
                      aria-label={l.label}
                      className="sr-only"
                    />
                    {l.label}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[13px] text-ink-soft">
                A receipt opened from History shows today's shop name, phone and language, not the ones it was first printed with.
              </p>

              <DeveloperMode localDb={localDb} shopId={shopId} deviceId={deviceId} deviceDb={deviceDb} />
              <p className="mt-6 text-[13px] text-ink-soft">Version {BUILD_ID}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** KB-401 (KI-68): is this phone's storage protected from the browser's clean-up? A fact for the pilot check - never an alarm. */
function StorageLine({ deviceDb }: { deviceDb: DeviceDB }) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  useEffect(() => {
    void readStorageStatus(deviceDb).then((r) => setStatus(r.status));
  }, [deviceDb]);
  return status === null ? null : <p className="text-[13px] text-ink-soft">{storageStatusText(status)}</p>;
}

interface Learning {
  aliases: { row: LocalLearnedAlias; product: string }[];
  provisional: LocalProvisionalProduct[];
  suggestions: { s: PriceSuggestion; name: string; unit: string; nowPaise: number }[];
}

/** 08 section 9 - learned aliases with confidence, provisional products with counts, pending price suggestions, a reset. Read-only, this shop only. */
function DeveloperMode({ localDb, shopId, deviceId, deviceDb }: { localDb: KiranaBillDB; shopId: string; deviceId: string; deviceDb?: DeviceDB }) {
  const [opened, setOpened] = useState(false);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [aliases, provisional, suggestions, products] = await Promise.all([
      listLearnedAliases(localDb, shopId),
      listProvisionalProducts(localDb, shopId),
      listPendingPriceSuggestions(localDb, shopId, Date.now()),
      localDb.shopProducts.where("shopId").equals(shopId).toArray(),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    setLearning({
      aliases: [...aliases].sort((a, b) => b.hitCount - a.hitCount).map((row) => ({ row, product: byId.get(row.shopProductId)?.displayName ?? "(removed product)" })),
      provisional: provisional.filter((p) => p.promotedAt === null),
      suggestions: suggestions.flatMap((s) => {
        const p = byId.get(s.catalogId);
        return p && p.pricePaise !== s.suggestedPricePaise ? [{ s, name: p.displayName, unit: p.unit, nowPaise: p.pricePaise }] : [];
      }),
    });
  }, [localDb, shopId]);

  useEffect(() => {
    if (opened) load().catch((err: unknown) => console.warn("[settings] learning load failed:", err instanceof Error ? err.message : err));
  }, [opened, load]);

  const reset = async () => {
    const r = await resetLearning(localDb, shopId, Date.now(), deviceId);
    const c = r.clearedCounts;
    setConfirming(false);
    setResetMessage(
      `Cleared on this phone: ${c.learnedAliases} learned aliases, ${c.provisionalProducts} provisional products, ${c.priceObservations} price records. The server's copy was not deleted.`,
    );
    await load();
  };

  const empty = learning !== null && learning.aliases.length === 0 && learning.provisional.length === 0 && learning.suggestions.length === 0;

  return (
    <details className="mt-8 border-t border-line pt-4" onToggle={(e) => setOpened((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="min-h-11 cursor-pointer font-medium">Developer mode</summary>
      <div className="mt-2 flex flex-col gap-4">
        <p className="text-[13px] text-ink-soft">What the app has learned about this shop on this phone. Nothing here changes a price or a unit.</p>
        {deviceDb && <StorageLine deviceDb={deviceDb} />}
        {learning && (
          <>
            {learning.aliases.length > 0 && (
              <div>
                <h4 className={heading}>Learned aliases</h4>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.aliases.map(({ row, product }) => (
                    <li key={row.localId} className="[overflow-wrap:anywhere]">
                      {row.alias} → {product} · seen {times(row.hitCount)} · {Math.round(row.confidence * 100)}%
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {learning.provisional.length > 0 && (
              <div>
                <h4 className={heading}>Heard, not in the catalog</h4>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.provisional.map((p) => (
                    <li key={p.localId} className="[overflow-wrap:anywhere]">
                      “{p.spokenName}” — said {times(p.seenCount)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {learning.suggestions.length > 0 && (
              <div>
                <h4 className={heading}>Price suggestions</h4>
                <ul className="mt-1 flex flex-col gap-1">
                  {learning.suggestions.map(({ s, name, unit, nowPaise }) => (
                    <li key={s.catalogId} className="[overflow-wrap:anywhere]">
                      {priceDriftText(name, unit, s.suggestedPricePaise, s.observationCount, nowPaise)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {empty && <p>Nothing learned on this phone yet.</p>}
          </>
        )}

        {resetMessage && (
          <p role="status" className="text-[13px] text-ink-soft">
            {resetMessage}
          </p>
        )}
        {confirming ? (
          <div role="alertdialog" aria-label="Reset learning?" className="flex flex-col gap-3 rounded-[6px] border border-line bg-surface p-3">
            <p>
              Clear what the app has learned on this phone? Your bills and catalog are not touched. The server keeps its copy.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-[6px] border border-line bg-paper px-4 font-medium">
                Cancel
              </button>
              <button type="button" onClick={() => void reset()} className="min-h-11 rounded-[6px] border border-danger px-4 font-medium text-danger">
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
            className="min-h-11 self-start rounded-[6px] border border-line bg-surface px-4 font-medium"
          >
            Reset learning
          </button>
        )}
      </div>
    </details>
  );
}
