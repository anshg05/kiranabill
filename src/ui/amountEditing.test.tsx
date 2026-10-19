// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem, manualItem } from "@/domain/billEdit";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";
import { useBillLines, wasEdited } from "./useBillLines";

// KB-337 (D85): the amount can be typed on EVERY line - a voice line, an Add item line, a custom line - and the rate can
// be cleared or typed on any line, with or without a unit or a qty. Real parser output (D39).

afterEach(cleanup);
const catalog = SEED_PARSER_CATALOG.entries;
const chini = SEED_PARSER_CATALOG.entries.find((e) => e.displayName === "Chini")!;

function voice(transcript: string): { lines: BillLine[]; flags: ReturnType<typeof evaluateReviewFlags> } {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG);
  if (!items) throw new Error(`"${transcript}" did not parse`);
  return {
    lines: items.map((item) => ({ item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const })),
    flags: evaluateReviewFlags(transcript, items, catalog),
  };
}

function Harness({ transcripts = [], hand = [] }: { transcripts?: string[]; hand?: ("chini" | "custom")[] }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const t of transcripts) {
      const v = voice(t);
      bill.add(v.lines, v.flags);
    }
    for (const h of hand) {
      if (h === "chini") bill.addByHand(manualItem(chini), "Chini");
      else bill.addByHand(customItem("Kuch naya"), "Kuch naya");
    }
    // once, on mount
  }, []);
  return <BillView lines={bill.rows} onSignOut={() => {}} onEdit={bill.edit} onRemove={bill.remove} flags={bill.flags} pending={bill.pending} onAcknowledge={bill.acknowledge} />;
}

const table = () => within(screen.getByRole("table"));
const total = () => screen.getByTestId("bill-total").textContent;
/** What is on the screen as a check - the screen-reader announcer keeps its last sentence until the next one, so it is left out. */
const visible = (re: RegExp) => screen.queryAllByText(re).filter((e) => !e.closest('[data-testid="flag-announcer"]'));
const chip = (label: string) => table().getByRole("button", { name: label }).textContent;

function type(label: string, value: string, key = "Enter") {
  act(() => table().getByRole("button", { name: label }).click());
  const input = table().getByRole("textbox", { name: label }) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key });
  return input;
}

describe("typing the amount on every kind of line", () => {
  it("a voice line (2 kilo chini, ₹90): ₹100 typed - the amount is ₹100, the rate shows '—', qty and unit stay", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    expect(table().getByRole("button", { name: "Chini amount" })).toBeTruthy(); // editable now, rate line or not
    type("Chini amount", "100");
    expect(total()).toBe("₹100");
    expect(chip("Chini rate")).toBe("—");
    expect(chip("Chini quantity")).toBe("2");
    expect((table().getByRole("combobox", { name: "Chini unit" }) as HTMLSelectElement).value).toBe("kg");
  });

  it("an Add item line (qty 1 at the shop's price): ₹40 typed", () => {
    render(<Harness hand={["chini"]} />);
    type("Chini amount", "40");
    expect(total()).toBe("₹40");
    expect(chip("Chini rate")).toBe("—");
    expect(chip("Chini quantity")).toBe("1");
  });

  it("a custom line (no qty, no unit, no price): ₹25 typed fills it - 'Price needed' goes", () => {
    render(<Harness hand={["custom"]} />);
    expect(screen.getAllByText("Price needed").length).toBeGreaterThan(0);
    type("Kuch naya amount", "25");
    expect(total()).toBe("₹25");
    expect(screen.queryAllByText("Price needed")).toEqual([]);
  });

  it("paise are exact (12.50), more than 2 decimals and 0 are refused with the message, nothing changes", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini amount", "12.50");
    expect(total()).toBe("₹12.50");
    const bad = type("Chini amount", "12.505");
    expect(within(bad.closest("span")!).getByText("At most 2 digits after the point")).toBeTruthy();
    fireEvent.keyDown(bad, { key: "Escape" });
    const zero = type("Chini amount", "0");
    expect(within(zero.closest("span")!).getByText("Must be more than ₹0")).toBeTruthy();
    fireEvent.keyDown(zero, { key: "Escape" });
    expect(total()).toBe("₹12.50");
  });

  it("owner answer 1: the qty changed after a typed amount - the amount stays ₹100", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini amount", "100");
    type("Chini quantity", "3");
    expect(total()).toBe("₹100");
  });

  it("an empty amount on a line with no rate leaves it unpriced again - 'Price needed' and no total", () => {
    render(<Harness transcripts={["5 kg chawal 30 ka"]} />);
    type("Chawal amount", "");
    expect(screen.getAllByText("Price needed").length).toBeGreaterThan(0);
  });
});

