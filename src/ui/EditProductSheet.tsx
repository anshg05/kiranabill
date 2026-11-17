import { useMemo, useState } from "react";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { LocalShopProduct } from "@/data/db";
import { MAX_RATE_PAISE, parseMoneyInput } from "@/domain/billEdit";
import { checkAliases, checkName, lostNameNote, productPatch, type OtherProduct, type ProductPatch } from "@/domain/catalogEdit";
import { nameKey } from "@/domain/catalogImport";
import { plainRupees } from "@/domain/money";
import { useBackEntry } from "./useBackEntry";
import { useHidesNav } from "./AppTabs";
import { useDiscardGuard } from "./useDiscardGuard";
import { FieldError, ItemPage, PageNote } from "./ItemPage";
import { OtherNamesField } from "./OtherNamesField";
import { Button } from "./kit/Button";
import { TextField } from "./kit/TextField";
import { KB_ICONS } from "./kit/icons";
import { useT } from "./useT";

// KB-330 (D71, D77): rename, other names (aliases) and archive for ONE product. The unit is shown, never editable (a unit
// sets what the price means - the remedy is archive + Add product). Save sends only the columns that changed, and the
// aliases only if their text was touched - a pure rename never rewrites a list the shopkeeper did not open. Everything
// the import would refuse is refused here, with the same reasons, BEFORE any write.
// KB-414 step 3 (owner + reviewer, 17 Nov 2026): 19's look, filled ("Edit item"); the other names as chips; the PRICE moved here from the
// row (today's price writer, whole paise, parseMoneyInput as the row did) and "Used N times in the last 30 days" with it; Save item;
// Archive. Changed details and a changed price are two writes (today's two writers) - the first that fails stops and says so.

export const OFFLINE_NOTE = "Needs internet to change the catalog";
export const SAVE_FAILED_TEXT = "Couldn't save — check the internet and try again";

interface Props {
  product: LocalShopProduct;
  /** Every OTHER product of the shop, archived ones included. */
  others: readonly OtherProduct[];
  online: boolean;
  /** The changed details (or {}) and the new price in paise (or null): the page closes when both are written. */
  onSave: (patch: ProductPatch, pricePaise: number | null) => Promise<CatalogWriteResult>;
  /** Absent for an archived product (already archived). */
  onArchive?: () => Promise<CatalogWriteResult>;
  onClose: () => void;
  /** KB-350: what another phone changed on this product while the sheet is open - shown, never applied over his typing. */
  changedNote?: string | null;
  /** "Used 3 times in the last 30 days" (KB-321) - moved here from the row. */
  used?: string;
}

export function EditProductSheet({ product, others, online, onSave, onArchive, onClose, changedNote, used }: Props) {
  const { t, tx } = useT();
  const initialAliases = product.aliases.join("\n");
  const initialPrice = plainRupees(product.pricePaise);
  const [name, setName] = useState(product.displayName);
  const [aliasText, setAliasText] = useState(initialAliases);
  const [price, setPrice] = useState(initialPrice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameCheck = useMemo(() => checkName(name, others), [name, others]);
  const finalName = nameCheck.ok ? nameCheck.name : product.displayName;
  const aliasesTouched = aliasText !== initialAliases;
  const aliasCheck = useMemo(() => checkAliases(finalName, aliasText, others), [finalName, aliasText, others]);
  const patch: ProductPatch = nameCheck.ok
    ? productPatch(
        { displayName: product.displayName, aliases: product.aliases },
        { displayName: nameCheck.name, aliases: aliasesTouched ? aliasCheck.aliases : product.aliases },
      )
    : {};
  const priceTouched = product.isActive && price.trim() !== initialPrice;
  const changed = Object.keys(patch).length > 0 || priceTouched;
  const lost = nameCheck.ok ? lostNameNote(product.displayName, nameCheck.name, aliasesTouched ? aliasCheck.aliases : product.aliases.map(nameKey)) : null;
  const canWrite = online && !busy;
  const guard = useDiscardGuard(name !== product.displayName || aliasesTouched || priceTouched, onClose);
  useBackEntry("kbEditProduct", guard.requestClose, guard.canClose);
  useHidesNav(); // KB-414: no nav over this page (it is drawn inside a tab screen, under the nav)

  const run = async (write: () => Promise<CatalogWriteResult>, clashName: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await write();
      if (!r.ok) setError(r.reason === "duplicate" ? `Another product is already called “${clashName}”` : SAVE_FAILED_TEXT);
    } catch {
      setError(SAVE_FAILED_TEXT);
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    let paise: number | null = null;
    if (priceTouched) {
      const r = parseMoneyInput(price, MAX_RATE_PAISE);
      if (!r.ok) return setError(r.error);
      paise = r.value === product.pricePaise ? null : r.value;
    }
    void run(() => onSave(patch, paise), finalName);
  };

  return (
    <ItemPage
      title={t("product.editTitle")}
      onBack={guard.requestClose}
      footer={
        <>
          <Button variant="primary" icon={KB_ICONS.Check} disabled={!canWrite || !nameCheck.ok || !changed} onClick={save}>
            {t("items.save")}
          </Button>
          {canWrite && nameCheck.ok && !changed && <p className="text-center text-kb-13 text-kb-sub">{t("reason.noChanges")}</p>}
          {onArchive && (
            <Button variant="destructive-text" ariaLabel={t("product.archiveLabel")} disabled={!canWrite} onClick={() => void run(onArchive, product.displayName)}>
              {t("product.archive")}
            </Button>
          )}
          {guard.dialog}
        </>
      }
    >
      {!online && <PageNote>{tx(OFFLINE_NOTE)}</PageNote>}
      {changedNote && (
        <p role="status" className="rounded-[12px] border border-kb-border bg-kb-card px-3 py-[10px] text-kb-13 text-kb-sub">
          {changedNote}
        </p>
      )}
      <TextField label={t("product.name")} value={name} onChange={setName} />
      {!nameCheck.ok && <FieldError>{tx(nameCheck.error)}</FieldError>}
      {lost && (
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-kb-13">
          <span>{tx(lost)}</span>
          <Button
            variant="secondary"
            height={46}
            fill={false}
            className="px-3"
            ariaLabel={t("product.keepNameLabel", { name: product.displayName })}
            onClick={() => setAliasText((a) => (a.trim() === "" ? nameKey(product.displayName) : `${a.replace(/\s+$/, "")}\n${nameKey(product.displayName)}`))}
          >
            {t("product.keepName")}
          </Button>
        </div>
      )}
      <OtherNamesField ownName={name} text={aliasText} onText={setAliasText} others={others} showDropped={aliasesTouched} />
      <div className="flex flex-col gap-2">
        <p className="text-kb-14 font-semibold">{t("items.soldBy")}</p>
        <PageNote>{t("product.unitFixed", { unit: product.unit })}</PageNote>
      </div>
      {product.isActive && (
        <TextField label={t("items.pricePer", { unit: product.unit })} value={price} onChange={setPrice} prefix="₹" inputMode="decimal" helper={used} />
      )}
      {error && <FieldError>{tx(error)}</FieldError>}
    </ItemPage>
  );
}
