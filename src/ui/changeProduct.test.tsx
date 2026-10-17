// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { BillLine } from "@/data/voiceBilling";
import { AddItemSheet } from "./AddItemSheet";
import { BillView } from "./BillingScreen";
import { useBillLines, wasEdited } from "./useBillLines";

// KB-336 (D83): tap a line's name -> search -> pick. The line keeps its quantity, its flags are recomputed, and a saved bill
// has no such tap target. Real parser output (D39).

afterEach(cleanup);
const catalog = SEED_PARSER_CATALOG.entries;
const entryNamed = (name: string) => catalog.find((e) => e.displayName === name)!;
const BESAN = entryNamed("Besan");

function voice(t: string): { lines: BillLine[]; flags: ReturnType<typeof evaluateReviewFlags> } {
  const items = parseUtterance(t, SEED_PARSER_CATALOG)!;
  return { lines: items.map((item) => ({ item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const })), flags: evaluateReviewFlags(t, items, catalog) };
}

function Harness({ transcripts, saved = null }: { transcripts: string[]; saved?: { receiptNumber: string } | null }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const t of transcripts) {
      const v = voice(t);
      bill.add(v.lines, v.flags, t);
    }
    // once, on mount
  }, []);
  return (
    <BillView
      lines={bill.rows}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      onSignOut={() => {}}
      onEdit={bill.edit}
      onRemove={bill.remove}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={bill.addByHand}
      onChangeProduct={bill.changeProduct}
      saved={saved as never}
    />
  );
}
const table = () => within(screen.getByRole("table"));

describe("the hook", () => {
  it("changeProduct replaces the line's product: name and price follow the catalog, quantity stays, it counts as an edit", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    act(() => result.current.add(voice("2 kilo chini").lines, []));
    const id = result.current.rows[0]!.id;
    act(() => void result.current.changeProduct(id, BESAN));
    const row = result.current.rows[0]!;
    expect(row.displayName).toBe("Besan");
    expect(row.item).toMatchObject({ catalogId: BESAN.id, qty: 2, unit: "kg", rate: BESAN.suggestedPricePaise, spokenName: "chini" });
    expect(wasEdited(row)).toBe(true);
    expect(row.original.catalogId).not.toBe(BESAN.id); // what was first read is kept
  });

  it("a product whose unit does not fit clears the quantity - the line is then flagged, never guessed", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    act(() => result.current.add(voice("2 kilo chini").lines, []));
    const id = result.current.rows[0]!.id;
    act(() => void result.current.changeProduct(id, entryNamed("Maggi"))); // a per-packet product on a kg line
    expect(result.current.rows[0]!.item.qty).toBeNull();
    expect(result.current.rows[0]!.displayName).toBe("Maggi");
  });

  it("the line's flags are recomputed for the new line, and its 'Theek hai' lapses (KB-304: an acknowledgement lapses on any edit)", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const high = { id: "dup", code: "duplicate_line" as const, severity: "HIGH" as const, message: "said twice?", itemIndex: 0 };
    act(() => result.current.add(voice("2 kilo chini").lines, [high], "2 kilo chini"));
    const flagged = result.current.flags.find((f) => f.severity === "HIGH")!;
    act(() => result.current.acknowledge(flagged.key));
    expect(result.current.flags.find((f) => f.key === flagged.key)?.acknowledged).toBe(true);
    act(() => void result.current.changeProduct(flagged.lineId!, BESAN));
    expect(result.current.flags.some((f) => f.severity === "HIGH")).toBe(false); // recomputed from the new line: the old sentence is gone
  });

  it("choosing a product already on the bill raises the existing 'already on the bill' check", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    act(() => result.current.add(voice("2 kilo chini").lines, []));
    act(() => result.current.add(voice("2 kilo besan").lines, []));
    act(() => void result.current.changeProduct(result.current.rows[0]!.id, BESAN));
    expect(result.current.flags.map((f) => f.code)).toContain("already_on_bill");
  });
});

describe("the screen", () => {
  it("the item name is a button with a pencil; tapping it opens 'Change item' with the product search and NO 'new product' option", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    const button = table().getByRole("button", { name: "Change item Chini" });
    expect(button.querySelector("svg")).not.toBeNull(); // the pencil mark
    act(() => button.click());
    const panel = screen.getByRole("region", { name: "Change item" });
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Search products" }), { target: { value: "bes" } });
    expect(within(panel).queryByText(/as a new product/)).toBeNull();
  });

  it("picking a product updates the line and the total, closes the panel, and keeps the quantity", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    act(() => table().getByRole("button", { name: "Change item Chini" }).click());
    const panel = screen.getByRole("region", { name: "Change item" });
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Search products" }), { target: { value: "besan" } });
    act(() => within(panel).getByRole("button", { name: /^Besan/ }).click());
    expect(screen.queryByRole("region", { name: "Change item" })).toBeNull();
    expect(table().getByRole("button", { name: "Change item Besan" })).toBeTruthy();
    expect(table().getByRole("button", { name: "Besan quantity" }).textContent).toBe("2");
    expect(screen.getByTestId("bill-total").textContent).toBe(`₹${(BESAN.suggestedPricePaise * 2) / 100}`);
  });

  it("a saved bill has no change-item button (read-only, rule 2)", () => {
    render(<Harness transcripts={["2 kilo chini"]} saved={{ receiptNumber: "KB-000001" }} />);
    expect(screen.queryByRole("button", { name: /^Change item/ })).toBeNull();
  });
});

describe("the panel itself", () => {
  it("in change mode there is no 'new product' option even when a handler is given (catalog products only)", () => {
    render(<AddItemSheet catalog={SEED_PARSER_CATALOG} billTotal={0} billCount={1} change={{ name: "Chini" }} onPick={() => {}} onCustom={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: "zzzqqq" } });
    expect(screen.queryByText(/as a new product/)).toBeNull();
    expect(screen.getByRole("region", { name: "Change item" })).toBeTruthy();
  });
  it("in add mode it still offers one", () => {
    render(<AddItemSheet catalog={SEED_PARSER_CATALOG} billTotal={0} billCount={0} onPick={() => {}} onCustom={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: "zzzqqq" } });
    expect(screen.getByText(/as a new product/)).toBeTruthy();
  });
});
