// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";

// KB-323 (D81, owner 17 Oct 2026): a line the parser read through a learned alias carries a visible, NON-BLOCKING note
// with one tap, "Not this" - until the alias is confirmed to confidence 1. Both markups (table and cards) carry it.

afterEach(cleanup);

function lines(): (BillLine & { id: string })[] {
  const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
  return items.map((item, i) => ({ id: `l${i}`, item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));
}
const ls = lines();
const catalogId = ls[0]!.item.catalogId!;
const spoken = ls[0]!.item.spokenName;
const learned = (confidence: number, id = catalogId) => ({ [spoken.toLowerCase()]: { alias: spoken, catalogId: id, confidence } });
const base = { lines: ls, onSignOut: () => {}, onEdit: () => null, onRemove: () => {} };

describe("the first-use note", () => {
  it("shows the learned phrase, the product, and a Not this button - in both markups", () => {
    render(<BillView {...base} learned={learned(0.9)} onNotThis={() => {}} />);
    const notes = screen.getAllByTestId("learned-note");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]!.textContent).toContain(`Learned: “${spoken}”`);
    expect(screen.getAllByRole("button", { name: /^Not this/ }).length).toBe(notes.length);
  });

  it("no note once confidence is 1, for another product's alias, with nothing learned, or on a saved (read-only) bill", () => {
    const { rerender } = render(<BillView {...base} learned={learned(1)} onNotThis={() => {}} />);
    expect(screen.queryByTestId("learned-note")).toBeNull();
    rerender(<BillView {...base} learned={learned(0.9, "some-other-product")} onNotThis={() => {}} />);
    expect(screen.queryByTestId("learned-note")).toBeNull();
    rerender(<BillView {...base} learned={{}} onNotThis={() => {}} />);
    expect(screen.queryByTestId("learned-note")).toBeNull();
    rerender(<BillView {...base} learned={learned(0.9)} onNotThis={() => {}} saved={{ localId: "b", receiptNumber: "KB-000001", receipt: null } as never} />);
    expect(screen.queryByTestId("learned-note")).toBeNull();
  });

  it("Not this reports the alias and the product once, and the note turns into 'Forgotten' - the line is still on the bill", () => {
    const onNotThis = vi.fn();
    render(<BillView {...base} learned={learned(0.9)} onNotThis={onNotThis} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Not this/ })[0]!);
    expect(onNotThis).toHaveBeenCalledTimes(1);
    expect(onNotThis).toHaveBeenCalledWith(spoken, catalogId);
    expect(screen.getAllByText(/^Forgotten\./).length).toBeGreaterThan(0);
    expect(screen.getByTestId("bill-total").textContent).not.toBe("₹0");
  });

  it("it never blocks Bill Banao (rule 6: no question mid-bill)", () => {
    render(<BillView {...base} learned={learned(0.9)} onNotThis={() => {}} onFinalise={() => {}} />);
    const bill = screen.getByRole("button", { name: /Bill Banao/ }) as HTMLButtonElement;
    expect(bill.disabled).toBe(false);
  });
});
