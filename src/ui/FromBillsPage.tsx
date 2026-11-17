import type { LocalProvisionalProduct, LocalShopProduct } from "@/data/db";
import { formatRupees } from "@/domain/money";
import type { PriceSuggestion } from "@/domain/learning";
import { useBackEntry } from "./useBackEntry";
import { useHidesNav } from "./AppTabs";
import { Button } from "./kit/Button";
import { GroupLabel } from "./kit/ListRow";
import { TopBar } from "./kit/TopBar";
import { useT } from "./useT";

export interface LearnedName {
  alias: string;
  catalogId: string;
  productName: string;
  confidence: number;
  inUse: boolean;
}

/**
 * KB-414 step 3 (owner + reviewer, 17 Nov 2026; mock C): what the app picked up from the bills, moved off the Items list behind one
 * banner - today's three blocks, unchanged in what they do: a price paid on 3 bills with Use (a catalog write - online) / Ignore (a local
 * learning write - works offline, KB-329); the names said but not in the catalog (read only, KB-320 saves them). KB-414 step 3 phone check
 * (owner + reviewer, 17 Nov 2026): only what needs a decision - the learned names moved to the Learned chip (LearnedNames below); was: the learned names
 * with Remove (a local event - works offline, KB-323). An inner page: Back, no nav.
 */
export function FromBillsPage({ suggestions, provisional, online, saving, failed, note, ignoreFailed, onUse, onIgnore, onClose }: {
  suggestions: readonly { s: PriceSuggestion; p: LocalShopProduct }[];
  provisional: readonly LocalProvisionalProduct[];
  online: boolean;
  saving: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  note: string | null;
  ignoreFailed: boolean;
  onUse: (p: LocalShopProduct, pricePaise: number) => void;
  onIgnore?: (p: LocalShopProduct) => void;
  onClose: () => void;
}) {
  useBackEntry("kbFromBills", onClose);
  useHidesNav();
  const { t, tx } = useT();
  const card = "flex flex-col gap-2 rounded-[16px] border border-kb-border bg-kb-card px-[14px] py-3 text-kb-15 [overflow-wrap:anywhere]";
  const empty = suggestions.length === 0 && provisional.length === 0;
  return (
    <section aria-label={t("items.fromBills")} className="font-kb fixed inset-x-0 top-[var(--kb-tab-top,0px)] bottom-0 z-30 flex flex-col bg-kb-bg text-kb-ink">
      <div data-scroll-page className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-y-auto">
        <TopBar title={t("items.fromBills")} backLabel={t("settings.back")} onBack={onClose} />
        <div className="flex flex-col gap-[10px] px-4 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
          {note && <p role="status" className="rounded-[12px] bg-kb-primary-pale px-3 py-[10px] text-kb-13 [overflow-wrap:anywhere]">{tx(note)}</p>}
          {ignoreFailed && <p role="alert" className="text-kb-13 text-kb-err">{t("catalog.hideFailed")}</p>}
          {empty && <p className="py-6 text-center text-kb-15 text-kb-sub">{t("items.nothing")}</p>}
          {suggestions.length > 0 && (
            <section aria-label={t("items.pricesHead")} className="flex flex-col gap-2">
              <GroupLabel>{t("items.pricesHead")}</GroupLabel>
              <ul className="flex flex-col gap-2">
              {suggestions.map(({ s, p }) => (
                <li key={p.id} className={card}>
                  <span>{t("catalog.priceDrift", { name: p.displayName, price: formatRupees(s.suggestedPricePaise), unit: p.unit, bills: s.observationCount, now: formatRupees(p.pricePaise) })}</span>
                  <div className="flex flex-wrap gap-2 [--kb-gap-x:8px] [--kb-gap-y:8px]">
                    <Button
                      variant="primary"
                      height={46}
                      fill={false}
                      className="px-4"
                      ariaLabel={t("catalog.useLabel", { price: formatRupees(s.suggestedPricePaise), name: p.displayName })}
                      ariaDisabled={!online || saving.has(p.id)}
                      onClick={online && !saving.has(p.id) ? () => onUse(p, s.suggestedPricePaise) : undefined}
                    >
                      {t("catalog.use", { price: formatRupees(s.suggestedPricePaise) })}
                    </Button>
                    {onIgnore && (
                      <Button variant="secondary" height={46} fill={false} className="px-4" ariaLabel={t("catalog.ignoreLabel", { name: p.displayName })} onClick={() => onIgnore(p)}>
                        {t("catalog.ignore")}
                      </Button>
                    )}
                  </div>
                  {saving.has(p.id) && <span className="text-kb-13 text-kb-sub">{t("catalog.saving")}</span>}
                  {failed.has(p.id) && <span role="alert" className="text-kb-13 text-kb-err">{tx("Couldn't save — check the internet and try again")}</span>}
                </li>
              ))}
              </ul>
              {!online && <p className="px-1 text-kb-13 text-kb-sub">{tx("Needs internet to change the catalog")}</p>}
            </section>
          )}
          {provisional.length > 0 && (
            <section aria-label={t("items.saidHead")} className="flex flex-col gap-2">
              <GroupLabel>{t("items.saidHead")}</GroupLabel>
              <ul className="flex flex-col gap-2">
                {provisional.map((p) => (
                  <li key={p.localId} className={`${card} text-kb-sub`}>
                    {t("catalog.provisional", { name: p.spokenName, n: p.seenCount })}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

const learnedCard = "flex flex-row flex-wrap items-center justify-between gap-2 border-b border-kb-border px-[14px] py-3 text-kb-15 last:border-b-0 [overflow-wrap:anywhere]";

/**
 * KB-414 step 3 phone check (owner + reviewer, 17 Nov 2026): the Learned chip - every name the app learned for an item ("said name ->
 * item · In use / Still learning (N%)") with Remove (a local event - works offline, KB-323). Nothing learned and nothing added from bills:
 * how learning really works (domain/learning.ts: a SAVED bill's VOICE lines teach the names said; typed lines never do).
 */
export function LearnedNames({ learned, empty, onRemove }: { learned: readonly LearnedName[]; empty: boolean; onRemove?: (l: LearnedName) => void }) {
  const { t } = useT();
  if (learned.length === 0)
    return empty ? (
      <div className="rounded-[16px] border border-kb-border bg-kb-card px-4 py-[18px] text-center text-kb-15 leading-[1.5] text-kb-sub">
        <p className="mb-1 text-kb-16 font-bold text-kb-ink">{t("items.learnedEmptyTitle")}</p>
        <p>{t("items.learnedEmpty")}</p>
      </div>
    ) : null;
  return (
    <section aria-label={t("items.learnedHead")} className="flex flex-none flex-col gap-2">
      <GroupLabel>{t("items.learnedHead")}</GroupLabel>
      <ul className="flex-none overflow-hidden rounded-[16px] border border-kb-border bg-kb-card">
        {learned.map((l) => (
          <li key={l.alias.toLowerCase()} className={learnedCard}>
            <span className="min-w-0 flex-1">
              {t("catalog.learnedRow", { alias: l.alias, name: l.productName, state: t(l.inUse ? "catalog.inUse" : "catalog.stillLearning"), pct: Math.round(l.confidence * 100) })}
            </span>
            {onRemove && (
              <Button variant="secondary" height={46} fill={false} className="px-4" ariaLabel={t("catalog.removeLabel", { alias: l.alias, name: l.productName })} onClick={() => onRemove(l)}>
                {t("col.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
