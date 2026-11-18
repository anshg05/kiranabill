// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type MutableRefObject } from "react";
import { catalog } from "@/domain/catalog";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { BillView } from "./BillingScreen";
import { useBillLines, type BillLines } from "./useBillLines";
import { billQueries } from "./testLineSheet";

// KB-305 (owner, 2 Oct 2026) - add an item by hand (05 S3a): a NON-modal
// panel over the item list (TOTAL, mic and Bill Banao stay usable); type-ahead
// over the SHOP's catalog; a catalog pick is qty 1 at the shop's price with
// the qty editor open; a custom item is qty "—" + unit "—" and only a bill
// line (never a shop_product - L1 at KB-307+); Android back closes the panel.

afterEach(async () => {
  cleanup();
  // A panel closed by unmount takes its history entry off on the next tick - let it land.
  await new Promise((r) => setTimeout(r, 30));
});

/** A voice utterance, from REAL Layer 1 output (D39). */
function spoken(transcript: string, pc: ParserCatalog = SEED_PARSER_CATALOG) {
  const items = parseUtterance(transcript, pc)!;
  return {
    transcript,
    lines: items.map((item) => ({ item, displayName: pc.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const })),
    flags: [...evaluateReviewFlags(transcript, items, pc.entries)],
  };
}

interface Props {
  shop?: ParserCatalog;
  pre?: ReturnType<typeof spoken>[];
  api?: MutableRefObject<BillLines | null>;
  addSignal?: number;
}

function Harness({ shop = SEED_PARSER_CATALOG, pre = [], api, addSignal }: Props) {
  const bill = useBillLines(shop.entries);
  useEffect(() => {
    for (const u of pre) bill.add(u.lines, u.flags, u.transcript);
    // once, on mount
  }, []);
  if (api) api.current = bill;
  return (
    <BillView
      lines={bill.rows}
      onEdit={bill.edit}
      onRemove={bill.remove}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      catalog={shop}
      onAddByHand={bill.addByHand}
      focusLineId={bill.focusLineId}
      addSignal={addSignal}
    />
  );
}

const panel = () => screen.queryByRole("region", { name: "Add item" });
const search = () => within(panel()!).getByRole("searchbox", { name: "Search products" }) as HTMLInputElement;
const results = () => within(within(panel()!).getByRole("list", { name: "Products" })).queryAllByRole("button").map((b) => b.textContent);
/** KB-413: a hand-added line opens its edit sheet with the quantity ready; billQueries looks in the sheet for editors, else everywhere. */
const cards = billQueries;

