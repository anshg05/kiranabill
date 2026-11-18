// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { parseUtterance, type ParsedItem } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { formatRupees, sumPaise } from "@/domain/money";
import { BillView } from "./BillingScreen";
import { formatAmount, formatRate } from "./billFormat";
import voiceCases from "../../eval/voice-cases.json";
import numberBenchmark from "../../eval/number-benchmark.json";
import { lineSheet } from "./testLineSheet";

// docs/07-DECISIONS.md D39: UI tests render REAL parseUtterance() output from
// the eval fixtures - never hand-built bills.

afterEach(cleanup);

const fixtures: { id: string; utterance: string }[] = [...voiceCases, ...numberBenchmark];

function parsed(id: string): ParsedItem[] {
  const fixture = fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  const items = parseUtterance(fixture.utterance, SEED_PARSER_CATALOG);
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

/** KB-413: a line's numbers as the screen shows them - the card's detail and amount, and every editor in its sheet (the unit picker
 *  read as its chosen value). Replaces the desktop table's row cells (the table is gone - D110 8.11). */
function lineNumbers(name: string): { detail: string; amount: string; qty: string; unit: string; rate: string; editAmount: string } {
  const card = within(within(screen.getByRole("list", { name: "Bill items" })).getAllByRole("listitem").find((c) => c.textContent!.includes(name))!);
  const amount = card.getByText(/^(₹|—)/, { selector: "div" }).textContent!;
  const detail = card.getByText((_, el) => el?.tagName === "SPAN" && /×|—|kg|gm|piece|packet|liter|ml/.test(el.textContent ?? "") && !el.querySelector("span")).textContent!;
  const sheet = lineSheet(name);
  const v = (f: string) => sheet.getByRole("button", { name: `${name} ${f}` }).textContent!;
  return { detail, amount, qty: v("quantity"), unit: (sheet.getByRole("combobox", { name: `${name} unit` }) as HTMLSelectElement).value, rate: v("rate"), editAmount: v("amount") };
}

function nbExpected(id: string) {
  const fixture = numberBenchmark.find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  return fixture.expected;
}

/** KB-413: one markup now - the card list (the phone layout everywhere, D110 8.11). */
function views() {
  return [within(screen.getByRole("list", { name: "Bill items" }))];
}

/** KB-303: the bill is always editable - lines carry ids, handlers are set. */
const editing = { onEdit: () => null, onRemove: () => {} };

function renderBill(lines: ParsedItem[]) {
  // Layer 1 lines, as the screen builds them (KB-302: BillLine).
  render(<BillView lines={lines.map((item, i) => ({ id: `l${i}`, item, displayName: item.spokenName, source: "fastpath" as const }))} {...editing} />);
}

describe("BillView", () => {
  it("KB-404 (S2): the Review mode badge shows only while review capture is on", () => {
    const { rerender } = render(<BillView lines={[]} {...editing} />);
    expect(screen.queryByTestId("review-badge")).toBeNull();
    rerender(<BillView lines={[]} {...editing} reviewMode />);
    expect(screen.getByTestId("review-badge").textContent).toBe("Review mode");
  });

  it("an empty bill totals ₹0 (genuinely zero, 13-DESIGN §6c)", () => {
    renderBill([]);
    expect(screen.getByTestId("bill-total").textContent).toBe("₹0");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("NB101 '500 gram chini': cross-unit rate shows its unit, exact total", () => {
    const expected = nbExpected("NB101");
    renderBill(parsed("NB101"));
    for (const v of views()) {
      expect(v.getByText(/× ₹45\/kg$/)).toBeTruthy(); // the card's detail: "500 gm × ₹45/kg"
      expect(v.getAllByText(formatRupees(expected.total as number)).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId("bill-total").textContent).toBe("₹22.50");
  });

  it("VC015 'Surf Excel ek packet': packet vs piece is no conversion - plain ₹60", () => {
    const line = one("VC015");
    expect([line.unit, line.rateUnit]).toEqual(["packet", "piece"]); // the case this rule exists for
    renderBill([line]);
    for (const v of views()) {
      expect(v.queryByText(/₹60\/piece/)).toBeNull();
      expect(v.getAllByText("₹60").length).toBeGreaterThan(0);
    }
  });

  it("VC013 '5 kg chawal 30 ka': total-only line - rate '—', amount ₹30", () => {
    renderBill(parsed("VC013"));
    expect(lineNumbers("chawal")).toEqual({ detail: "5 kg", amount: "₹30", qty: "5", unit: "kg", rate: "—", editAmount: "₹30" }); // no rate: the card shows only what it has
    expect(screen.getByTestId("bill-total").textContent).toBe("₹30");
  });

  it("VC016 'sabun 180 rupay': unknown qty shows '—', never 0", () => {
    const line = one("VC016");
    expect(line.qty).toBeNull();
    renderBill([line]);
    const n = lineNumbers("sabun");
    expect(n.detail).toBe("—"); // the card: qty "—", never 0 (and no rate: a total-only line)
    expect(Object.values(n)).not.toContain("0");
    expect([n.qty, n.rate, n.editAmount, n.amount]).toEqual(["—", "—", "₹180", "₹180"]); // the sheet's editors and the card's amount
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

  it("KB-302 (Q5b): a Layer 2 line shows the shop entry's name, not Gemini's spoken text", () => {
    const [item] = parsed("VC023");
    render(<BillView lines={[{ id: "l0", item: { ...item!, spokenName: "तूर दाल" }, displayName: "Toor Daal", source: "voice" }]} {...editing} />);
    expect(within(screen.getByRole("list", { name: "Bill items" })).getByText("Toor Daal")).toBeTruthy();
    expect(screen.queryByText("तूर दाल")).toBeNull();
  });

  it("without a finalise handler Bill Banao is not enabled (KB-307: aria-disabled, so a tap still lands); Add item is disabled while there is no shop catalog (KB-305)", () => {
    renderBill(parsed("VC023"));
    expect((screen.getByRole("button", { name: /Add item/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Bill Banao" }).getAttribute("aria-disabled")).toBe("true");
  });
});

// (KB-302's "BillView voice states" tested the OLD mic - deleted with the old voice path, 18 Nov 2026)

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

// 18 Nov 2026 (owner: "Keep, no Retry"): the old voice path is deleted, but a bill saved on a phone before that may still hold its
// "Not added" entries. They still show, with Add by hand and ✕ - and no Retry, since nothing is left to retry with. The saved-bill format
// is unchanged.
describe("an old 'Not added' entry, after the old voice path was deleted", () => {
  const entry = { id: "n1", transcript: "do kilo kuch naya", retrying: false, message: "Couldn't read the items — Retry below" };
  it("shows its words with Add by hand and ✕; no Retry", () => {
    const dismissed: string[] = [];
    render(<BillView lines={[]} {...editing} notAdded={[entry]} onDismiss={(id) => dismissed.push(id)} onAddByHand={() => {}} catalog={SEED_PARSER_CATALOG} />);
    const list = screen.getByRole("list", { name: /Not added/i });
    expect(within(list).getByText(/do kilo kuch naya/)).toBeTruthy();
    expect(within(list).queryByRole("button", { name: "Retry “do kilo kuch naya”" })).toBeNull();
    expect(within(list).getByRole("button", { name: "Add by hand “do kilo kuch naya”" })).toBeTruthy();
    within(list).getByRole("button", { name: "Dismiss “do kilo kuch naya”" }).click();
    expect(dismissed).toEqual(["n1"]);
  });
});
