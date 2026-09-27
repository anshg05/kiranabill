// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { parseUtterance, type ParsedItem } from "@/domain/grammar";
import { formatRupees, sumPaise } from "@/domain/money";
import { BillView } from "./BillingScreen";
import { formatAmount, formatRate } from "./billFormat";
import voiceCases from "../../eval/voice-cases.json";
import numberBenchmark from "../../eval/number-benchmark.json";

// docs/07-DECISIONS.md D39: UI tests render REAL parseUtterance() output from
// the eval fixtures - never hand-built bills.

afterEach(cleanup);

const fixtures: { id: string; utterance: string }[] = [...voiceCases, ...numberBenchmark];

function parsed(id: string): ParsedItem[] {
  const fixture = fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  const items = parseUtterance(fixture.utterance);
  if (!items) throw new Error(`${id} "${fixture.utterance}" did not parse`);
  return items;
}

/** A fixture that parses to exactly one line. */
function one(id: string): ParsedItem {
  const items = parsed(id);
  const [line] = items;
  if (items.length !== 1 || !line) throw new Error(`${id} parsed to ${items.length} lines, expected 1`);
  return line;
}

/** Table body row n (row 0 is the header), as its cells' text. */
function dataRowCells(n: number): (string | null)[] {
  const row = within(screen.getByRole("table")).getAllByRole("row")[n];
  if (!row) throw new Error(`no table row ${n}`);
  return within(row).getAllByRole("cell").map((c) => c.textContent);
}

function nbExpected(id: string) {
  const fixture = numberBenchmark.find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  return fixture.expected;
}

/** Both markups are in the DOM (CSS picks one per width), so every check
 * runs against both: the table (md and up) and the card list (mobile). */
function views() {
  return [
    within(screen.getByRole("table")),
    within(screen.getByRole("list", { name: "Bill items" })),
  ];
}

function renderBill(lines: ParsedItem[]) {
  render(<BillView lines={lines} onSignOut={() => {}} />);
}

describe("BillView", () => {
  it("an empty bill totals ₹0 (genuinely zero, 13-DESIGN §6c)", () => {
    renderBill([]);
    expect(screen.getByTestId("bill-total").textContent).toBe("₹0");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("NB101 '500 gram chini': cross-unit rate shows its unit, exact total", () => {
    const expected = nbExpected("NB101");
    renderBill(parsed("NB101"));
    for (const v of views()) {
      expect(v.getByText("₹45/kg")).toBeTruthy();
      expect(v.getAllByText(formatRupees(expected.total as number)).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId("bill-total").textContent).toBe("₹22.50");
  });

  it("VC015 'Surf Excel ek packet': packet vs piece is no conversion - plain ₹60", () => {
    const line = one("VC015");
    expect([line.unit, line.rateUnit]).toEqual(["packet", "piece"]); // the case this rule exists for
    renderBill([line]);
    for (const v of views()) {
      expect(v.queryByText("₹60/piece")).toBeNull();
      expect(v.getAllByText("₹60").length).toBeGreaterThan(0);
    }
  });

  it("VC013 '5 kg chawal 30 ka': total-only line - rate '—', amount ₹30", () => {
    renderBill(parsed("VC013"));
    expect(dataRowCells(1)).toEqual(["chawal", "5", "kg", "—", "₹30"]);
    expect(screen.getByTestId("bill-total").textContent).toBe("₹30");
  });

  it("VC016 'sabun 180 rupay': unknown qty shows '—', never 0", () => {
    const line = one("VC016");
    expect(line.qty).toBeNull();
    renderBill([line]);
    const cells = dataRowCells(1);
    expect(cells[1]).toBe("—");
    expect(cells).not.toContain("0");
    // Card: qty "—" (and rate "—": a total-only line), amount ₹180.
    const card = within(screen.getByRole("list", { name: "Bill items" })).getByRole("listitem");
    expect(card.textContent).toBe("sabun₹180— × —");
  });

  it("VC023 mixed rate/total lines: TOTAL is the sum of the parsed line totals", () => {
    const lines = parsed("VC023");
    expect(lines).toHaveLength(2);
    renderBill(lines);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const expected = sumPaise(lines.map((l) => l.total as number));
    expect(screen.getByTestId("bill-total").textContent).toBe(formatRupees(expected));
    expect(formatRupees(expected)).toBe("₹690"); // 5 kg × ₹120 + ₹90
  });

  it("mic, Add item and Bill Banao are disabled until their tickets land", () => {
    renderBill(parsed("VC023"));
    expect((screen.getByRole("button", { name: /बोलने के लिए दबाएं/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Add item/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Bill Banao" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// Q4 (owner, 27 Sep 2026): no fixture yields an unpriced line yet (Layer 1
// never emits one), so the "—" amount rule is tested on the formatter here;
// the full-bill version comes with KB-305.
describe("billFormat", () => {
  it("unpriced amount is '—'; a real zero is ₹0 (13-DESIGN §6c)", () => {
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount(0)).toBe("₹0");
    expect(formatAmount(2250)).toBe("₹22.50");
  });

  it("rate suffix only for a real conversion (unitScale ±3)", () => {
    expect(formatRate(one("NB101"))).toBe("₹45/kg");
    expect(formatRate(one("VC015"))).toBe("₹60");
    expect(formatRate(one("VC013"))).toBe("—");
  });
});
