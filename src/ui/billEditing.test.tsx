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
    type("Chini quantity", "3");
    expect(total()).toBe("₹135");
    expect(table().getByRole("button", { name: "Chini quantity" }).textContent).toBe("3");
  });

  it("the input opens the numeric keyboard: inputmode=decimal, enterkeyhint=done", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    act(() => table().getByRole("button", { name: "Chini quantity" }).click());
    const input = table().getByRole("textbox", { name: "Chini quantity" });
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.getAttribute("enterkeyhint")).toBe("done");
  });

  it("rate: '12.50' is exact paise - 2 kg at ₹12.50 = ₹25", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini rate", "12.50");
    expect(total()).toBe("₹25");
  });

  it("Devanagari digits: '३' kg of chini = ₹135", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini quantity", "३");
    expect(total()).toBe("₹135");
  });

  it("bad input: the message shows, the field stays open, nothing changes; Escape cancels", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    const input = type("Chini quantity", "2.1255");
    expect(table().getByRole("alert").textContent).toBe("At most 3 digits after the point");
    expect(input.isConnected).toBe(true);
    expect(total()).toBe("₹90");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(table().getByRole("button", { name: "Chini quantity" }).textContent).toBe("2");
    expect(table().queryByRole("alert")).toBeNull();
  });

  it("above the limit: 'Too large — at most 99,999'", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini quantity", "100000");
    expect(table().getByRole("alert").textContent).toBe("Too large — at most 99,999");
  });

  it("SG-09: 1 kilo ajwain shows its rate per kg (₹500), not ₹0.50/gm", () => {
    render(<Harness transcripts={["1 kilo ajwain"]} />);
    expect(table().getByRole("button", { name: "Ajwain rate" }).textContent).toBe("₹500");
  });

  it("D47 'sabun 180 rupay' (qty —): typing a qty takes the product's unit; the spoken ₹180 stays", () => {
    render(<Harness transcripts={["sabun 180 rupay"]} />);
    type("Sabun quantity", "2");
    expect(table().getByRole("button", { name: "Sabun quantity" }).textContent).toBe("2");
    expect((table().getByRole("combobox", { name: "Sabun unit" }) as HTMLSelectElement).value).toBe("piece");
    expect(total()).toBe("₹180");
  });

  it("amount: not editable on a rate line; editable on a spoken-total line ('5 kg chawal 30 ka' -> ₹250)", () => {
    render(<Harness transcripts={["2 kilo chini", "5 kg chawal 30 ka"]} />);
    expect(table().queryByRole("button", { name: "Chini amount" })).toBeNull();
    type("Chawal amount", "250");
    expect(total()).toBe("₹340");
  });

  it("unit: only compatible units offered; kg -> gm recomputes (2 gm chini = ₹0.09)", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    const select = table().getByRole("combobox", { name: "Chini unit" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["kg", "gm"]);
    fireEvent.change(select, { target: { value: "gm" } });
    expect(total()).toBe("₹0.09");
  });
});

// KB-303 polish (owner, 1 Oct 2026, after the browser check).
describe("KB-303 polish - discoverable, quick to correct, named", () => {
  it("an editable value looks editable: a bordered chip, 44 px", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    for (const name of ["Chini quantity", "Chini rate"]) {
      const cls = table().getByRole("button", { name }).className;
      expect(cls).toContain("border");
      expect(cls).toContain("min-h-11");
    }
  });

  it("opening an editor prefills the current value and selects it - typing replaces it", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    act(() => table().getByRole("button", { name: "Chini rate" }).click());
    const input = table().getByRole("textbox", { name: "Chini rate" }) as HTMLInputElement;
    expect(input.value).toBe("45");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
  });

  it("a spoken-total line has no rate: its rate editor opens empty (5 kg chawal 30 ka); its amount opens at 30", () => {
    render(<Harness transcripts={["5 kg chawal 30 ka"]} />);
    act(() => table().getByRole("button", { name: "Chawal rate" }).click());
    expect((table().getByRole("textbox", { name: "Chawal rate" }) as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(table().getByRole("textbox", { name: "Chawal rate" }), { key: "Escape" });
    act(() => table().getByRole("button", { name: "Chawal amount" }).click());
    expect((table().getByRole("textbox", { name: "Chawal amount" }) as HTMLInputElement).value).toBe("30");
  });

  it("every form field has an accessible name AND an id + name (the DevTools Issues panel's 'form field should have an id or name')", () => {
    render(<Harness transcripts={["2 kilo chini", "1 kilo besan"]} />);
    act(() => table().getByRole("button", { name: "Chini quantity" }).click());
    const fields = [...document.querySelectorAll("input, select")] as (HTMLInputElement | HTMLSelectElement)[];
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(f.getAttribute("aria-label"), f.outerHTML).toBeTruthy();
      expect(f.name, f.outerHTML).toBeTruthy();
      expect(f.id, f.outerHTML).toBeTruthy();
    }
    const ids = fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
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