function open() {
  act(() => screen.getByRole("button", { name: "Add item" }).click());
}
function type(text: string) {
  fireEvent.change(search(), { target: { value: text } });
}
function commit(label: string, value: string) {
  const input = cards().getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("KB-414 step 1 - Home's Type items", () => {
  it("opens 12 with Add item open (empty search), once per tap; closing it does not reopen it", () => {
    const { rerender } = render(<Harness />);
    expect(panel()).toBeNull();
    rerender(<Harness addSignal={1} />);
    expect(panel()).toBeTruthy();
    expect(search().value).toBe("");
    fireEvent.keyDown(search(), { key: "Escape" });
    rerender(<Harness addSignal={1} />);
    expect(panel()).toBeNull();
    rerender(<Harness addSignal={2} />);
    expect(panel()).toBeTruthy();
  });
});

describe("KB-305 - the panel", () => {
  it("'Add item' opens a non-modal panel, search focused; TOTAL and Bill Banao stay in place", () => {
    render(<Harness />);
    open();
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(search());
    expect(document.querySelector("[aria-modal]")).toBeNull();
    // (the old mic that stood here was deleted with the old voice path, 18 Nov 2026; V3's recorder sits in the order bar)
    expect(screen.getByTestId("bill-total")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bill Banao" })).toBeTruthy();
  });

  it("shows the bill so far on one line", () => {
    render(<Harness pre={[spoken("2 kilo chini")]} />);
    open();
    expect(within(panel()!).getByText("Bill so far · ₹90 · 1 item")).toBeTruthy();
  });

  it("✕ and Escape close it; nothing is added", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    open();
    act(() => within(panel()!).getByRole("button", { name: "Close add item" }).click());
    expect(panel()).toBeNull();
    open();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(panel()).toBeNull();
    expect(api.current!.rows).toHaveLength(0);
  });
});

describe("KB-305 - a catalog pick", () => {
  it("'चीनी' -> Chini ₹45/kg first; tap adds 1 kg at ₹45 (source manual), closes the panel, opens qty with '1' selected", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    open();
    type("चीनी");
    expect(results()[0]).toBe("Chini₹45/kg");
    act(() => within(panel()!).getAllByRole("button", { name: /^Chini/ })[0]!.click());
    expect(panel()).toBeNull();
    expect(api.current!.rows.map((r) => [r.displayName, r.source, r.item.qty, r.item.unit, r.item.total])).toEqual([["Chini", "manual", 1, "kg", 4500]]);
    const qty = cards().getByRole("textbox", { name: "Chini quantity" }) as HTMLInputElement;
    expect(document.activeElement).toBe(qty);
    expect([qty.value, qty.selectionStart, qty.selectionEnd]).toEqual(["1", 0, 1]);
    commit("Chini quantity", "2");
    expect(screen.getByTestId("bill-total").textContent).toBe("₹90");
  });

  it("the typed fragment is never the spoken name: 'chi' -> Chini is named 'Chini'", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    open();
    type("chi");
    act(() => within(panel()!).getAllByRole("button", { name: /^Chini/ })[0]!.click());
    expect(api.current!.rows[0]!.item.spokenName).toBe("Chini");
  });

  it("uses the SHOP's catalog and price, not the seed's (Chini at ₹48 in this shop)", () => {
    const shop = prepareParserCatalog(SEED_PARSER_CATALOG.entries.map((e) => (e.id === "27" ? { ...e, suggestedPricePaise: 4800 } : e)));
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness shop={shop} api={api} />);
    open();
    type("chini");
    expect(results()[0]).toBe("Chini₹48/kg");
    act(() => within(panel()!).getAllByRole("button", { name: /^Chini/ })[0]!.click());
    expect(api.current!.rows[0]!.item.total).toBe(4800);
  });

  it("an inactive product (Arhar Daal) never appears", () => {
    render(<Harness shop={prepareParserCatalog(catalog)} />); // a catalog still holding the inactive row
    open();
    type("arhar");
    expect(results().some((r) => r?.includes("Arhar Daal"))).toBe(false);
  });

  it("the same product already spoken -> MEDIUM already_on_bill on the hand-added line", () => {
    render(<Harness pre={[spoken("1 kilo besan")]} />);
    open();
    type("besan");
    act(() => within(panel()!).getAllByRole("button", { name: /^Besan/ })[0]!.click());
    commit("Besan quantity", "1");
    act(() => screen.getAllByRole("button", { name: "REVIEW — Besan" })[0]!.click());
    expect(screen.getAllByText(/already on the bill/).length).toBeGreaterThan(0);
  });
});

