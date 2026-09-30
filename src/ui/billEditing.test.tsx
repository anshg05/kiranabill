// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";
import { UNDO_MS, useBillLines, wasEdited } from "./useBillLines";

// KB-303 - editing and removing bill lines. D39: every line is REAL
// parseUtterance() output, built into BillLines the way the screen builds them.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const catalog = SEED_PARSER_CATALOG.entries;

function voice(transcript: string): { lines: BillLine[]; flags: ReturnType<typeof evaluateReviewFlags> } {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG);
  if (!items) throw new Error(`"${transcript}" did not parse`);
  return {
    lines: items.map((item) => ({ item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const })),
    flags: evaluateReviewFlags(transcript, items, catalog),
  };
}

function Harness({ transcripts }: { transcripts: string[] }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const t of transcripts) {
      const v = voice(t);
      bill.add(v.lines, v.flags);
    }
    // once, on mount
  }, []);
  return <BillView lines={bill.rows} onSignOut={() => {}} onEdit={bill.edit} onRemove={bill.remove} removed={bill.removed} onUndo={bill.undo} />;
}

const table = () => within(screen.getByRole("table"));
const total = () => screen.getByTestId("bill-total").textContent;

/** Tap a value in the table, type, press a key. */
function type(label: string, value: string, key = "Enter") {
  act(() => table().getByRole("button", { name: label }).click());
  const input = table().getByRole("textbox", { name: label }) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key });
  return input;
}

describe("KB-303 - editing a line", () => {
  it("qty: tap, type, Enter - the amount and TOTAL follow (2 kilo chini -> 3 kg = ₹135)", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    expect(total()).toBe("₹90");
    type("Qty for Chini", "3");
    expect(total()).toBe("₹135");
    expect(table().getByRole("button", { name: "Qty for Chini" }).textContent).toBe("3");
  });

  it("the input opens the numeric keyboard: inputmode=decimal, enterkeyhint=done", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    act(() => table().getByRole("button", { name: "Qty for Chini" }).click());
    const input = table().getByRole("textbox", { name: "Qty for Chini" });
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.getAttribute("enterkeyhint")).toBe("done");
  });

  it("rate: '12.50' is exact paise - 2 kg at ₹12.50 = ₹25", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Rate for Chini", "12.50");
    expect(total()).toBe("₹25");
  });

  it("Devanagari digits: '३' kg of chini = ₹135", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Qty for Chini", "३");
    expect(total()).toBe("₹135");
  });

  it("bad input: the message shows, the field stays open, nothing changes; Escape cancels", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    const input = type("Qty for Chini", "2.1255");
    expect(table().getByRole("alert").textContent).toBe("At most 3 digits after the point");
    expect(input.isConnected).toBe(true);
    expect(total()).toBe("₹90");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(table().getByRole("button", { name: "Qty for Chini" }).textContent).toBe("2");
    expect(table().queryByRole("alert")).toBeNull();
  });

  it("above the limit: 'Too large — at most 99,999'", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Qty for Chini", "100000");
    expect(table().getByRole("alert").textContent).toBe("Too large — at most 99,999");
  });

  it("SG-09: 1 kilo ajwain shows its rate per kg (₹500), not ₹0.50/gm", () => {
    render(<Harness transcripts={["1 kilo ajwain"]} />);
    expect(table().getByRole("button", { name: "Rate for Ajwain" }).textContent).toBe("₹500");
  });

  it("D47 'sabun 180 rupay' (qty —): typing a qty takes the product's unit; the spoken ₹180 stays", () => {
    render(<Harness transcripts={["sabun 180 rupay"]} />);
    type("Qty for Sabun", "2");
    expect(table().getByRole("button", { name: "Qty for Sabun" }).textContent).toBe("2");
    expect((table().getByRole("combobox", { name: "Unit for Sabun" }) as HTMLSelectElement).value).toBe("piece");
    expect(total()).toBe("₹180");
  });

  it("amount: not editable on a rate line; editable on a spoken-total line ('5 kg chawal 30 ka' -> ₹250)", () => {
    render(<Harness transcripts={["2 kilo chini", "5 kg chawal 30 ka"]} />);
    expect(table().queryByRole("button", { name: "Amount for Chini" })).toBeNull();
    type("Amount for Chawal", "250");
    expect(total()).toBe("₹340");
  });

  it("unit: only compatible units offered; kg -> gm recomputes (2 gm chini = ₹0.09)", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    const select = table().getByRole("combobox", { name: "Unit for Chini" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["kg", "gm"]);
    fireEvent.change(select, { target: { value: "gm" } });
    expect(total()).toBe("₹0.09");
  });
});

describe("KB-303 - removing a line, with one-level undo", () => {
  it("✕ removes the line at once; Undo puts it back in its place", () => {
    render(<Harness transcripts={["2 kilo chini", "1 kilo besan"]} />);
    expect(total()).toBe("₹180");
    act(() => table().getByRole("button", { name: "Remove Chini" }).click());
    expect(table().queryByText("Chini")).toBeNull();
    expect(total()).toBe("₹90");
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Chini removed");
    act(() => within(status).getByRole("button", { name: "Undo" }).click());
    expect(total()).toBe("₹180");
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]!.textContent).toContain("Chini"); // back first
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Undo is offered for 6 s, then gone", () => {
    vi.useFakeTimers();
    render(<Harness transcripts={["2 kilo chini"]} />);
    act(() => table().getByRole("button", { name: "Remove Chini" }).click());
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(screen.queryByRole("status")).toBeNull();
    expect(UNDO_MS).toBe(6_000);
  });

  it("a read-only bill (no handlers) shows no ✕ and no editable values - today's markup", () => {
    const v = voice("2 kilo chini");
    render(<BillView lines={v.lines} onSignOut={() => {}} />);
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Qty for/ })).toBeNull();
  });
});

describe("KB-303 - the bill's flags and was_edited follow every change", () => {
  it("removing one of two duplicates clears duplicate_line", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const v = voice("दो किलो चीनी, दो किलो चीनी");
    act(() => result.current.add(v.lines, v.flags));
    expect(result.current.flags.map((f) => f.code)).toEqual(["duplicate_line"]);
    act(() => result.current.remove(result.current.rows[1]!.id));
    expect(result.current.flags).toEqual([]);
  });

  it("the same line in a second utterance -> MEDIUM already_on_bill", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    for (const t of ["2 kilo chini", "2 kilo chini"]) {
      const v = voice(t);
      act(() => result.current.add(v.lines, v.flags));
    }
    expect(result.current.flags.map((f) => `${f.severity} ${f.code}`)).toEqual(["MEDIUM already_on_bill"]);
  });

  it("was_edited: false as spoken, true after an edit, false again once put back", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const v = voice("2 kilo chini");
    act(() => result.current.add(v.lines, v.flags));
    const id = result.current.rows[0]!.id;
    expect(wasEdited(result.current.rows[0]!)).toBe(false);
    act(() => void result.current.edit(id, "qty", "3"));
    expect(wasEdited(result.current.rows[0]!)).toBe(true);
    act(() => void result.current.edit(id, "qty", "2"));
    expect(wasEdited(result.current.rows[0]!)).toBe(false);
  });

  it("a rejected edit changes nothing and returns the message", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const v = voice("2 kilo chini");
    act(() => result.current.add(v.lines, v.flags));
    let message: string | null = null;
    act(() => {
      message = result.current.edit(result.current.rows[0]!.id, "rate", "0");
    });
    expect(message).toBe("Must be more than ₹0");
    expect(result.current.rows[0]!.item.total).toBe(9000);
  });
});
