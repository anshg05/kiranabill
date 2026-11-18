import { Fragment, useState } from "react";
import { numberChunks, type Receipt as ReceiptModel } from "@/domain/receipt";

// KB-308: the kirana parchi (05 §6), in the legacy layout (D57). Every value is a React text node - never
// raw HTML (hard rule 9; lint bans it). The three number columns never wrap; the item column takes the
// rest and wraps - a long name, Hindi included, stays inside it.
// KB-413 step 4 (owner, 16 Nov 2026): design 13's receipt look (26 §5) - white paper (the frame, its shadow and torn edge are
// kit/ReceiptPaper), IBM Plex Mono with Noto Sans Devanagari for Devanagari (--font-mono; Mukta removed in KB-429), the shop name 15 / 700 tracked .5, small lines 11
// in the receipt grey, rows 12 with qty and rate in the darker grey and the amount bold, a 2 px rule under the header, light rules
// between rows, TOTAL 16 / 700 between dashed rules. Sizes are the rem text steps, so the phone's text size grows them. The content and
// its order are today's (D110); the share image draws the same (SCREEN_STYLE), the PRINTED bill keeps its own style.

const rule = "border-t border-dashed border-kb-receipt-rule";

/** Q1 A: a receipt number that may break only after a hyphen - a browser won't
 * break "-1234", so a fallback number needs explicit points - and copies as
 * one string (<wbr> adds no characters). The receipt and the saved status. */
export function ReceiptNumberText({ value }: { value: string }) {
  const chunks = numberChunks(value);
  return chunks.map((chunk, i) => (
    <Fragment key={i}>
      {chunk}
      {i < chunks.length - 1 && <wbr />}
    </Fragment>
  ));
}

export function Receipt({ receipt }: { receipt: ReceiptModel }) {
  // Q4 (owner): a logo only when it loads - offline or broken, it's left out.
  const [logoFailed, setLogoFailed] = useState(false);
  const r = receipt;
  return (
    <article aria-label="Receipt" className="w-full bg-kb-card px-4 pt-[14px] pb-2 font-mono text-kb-12 text-kb-ink">
      {/* D57: the legacy parchi's layout - name large and bold, then small muted lines. */}
      <header className="text-center">
        {r.logoUrl && !logoFailed && <img src={r.logoUrl} alt="" onError={() => setLogoFailed(true)} className="mx-auto mb-2 max-h-16" />}
        <p className="text-kb-15 font-bold uppercase tracking-[.5px] [overflow-wrap:anywhere]">{r.shopName}</p>
        {r.shopPhone && <p className="mt-[3px] text-kb-11 text-kb-receipt-sub tabular-nums">{r.shopPhone}</p>}
        <p className="mt-[3px] text-kb-11 text-kb-receipt-sub tabular-nums">{r.dateTime}</p>
        {/* KB-325 (D79): text, not colour alone. */}
        {r.cancelled && (
          <p data-testid="receipt-cancelled" role="note" className="mt-2 border-y-2 border-kb-err py-1 text-kb-14 font-bold tracking-wide text-kb-err">
            {r.cancelled}
          </p>
        )}
      </header>
      <hr className={`mt-2 mb-[6px] ${rule}`} />
      {/* Q1 A: the number breaks only after a hyphen and is one selectable string. */}
      <p data-testid="receipt-bill-no">
        {r.billNoLabel}{" "}
        <span data-testid="receipt-number" className="select-all font-bold">
          <ReceiptNumberText value={r.receiptNumber} />
        </span>
      </p>
      {r.replaces && (
        <p data-testid="receipt-replaces" className="text-kb-11 text-kb-receipt-sub [overflow-wrap:anywhere]">
          {r.replaces}
        </p>
      )}
      {r.customer && (
        <p data-testid="receipt-customer" className="[overflow-wrap:anywhere]">
          {r.customerLabel} {r.customer}
        </p>
      )}
      <hr className={`mt-[6px] mb-1 ${rule}`} />
      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr className="border-b-2 border-kb-receipt-strong text-left font-bold">
            <th scope="col" className="pb-[5px] pr-2">{r.headers.item}</th>
            <th scope="col" className="pb-[5px] pr-2">{r.headers.qty}</th>
            <th scope="col" className="pb-[5px] pr-2 text-right">{r.headers.rate}</th>
            <th scope="col" className="pb-[5px] text-right">{r.headers.amount}</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i} className="border-b border-kb-receipt-row align-top">
              <td className="w-full py-[5px] pr-2 [overflow-wrap:anywhere]">{row.name}</td>
              <td className="whitespace-nowrap py-[5px] pr-2 text-kb-receipt-strong">{row.qty}</td>
              <td className="whitespace-nowrap py-[5px] pr-2 text-right text-kb-receipt-strong">{row.rate}</td>
              <td className="whitespace-nowrap py-[5px] text-right font-bold">{row.amount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`text-kb-16 font-bold ${rule}`}>
            <th scope="row" colSpan={3} className="py-[7px] text-left">
              {r.totalLabel}
            </th>
            <td className="whitespace-nowrap py-[7px] text-right">{r.total}</td>
          </tr>
        </tfoot>
      </table>
      <footer className={`pt-1 text-center text-kb-11 text-kb-receipt-sub ${rule}`}>
        <p>{r.thanks}</p>
      </footer>
    </article>
  );
}
