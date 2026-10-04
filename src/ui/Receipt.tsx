import { Fragment, useState } from "react";
import { numberChunks, type Receipt as ReceiptModel } from "@/domain/receipt";

// KB-308: the kirana parchi (05 §6), in the legacy layout (D57). Every value is a React text node - never
// raw HTML (hard rule 9; lint bans it). Sized for a 58 mm thermal roll: at most
// 384 px wide, and 100% of what's left on a narrower phone (288 px at 320,
// 343 px at 375 with the 16 px gutters); the type scales with the viewport
// between 12 and 14 px. The three number columns never wrap; the item column
// takes the rest and wraps - a long name, Hindi included, stays inside it.

const rule = "my-2 border-t border-dashed border-muted";

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
    <article
      aria-label="Receipt"
      className="mx-auto w-full max-w-[384px] border border-line bg-surface px-4 py-5 font-mono text-[clamp(12px,3.75vw,14px)] leading-snug text-ink"
    >
      {/* D57: the legacy parchi's layout - name large and bold, then small muted lines. */}
      <header className="text-center">
        {r.logoUrl && !logoFailed && <img src={r.logoUrl} alt="" onError={() => setLogoFailed(true)} className="mx-auto mb-2 max-h-16" />}
        <p className="text-[1.4em] font-bold uppercase leading-tight [overflow-wrap:anywhere]">{r.shopName}</p>
        {r.shopPhone && <p className="mt-1 text-[0.85em] text-ink-soft tabular-nums">{r.shopPhone}</p>}
        <p className="mt-1 text-[0.85em] text-ink-soft tabular-nums">{r.dateTime}</p>
      </header>
      <hr className={rule} />
      {/* Q1 A: the number breaks only after a hyphen and is one selectable string. */}
      <p data-testid="receipt-bill-no">
        {r.billNoLabel}{" "}
        <span data-testid="receipt-number" className="select-all font-semibold">
          <ReceiptNumberText value={r.receiptNumber} />
        </span>
      </p>
      {r.customer && (
        <p data-testid="receipt-customer" className="[overflow-wrap:anywhere]">
          {r.customerLabel} {r.customer}
        </p>
      )}
      <hr className={rule} />
      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr className="border-b-[1.5px] border-ink-soft text-left font-bold">
            <th scope="col" className="pb-1 pr-2">{r.headers.item}</th>
            <th scope="col" className="pb-1 pr-2">{r.headers.qty}</th>
            <th scope="col" className="pb-1 pr-2 text-right">{r.headers.rate}</th>
            <th scope="col" className="pb-1 text-right">{r.headers.amount}</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i} className="border-b border-line align-top">
              <td className="w-full py-1 pr-2 [overflow-wrap:anywhere]">{row.name}</td>
              <td className="whitespace-nowrap py-1 pr-2">{row.qty}</td>
              <td className="whitespace-nowrap py-1 pr-2 text-right">{row.rate}</td>
              <td className="whitespace-nowrap py-1 text-right font-bold">{row.amount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-[1.15em] font-bold">
          <tr className="border-y border-dashed border-muted">
            <th scope="row" colSpan={3} className="py-2 text-left">
              {r.totalLabel}
            </th>
            <td className="whitespace-nowrap py-2 text-right">{r.total}</td>
          </tr>
        </tfoot>
      </table>
      <footer className="mt-3 text-center text-[0.85em] text-ink-soft">
        <p>{r.thanks}</p>
      </footer>
    </article>
  );
}
