import { Fragment, useState } from "react";
import { numberChunks, type Receipt as ReceiptModel } from "@/domain/receipt";

// KB-308: the kirana parchi (05 §6). Every value is a React text node - never
// raw HTML (hard rule 9; lint bans it). Sized for a 58 mm thermal roll: at most
// 384 px wide, and 100% of what's left on a narrower phone (288 px at 320,
// 343 px at 375 with the 16 px gutters); the type scales with the viewport
// between 12 and 14 px. The three number columns never wrap; the item column
// takes the rest and wraps - a long name, Hindi included, stays inside it.

const rule = "my-2 border-t border-dashed border-ink-soft";

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
      className="mx-auto w-full max-w-[384px] bg-surface px-4 py-4 font-mono text-[clamp(12px,3.75vw,14px)] leading-snug text-ink"
    >
      <header className="text-center">
        {r.logoUrl && !logoFailed && <img src={r.logoUrl} alt="" onError={() => setLogoFailed(true)} className="mx-auto mb-2 max-h-16" />}
        <p className="font-semibold uppercase [overflow-wrap:anywhere]">{r.shopName}</p>
        {r.shopPhone && <p className="tabular-nums">{r.shopPhone}</p>}
      </header>
      <hr className={rule} />
      <p>{r.billLabel}</p>
      {/* Q1 A: on its own line; breaks only after a hyphen; one selectable string. */}
      <p data-testid="receipt-number" className="select-all font-semibold">
        <ReceiptNumberText value={r.receiptNumber} />
      </p>
      <p className="tabular-nums">{r.dateTime}</p>
      {r.customer && <p className="[overflow-wrap:anywhere]">{r.customer}</p>}
      <hr className={rule} />
      <table className="w-full border-collapse tabular-nums">
        <thead className="sr-only">
          <tr>
            <th scope="col">{r.headers.item}</th>
            <th scope="col">{r.headers.qty}</th>
            <th scope="col">{r.headers.rate}</th>
            <th scope="col">{r.headers.amount}</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i} className="align-top">
              <td className="w-full py-0.5 pr-2 [overflow-wrap:anywhere]">{row.name}</td>
              <td className="whitespace-nowrap py-0.5 pr-2 text-right">{row.qty}</td>
              <td className="whitespace-nowrap py-0.5 pr-2 text-right">{row.rate}</td>
              <td className="whitespace-nowrap py-0.5 text-right">{row.amount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-dashed border-ink-soft font-semibold">
          <tr>
            <th scope="row" colSpan={3} className="pt-2 text-left">
              {r.totalLabel}
            </th>
            <td className="whitespace-nowrap pt-2 text-right">{r.total}</td>
          </tr>
        </tfoot>
      </table>
      <hr className={rule} />
      <footer className="text-center">
        {r.thanks.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </footer>
    </article>
  );
}
