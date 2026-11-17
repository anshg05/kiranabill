import { useId, useState } from "react";
import { checkAliases, type OtherProduct } from "@/domain/catalogEdit";
import { nameKey, splitAliases } from "@/domain/catalogImport";
import { AddChip, RemovableChip } from "./kit/Chip";
import { useT } from "./useT";

/**
 * KB-414 step 3 (owner + reviewer, 17 Nov 2026): 19's "Other names customers say" - Add item and Edit item. The names are today's text
 * (one per line, the import's split and rules - checkAliases) shown as removable chips, with "+ Add name" for one more; the item's own
 * name is never a chip. A name another item already has is listed under "Not saved" with why - it never blocks the save.
 */
export function OtherNamesField({ ownName, text, onText, others, showDropped }: {
  ownName: string;
  text: string;
  onText: (text: string) => void;
  others: readonly OtherProduct[];
  /** Today's rule: the "Not saved" list only once the names were touched (a pure rename never judges an untouched list). */
  showDropped: boolean;
}) {
  const { t, tx } = useT();
  const labelId = useId();
  const [adding, setAdding] = useState<string | null>(null);
  const own = nameKey(ownName);
  const names = splitAliases(text).filter((a) => a !== own);
  const dropped = showDropped ? checkAliases(ownName, text, others).dropped : [];
  const commit = () => {
    if (adding !== null && adding.trim() !== "") onText(text.trim() === "" ? adding : `${text.replace(/\s+$/, "")}\n${adding}`);
    setAdding(null);
  };
  return (
    <div role="group" aria-labelledby={labelId} className="font-kb flex flex-col gap-2 text-kb-ink">
      <p id={labelId} className="text-kb-14 font-semibold">{t("product.otherNames")}</p>
      {/* 19 draws the rows 8 px apart; 14 here, so each x keeps 44 px and "+ Add name" 48 px without two tap areas touching */}
      <div className="flex flex-wrap gap-x-2 gap-y-[14px] [--kb-gap-x:8px] [--kb-gap-y:14px] [--kb-chip-gap-x:8px] [--kb-chip-gap-y:14px]">
        {names.map((n) => (
          <RemovableChip key={n} removeLabel={t("line.remove", { name: n })} onRemove={() => onText(splitAliases(text).filter((a) => a !== n).join("\n"))}>
            {n}
          </RemovableChip>
        ))}
        {adding === null && <AddChip onClick={() => setAdding("")}>{t("items.addName")}</AddChip>}
      </div>
      {adding !== null && (
        <input
          autoFocus
          aria-label={t("items.otherName")}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), commit());
            if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), setAdding(null));
          }}
          onBlur={commit}
          className="box-content min-h-[52px] rounded-[14px] border-[1.5px] border-kb-primary bg-kb-card px-[14px] text-kb-16 text-kb-ink outline-none ring-4 ring-kb-primary/10"
        />
      )}
      <p className="text-kb-13 text-kb-sub">{t("items.otherNamesHelp")}</p>
      {dropped.length > 0 && (
        <div className="text-kb-13">
          <p className="font-semibold text-kb-err">{t("product.notSaved")}</p>
          <ul aria-label={t("product.notSavedLabel")} className="mt-1 list-disc pl-5">
            {dropped.map((d) => (
              <li key={d.alias} className="[overflow-wrap:anywhere]">
                {t("product.aliasRow", { alias: d.alias, why: tx(d.why) })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
