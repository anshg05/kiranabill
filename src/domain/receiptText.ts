import { UNKNOWN_CELL, type Receipt } from "./receipt.js";

// KB-309 (owner, 4 Oct 2026, Q2/Q5): the receipt as a WhatsApp message - the
// same buildReceipt pieces and bill_language labels, plain text (WhatsApp's
// *bold* on the shop name and total). Names are sent as typed (a "*" in one
// may bold text - accepted). The customer's mobile is not an input.

export function receiptText(r: Receipt): string {
  const rows = r.rows.map((row) => {
    const qty = row.qty === UNKNOWN_CELL ? null : row.qty;
    const rate = row.rate === UNKNOWN_CELL ? null : row.rate;
    if (qty === null && rate === null) return `${row.name} — ${row.amount}`;
    return `${row.name} — ${[qty, rate].filter((x) => x !== null).join(" × ")} = ${row.amount}`;
  });
  return [
    `*${r.shopName.toUpperCase()}*`,
    ...(r.shopPhone ? [r.shopPhone] : []),
    `${r.billNoLabel} ${r.receiptNumber} · ${r.dateTime}`,
    ...(r.customer ? [`${r.customerLabel} ${r.customer}`] : []),
    ...rows,
    `*${r.totalLabel} ${r.total}*`,
    r.thanks,
  ].join("\n");
}

/** wa.me with the bill's stored mobile (D52: 10 digits, 6-9 first) as +91; otherwise no number - WhatsApp asks for the chat. */
export function waLink(text: string, mobile: string | null): string {
  const to = mobile && /^[6-9]\d{9}$/.test(mobile) ? `91${mobile}` : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
