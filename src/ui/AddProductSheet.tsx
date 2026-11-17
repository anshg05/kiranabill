import { useId, useState } from "react";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import { checkNewProduct, type NewProduct, type OtherProduct } from "@/domain/catalogEdit";
import { normalizeUnit } from "@/domain/catalogImport";
import { useBackEntry } from "./useBackEntry";
import { useHidesNav } from "./AppTabs";
import { useDiscardGuard } from "./useDiscardGuard";
import { OFFLINE_NOTE, SAVE_FAILED_TEXT } from "./EditProductSheet";
import { FieldError, ItemPage, PageNote } from "./ItemPage";
import { OtherNamesField } from "./OtherNamesField";
import { Button } from "./kit/Button";
import { TextField } from "./kit/TextField";
import { KB_ICONS } from "./kit/icons";
import { useT } from "./useT";

// KB-330 (D77, owner 11 Oct 2026): "Add product" - a shop's own product with a name, a unit and a price, so anything
// outside the Ready catalog doesn't stay bill-only and priced by hand every time. It is the import's row, judged by the
// import's rules (domain/catalogEdit.ts checkNewProduct) and written through the import's insert path. EVERY field starts
// empty and stays what the shopkeeper typed: the app never picks a unit or a price (hard rule 7).
// KB-414 step 3 (owner + reviewer, 17 Nov 2026): 19-AddItem's look - "Add item"; the other names customers say, saved WITH the item
// (one write, Edit's rules); "Sold by" = today's unit chips + "Other…" (today's typed unit and its hint); "Price per kg" with 19's
// helper. Pack size (drawn) is not built (12 SG-33).

const UNIT_CHIPS = ["kg", "gm", "liter", "ml", "piece"] as const;

interface Props {
  existing: readonly OtherProduct[];
  online: boolean;
  onCreate: (product: NewProduct) => Promise<CatalogWriteResult>;
  onClose: () => void;
}

type Errors = { name?: string; unit?: string; price?: string };

export function AddProductSheet({ existing, online, onCreate, onClose }: Props) {
  const { t, tx } = useT();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [other, setOther] = useState(false);
  const [price, setPrice] = useState("");
  const [aliases, setAliases] = useState("");
  const guard = useDiscardGuard(name.trim() !== "" || unit.trim() !== "" || price.trim() !== "" || aliases.trim() !== "", onClose);
  useBackEntry("kbAddProduct", guard.requestClose, guard.canClose);
  useHidesNav(); // KB-414: no nav over this page (it is drawn inside a tab screen, under the nav)
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typedUnit = normalizeUnit(unit);
  const soldBy = useId();

  const submit = async () => {
    setServerError(null);
    const r = checkNewProduct({ name, unit, price, aliases }, existing, existing.length);
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

  const chip = (on: boolean) =>
    `kb-hit min-h-[40px] rounded-[12px] px-[14px] text-kb-15 font-bold ${on ? "bg-kb-primary text-kb-card" : "border border-kb-border bg-kb-card text-kb-ink"}`;
  return (
    <ItemPage
      title={t("add.title")}
      onBack={guard.requestClose}
      footer={
        <>
          <Button variant="primary" icon={KB_ICONS.Check} disabled={!online || busy} onClick={() => void submit()}>
            {t("items.save")}
          </Button>
          {guard.dialog}
        </>
      }
    >
      {!online && <PageNote>{tx(OFFLINE_NOTE)}</PageNote>}
      <TextField label={t("product.name")} value={name} onChange={setName} />
      {errors.name && <FieldError>{tx(errors.name)}</FieldError>}
      <OtherNamesField ownName={name} text={aliases} onText={setAliases} others={existing} showDropped />
      <div className="flex flex-col gap-2">
        <p id={soldBy} className="text-kb-14 font-semibold">{t("items.soldBy")}</p>
        {/* 8 px apart as drawn; a tap area counts from inside the 1 px border, so the gap it may share is 10 */}
        <div role="radiogroup" aria-labelledby={soldBy} className="flex flex-wrap gap-2 [--kb-gap-x:10px] [--kb-gap-y:10px]">
          {UNIT_CHIPS.map((u) => (
            <button key={u} type="button" role="radio" aria-checked={!other && unit === u} onClick={() => (setOther(false), setUnit(u))} className={chip(!other && unit === u)}>
              {u}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={other} onClick={() => (setOther(true), setUnit(""))} className={chip(other)}>
            {t("items.otherUnit")}
          </button>
        </div>
        {other && <TextField label={t("col.unit")} value={unit} onChange={setUnit} placeholder={t("product.unitPlaceholder")} />}
        {other && typedUnit && !typedUnit.known && (
          <p className="text-kb-13 text-kb-sub [overflow-wrap:anywhere]">{t("product.unitUnknown", { unit: typedUnit.unit, list: UNIT_CHIPS.join(", ") })}</p>
        )}
      </div>
      {errors.unit && <FieldError>{tx(errors.unit)}</FieldError>}
      <TextField
        label={typedUnit ? t("items.pricePer", { unit: typedUnit.unit }) : t("product.price")}
        value={price}
        onChange={setPrice}
        prefix="₹"
        inputMode="decimal"
        helper={t("items.priceHelp")}
      />
      {errors.price && <FieldError>{tx(errors.price)}</FieldError>}
      {serverError && <FieldError>{tx(serverError)}</FieldError>}
    </ItemPage>
  );
}
