import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { LocalShopProduct } from "@/data/db";
import { checkAliases, checkName, lostNameNote, productPatch, type OtherProduct, type ProductPatch } from "@/domain/catalogEdit";
import { nameKey } from "@/domain/catalogImport";
import { useBackEntry } from "./useBackEntry";

// KB-330 (D71, D77): rename, other names (aliases) and archive for ONE product. The unit is shown, never editable (a unit
// sets what the price means - the remedy is archive + Add product). Save sends only the columns that changed, and the
// aliases only if their text was touched - a pure rename never rewrites a list the shopkeeper did not open. Everything
// the import would refuse is refused here, with the same reasons, BEFORE any write.

export const OFFLINE_NOTE = "Needs internet to change the catalog";
export const SAVE_FAILED_TEXT = "Couldn't save — check the internet and try again";

interface Props {
  product: LocalShopProduct;
  /** Every OTHER product of the shop, archived ones included. */
  others: readonly OtherProduct[];
  online: boolean;
  onSave: (patch: ProductPatch) => Promise<CatalogWriteResult>;
  /** Absent for an archived product (already archived). */
  onArchive?: () => Promise<CatalogWriteResult>;
  onClose: () => void;
}

export function EditProductSheet({ product, others, online, onSave, onArchive, onClose }: Props) {
  useBackEntry("kbEditProduct", onClose);
  const initialAliases = product.aliases.join("\n");
  const [name, setName] = useState(product.displayName);
  const [aliasText, setAliasText] = useState(initialAliases);
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
  const changed = Object.keys(patch).length > 0;
  const lost = nameCheck.ok ? lostNameNote(product.displayName, nameCheck.name, aliasesTouched ? aliasCheck.aliases : product.aliases.map(nameKey)) : null;
  const canWrite = online && !busy;

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

  return (
    <section aria-label="Edit product" className="fixed inset-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Edit product</h2>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {!online && <p className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">{OFFLINE_NOTE}</p>}

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink-soft">Name</span>
            <input
              type="text"
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!nameCheck.ok}
              className="min-h-11 rounded-[6px] border border-line bg-surface px-3"
            />
          </label>
          {!nameCheck.ok && (
            <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">
              {nameCheck.error}
            </p>
          )}
          {lost && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span>{lost}</span>
              <button
                type="button"
                aria-label={`Keep “${product.displayName}” as another name`}
                onClick={() => setAliasText((t) => (t.trim() === "" ? nameKey(product.displayName) : `${t.replace(/\s+$/, "")}\n${nameKey(product.displayName)}`))}
                className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium"
              >
                Keep as another name
              </button>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink-soft">Other names</span>
            <textarea
              aria-label="Other names"
              rows={4}
              value={aliasText}
              onChange={(e) => setAliasText(e.target.value)}
              placeholder="What customers call it - one per line, or separated by commas"
              className="rounded-[6px] border border-line bg-surface px-3 py-2"
            />
          </label>
          {aliasesTouched && aliasCheck.dropped.length > 0 && (
            <div className="text-[13px]">
              <p className="font-medium text-danger">These will not be saved:</p>
              <ul aria-label="Not saved" className="mt-1 list-disc pl-5">
                {aliasCheck.dropped.map((d) => (
                  <li key={d.alias} className="[overflow-wrap:anywhere]">
                    “{d.alias}” — {d.why}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[13px] text-ink-soft">
            Unit: {product.unit}. A unit can't be changed here — it decides what the price means. To change it, archive this product and add it again with the right unit.
          </p>

          {error && (
            <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={!canWrite || !nameCheck.ok || !changed}
            onClick={() => void run(() => onSave(patch), finalName)}
            className="min-h-11 rounded-[6px] bg-ink px-5 font-medium text-paper disabled:opacity-50"
          >
            Save
          </button>
          {onArchive && (
            <button
              type="button"
              aria-label="Archive product"
              disabled={!canWrite}
              onClick={() => void run(onArchive, product.displayName)}
              className="ml-auto min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium disabled:opacity-50"
            >
              Archive
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