describe("the rate box", () => {
  it("owner answer 2: cleared - the rate shows '—' and the amount STAYS (₹90)", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini rate", "");
    expect(chip("Chini rate")).toBe("—");
    expect(total()).toBe("₹90");
  });

  it("owner answer 3: a typed rate recalculates - after a typed ₹100, ₹40/kg on 2 kg = ₹80", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini amount", "100");
    type("Chini rate", "40");
    expect(total()).toBe("₹80");
  });

  it("KB-337 decision 3: a rate on a custom line with no unit and no qty is accepted - 'Quantity needed'; a qty then gives qty x rate as plain numbers", () => {
    render(<Harness hand={["custom"]} />);
    type("Kuch naya rate", "10");
    expect(screen.getAllByText("Quantity needed").length).toBeGreaterThan(0);
    type("Kuch naya quantity", "3");
    expect(total()).toBe("₹30");
    expect(screen.queryAllByText("Quantity needed")).toEqual([]);
  });
});

describe("a quantity with no unit (KB-337 decision 1)", () => {
  it("a custom line with a typed amount takes qty 1 and no unit - no refusal, no flag, the amount stays", () => {
    render(<Harness hand={["custom"]} />);
    type("Kuch naya amount", "25");
    type("Kuch naya quantity", "1");
    expect(chip("Kuch naya quantity")).toBe("1");
    expect((table().getByRole("combobox", { name: "Kuch naya unit" }) as HTMLSelectElement).value).toBe("");
    expect(total()).toBe("₹25");
    expect(visible(/[1-9]\d* checks? pending/)).toEqual([]);
  });
});

describe("flags and 'Theek hai' (KB-337 decision 2)", () => {
  it("a flagged line (₹5/kg on chini: two HIGH checks), acknowledged, then an amount typed: the checks are gone and stay gone", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini rate", "5");
    expect(screen.getAllByText(/[1-9]\d* checks? pending/).length).toBeGreaterThan(0);
    type("Chini amount", "90");
    expect(visible(/[1-9]\d* checks? pending/)).toEqual([]);
    expect(visible(/usually|expected around/)).toEqual([]);
  });

  it("a typed amount is not checked against the catalog - a typing slip (₹4,500 for 2 kg) raises nothing; the TOTAL shows it (the trade-off)", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    type("Chini amount", "4500");
    expect(visible(/[1-9]\d* checks? pending/)).toEqual([]);
    expect(total()).toBe("₹4,500");
  });
});

describe("was_edited (what KB-404 and learning read)", () => {
  it("false as spoken, true after a typed amount", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const v = voice("2 kilo chini");
    act(() => result.current.add(v.lines, v.flags));
    const id = result.current.rows[0]!.id;
    expect(wasEdited(result.current.rows[0]!)).toBe(false);
    act(() => void result.current.edit(id, "amount", "90"));
    expect(wasEdited(result.current.rows[0]!)).toBe(true);
    expect(result.current.rows[0]!.item).toMatchObject({ rate: null, rateUnit: null, total: 9000, priceType: "total" });
  });
});