describe("KB-305 - a custom item (owner: qty '—' AND unit '—')", () => {
  it("adds the typed name with qty '—' and unit '—', qty editor open beside the unit picker; MEDIUM until filled", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    open();
    type("kuch naya");
    act(() => within(panel()!).getByRole("button", { name: "+ Add “kuch naya” as a new product" }).click());
    expect(api.current!.rows.map((r) => [r.item.spokenName, r.source, r.item.qty, r.item.unit, r.item.rate])).toEqual([["kuch naya", "manual", null, "", null]]);
    const qty = cards().getByRole("textbox", { name: "kuch naya quantity" }) as HTMLInputElement;
    expect(document.activeElement).toBe(qty);
    expect(qty.value).toBe("");
    expect((cards().getByRole("combobox", { name: "kuch naya unit" }) as HTMLSelectElement).value).toBe("");
    // KB-307 decision 2: "Price needed" (blocking, no Theek hai) replaces the MEDIUM incomplete_item REVIEW.
    expect(cards().getByText("Price needed")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "REVIEW — kuch naya" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Note — kuch naya" }).length).toBeGreaterThan(0);

    commit("kuch naya quantity", "2"); // KB-337 (D85): a qty with no unit is taken on a line with no rate - it still needs a price
    expect(cards().queryByRole("alert")).toBeNull();
    expect(cards().getByRole("button", { name: "kuch naya quantity" }).textContent).toBe("2");
    expect(cards().getByText("Price needed")).toBeTruthy();
    fireEvent.change(cards().getByRole("combobox", { name: "kuch naya unit" }), { target: { value: "kg" } });
    act(() => cards().getByRole("button", { name: "kuch naya quantity" }).click());
    commit("kuch naya quantity", "2");
    act(() => cards().getByRole("button", { name: "kuch naya rate" }).click());
    commit("kuch naya rate", "60");
    expect(api.current!.rows[0]!.item).toMatchObject({ qty: 2, unit: "kg", rate: 6000, total: 12000 });
    expect(screen.queryAllByText("Price needed")).toHaveLength(0); // filled: the check clears
    expect(screen.getAllByRole("button", { name: "Note — kuch naya" }).length).toBeGreaterThan(0); // still not in the catalog
  });

  // Owner's check (2 Oct 2026): "Enter a quantity like 2 or 0.5" showed while the field was empty.
  it("no message on open; leaving the untouched editor (e.g. for the unit picker) closes it quietly", () => {
    render(<Harness />);
    open();
    type("kuch naya");
    act(() => within(panel()!).getByRole("button", { name: "+ Add “kuch naya” as a new product" }).click());
    expect(cards().queryByRole("alert")).toBeNull();
    fireEvent.blur(cards().getByRole("textbox", { name: "kuch naya quantity" }));
    expect(cards().queryByRole("alert")).toBeNull();
    expect(cards().queryByRole("textbox", { name: "kuch naya quantity" })).toBeNull();
    expect(cards().getByRole("button", { name: "kuch naya quantity" }).textContent).toBe("—");
  });

  it("an explicit Enter on the empty field still explains itself", () => {
    render(<Harness />);
    open();
    type("kuch naya");
    act(() => within(panel()!).getByRole("button", { name: "+ Add “kuch naya” as a new product" }).click());
    commit("kuch naya quantity", "");
    expect(cards().getByRole("alert").textContent).toBe("Enter a quantity like 2 or 0.5");
  });

  it("it is only a bill line - the catalog is untouched", () => {
    const shop = prepareParserCatalog([...SEED_PARSER_CATALOG.entries]);
    render(<Harness shop={shop} />);
    open();
    type("kuch naya");
    act(() => within(panel()!).getByRole("button", { name: "+ Add “kuch naya” as a new product" }).click());
    expect(shop.entries).toHaveLength(SEED_PARSER_CATALOG.entries.length);
    open();
    type("kuch naya");
    expect(results().filter((r) => r?.startsWith("kuch naya"))).toEqual([]);
  });
});

describe("KB-305 - Android back closes the panel, never leaves the app (the bill isn't saved until KB-313)", () => {
  it("open pushes a history entry; back closes the panel and keeps the bill", async () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} pre={[spoken("2 kilo chini")]} />);
    const before = window.history.state as unknown;
    open();
    expect(typeof window.history.state?.kbAddItem).toBe("string");
    act(() => window.history.back());
    await waitFor(() => expect(panel()).toBeNull());
    expect(window.history.state).toEqual(before);
    expect(api.current!.rows).toHaveLength(1);
  });

  it("a normal close removes its history entry (the next back isn't swallowed)", async () => {
    render(<Harness />);
    open();
    act(() => within(panel()!).getByRole("button", { name: "Close add item" }).click());
    await waitFor(() => expect(window.history.state?.kbAddItem).toBeFalsy());
  });

  it("closed and re-opened at once (before the first back() ran), then closed: no panel entry is left behind", async () => {
    render(<Harness />);
    open();
    act(() => within(panel()!).getByRole("button", { name: "Close add item" }).click());
    open();
    fireEvent.keyDown(search(), { key: "Escape" });
    await waitFor(() => expect(window.history.state?.kbAddItem).toBeFalsy());
    await new Promise((r) => setTimeout(r, 30));
    expect(window.history.state?.kbAddItem).toBeFalsy();
  });

  it("closing by a pick removes it too", async () => {
    render(<Harness />);
    open();
    type("chini");
    act(() => within(panel()!).getAllByRole("button", { name: /^Chini/ })[0]!.click());
    await waitFor(() => expect(window.history.state?.kbAddItem).toBeFalsy());
  });
});

// (KB-305 / KB-331's 'Add by hand' on the OLD mic's failures were deleted with the old voice path, 18 Nov 2026; V3's failures offer
// Type instead / Add by hand on their own cards - VoiceOrderPanel's tests)
