import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import { checkNewProduct, type NewProduct, type OtherProduct } from "@/domain/catalogEdit";
import { normalizeUnit } from "@/domain/catalogImport";
import { useBackEntry } from "./useBackEntry";
import { OFFLINE_NOTE, SAVE_FAILED_TEXT } from "./EditProductSheet";

// KB-330 (D77, owner 11 Oct 2026): "Add product" - a shop's own product with a name, a unit and a price, so anything
// outside the Ready catalog doesn't stay bill-only and priced by hand every time. It is the import's row, judged by the
// import's rules (domain/catalogEdit.ts checkNewProduct) and written through the import's insert path. EVERY field starts
// empty and stays what the shopkeeper typed: the app never picks a unit or a price (hard rule 7).

const UNIT_CHIPS = ["kg", "gm", "liter", "ml", "piece"] as const;

interface Props {
  existing: readonly OtherProduct[];
  online: boolean;
  onCreate: (product: NewProduct) => Promise<CatalogWriteResult>;
  onClose: () => void;
}

type Errors = { name?: string; unit?: string; price?: string };

export function AddProductSheet({ existing, online, onCreate, onClose }: Props) {
  useBackEntry("kbAddProduct", onClose);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typedUnit = normalizeUnit(unit);
  const submit = async () => {
    setServerError(null);
    const r = checkNewProduct({ name, unit, price }, existing, existing.length);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setBusy(true);
    try {
      const w = await onCreate(r.product);
      if (!w.ok) setServerError(w.reason === "duplicate" ? `Another product is already called “${r.product.name}”` : SAVE_FAILED_TEXT);
    } catch {
      setServerError(SAVE_FAILED_TEXT);
    } finally {
      setBusy(false);
    }
  };

  const field = "min-h-11 rounded-[6px] border border-line bg-surface px-3";
  return (
    <section aria-label="Add product" className="fixed inset-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" onClick={onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Add product</h2>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {!online && <p className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">{OFFLINE_NOTE}</p>}

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink-soft">Name</span>
            <input type="text" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={field} />
          </label>
          {errors.name && (
            <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">
              {errors.name}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink-soft">Unit</span>
              <input type="text" aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} autoComplete="off" placeholder="kg, gm, liter, ml, piece…" className={field} />
            </label>
            <div className="flex flex-wrap gap-2">
              {UNIT_CHIPS.map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} className="min-h-11 rounded-[6px] border border-line bg-surface px-3 font-medium">
                  {u}
                </button>
              ))}
            </div>
            {typedUnit && !typedUnit.known && (
              <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">
                “{typedUnit.unit}” isn't one of {UNIT_CHIPS.join(", ")} — it is saved as typed.
              </p>
            )}
          </div>
          {errors.unit && (
            <p role="alert" className="text-[13px] text-danger">
              {errors.unit}
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink-soft">Price per unit</span>
            <input type="text" inputMode="decimal" aria-label="Price (₹)" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" placeholder="₹" className={field} />
          </label>
          {errors.price && (
            <p role="alert" className="text-[13px] text-danger">
              {errors.price}
            </p>
          )}

          {serverError && (
            <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">
              {serverError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={!online || busy}
            onClick={() => void submit()}
            className="min-h-11 rounded-[6px] bg-ink px-5 font-medium text-paper disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </section>
  );
}
