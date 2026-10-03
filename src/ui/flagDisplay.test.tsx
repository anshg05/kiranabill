// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance, type ParsedItem } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { settleLayer2Items } from "@/domain/layer2";
import { checkLayer2NumberOrder, evaluateReviewFlags, type ReviewFlag } from "@/domain/reviewFlags";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";
import { useBillLines } from "./useBillLines";

// KB-304 - flag display + "Theek hai" (05-FRONTEND-SPEC.md §2 "Line flags",
// §8 rule 5, §9; 13-DESIGN §6b). D39: every line is REAL parser output - Layer
// 1 via parseUtterance, Layer 2 via the recorded Gemini shape settled exactly
// as data/voiceBilling.ts's Gemini path does.

afterEach(cleanup);

const catalog = SEED_PARSER_CATALOG.entries;
const nameOf = (item: ParsedItem) => (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName;

interface Utterance {
  transcript: string;
  lines: BillLine[];
  flags: ReviewFlag[];
}

/** Layer 1: real parseUtterance output + its flags. */
function layer1(transcript: string): Utterance {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG);
  if (!items) throw new Error(`"${transcript}" did not parse`);
  return { transcript, lines: items.map((item) => ({ item, displayName: nameOf(item), source: "fastpath" })), flags: [...evaluateReviewFlags(transcript, items, catalog)] };
}

/** Layer 2: what Gemini returned, settled and checked the way voiceBilling does. */
function layer2(transcript: string, gemini: ParsedItem[]): Utterance {
  const settled = settleLayer2Items(gemini, SEED_PARSER_CATALOG);
  const items = settled.lines.map((l) => l.item);
  const misaligned = checkLayer2NumberOrder(transcript, items);
  return {
    transcript,
    lines: settled.lines.map((l) => ({ ...l, source: "voice" })),
    flags: [...evaluateReviewFlags(transcript, items, catalog), ...settled.flags, ...(misaligned ? [misaligned] : [])],
  };
}

const gemini = (over: Partial<ParsedItem>): ParsedItem => ({
  spokenName: "x", catalogId: null, isCustom: false, matchStatus: "matched",
  qty: null, unit: "", rate: null, rateUnit: null, total: null, priceType: "default", ...over,
});

function Harness({ utterances }: { utterances: Utterance[] }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const u of utterances) bill.add(u.lines, u.flags, u.transcript);
    // once, on mount
  }, []);
  return (
    <BillView
      lines={bill.rows}
      onSignOut={() => {}}
      onEdit={bill.edit}
      onRemove={bill.remove}
      removed={bill.removed}
      onUndo={bill.undo}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
    />
  );
}

const table = () => within(screen.getByRole("table"));
const pending = () => screen.queryByTestId("checks-pending")?.textContent ?? null;
const announcer = () => screen.getByTestId("flag-announcer").textContent;

/** Type into the n-th value editor with this name (two lines may share a name). */
function typeNth(label: string, n: number, value: string) {
  act(() => table().getAllByRole("button", { name: label })[n]!.click());
  const input = table().getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const RT20 = "2 किलो आटा, 2 किलो आटा"; // the owner's real transcript - a repeated segment
const DUP = '"Chakki Aata" is on the bill twice, same quantity and price — said twice, or heard twice? Check.';

describe("KB-304 - HIGH: inline sentence, icon, 'Theek hai', blocks until acknowledged", () => {
  it("RT20 duplicate: the sentence and 'Theek hai' under line 2; 1 check pending", () => {
    render(<Harness utterances={[layer1(RT20)]} />);
    const flag = table().getByText(DUP).closest("[data-severity]") as HTMLElement;
    expect(flag.dataset.severity).toBe("HIGH");
    expect(flag.querySelector("svg")).not.toBeNull(); // icon + text - never colour alone
    expect(within(flag).getByRole("button", { name: `Theek hai — Chakki Aata: ${DUP}` })).toBeTruthy();
    expect(pending()).toBe("1 check pending");
  });

  it("'Theek hai': pending 0; the sentence stays visible, marked '✓ Theek hai'", () => {
    render(<Harness utterances={[layer1(RT20)]} />);
    act(() => table().getByRole("button", { name: /^Theek hai/ }).click());
    expect(pending()).toBeNull();
    const flag = table().getByText(DUP).closest("[data-severity]") as HTMLElement;
    expect(within(flag).getByText("✓ Theek hai")).toBeTruthy();
    expect(within(flag).queryByRole("button", { name: /^Theek hai/ })).toBeNull();
  });

  it("an edit to the line lapses its acknowledgement: qty 3 clears the duplicate; back to 2, it returns UN-acknowledged", () => {
    render(<Harness utterances={[layer1(RT20)]} />);
    act(() => table().getByRole("button", { name: /^Theek hai/ }).click());
    typeNth("Chakki Aata quantity", 1, "3");
    expect(table().queryByText(DUP)).toBeNull();
    typeNth("Chakki Aata quantity", 1, "2");
    expect(table().getByRole("button", { name: /^Theek hai/ })).toBeTruthy();
    expect(pending()).toBe("1 check pending");
  });

  it("Undo of a removed line restores its acknowledgement (same line, same numbers)", () => {
    render(<Harness utterances={[layer1("2 kilo chini 5 wala")]} />); // HIGH unusual_rate + unusual_total
    expect(pending()).toBe("2 checks pending");
    for (const b of table().getAllByRole("button", { name: /^Theek hai/ })) act(() => b.click());
    expect(pending()).toBeNull();
    act(() => table().getByRole("button", { name: "Remove Chini" }).click());
    act(() => within(screen.getByRole("status")).getByRole("button", { name: "Undo" }).click());
    expect(pending()).toBeNull();
    expect(table().getAllByText("✓ Theek hai")).toHaveLength(2);
  });
});

describe("KB-304 - bill-level flags: a block under the utterance's last line, with its transcript", () => {
  it("KI-45's recorded Gemini shape ('500 ग्राम जीरा' -> 0.5 gm): three HIGH bill-level checks under Surf Excel", () => {
    const ki45 = layer2("500 ग्राम जीरा और एक पैकेट सर्फ एक्सल", [
      gemini({ spokenName: "जीरा", catalogId: "104", qty: 0.5, unit: "gm", rate: 40000, rateUnit: "kg", total: 20 }),
      gemini({ spokenName: "सर्फ एक्सल", catalogId: "189", qty: 1, unit: "packet", rate: 6000, rateUnit: "piece", total: 6000 }),
    ]);
    expect(ki45.flags.filter((f) => f.itemIndex === null).map((f) => f.code).sort()).toEqual(["number_dropped", "number_misaligned", "qty_dropped"]);
    render(<Harness utterances={[ki45]} />);
    const rows = table().getAllByRole("row");
    expect(rows[2]!.textContent).toContain("Surf Excel");
    const block = rows[3]!;
    expect(block.textContent).toContain("Heard: “500 ग्राम जीरा और एक पैकेट सर्फ एक्सल”");
    expect(within(block).getAllByRole("button", { name: /^Theek hai/ })).toHaveLength(3);
    expect(pending()).toBe("3 checks pending");
  });

  it("number_misaligned (Gemini put the numbers on the wrong items): one HIGH bill-level check", () => {
    const swapped = layer2("2 kilo chini teen Parle-G 10 wala", [
      gemini({ spokenName: "chini", catalogId: "27", qty: 3, unit: "kg", rate: 4500, rateUnit: "kg", total: 13500 }),
      gemini({ spokenName: "Parle-G", catalogId: "52", qty: 2, unit: "piece", rate: 1000, rateUnit: "piece", total: 2000, priceType: "rate" }),
    ]);
    render(<Harness utterances={[swapped]} />);
    const block = table().getAllByRole("row")[3]!;
    expect(block.textContent).toContain("Couldn't match every number to its item");
    expect(pending()).toBe("1 check pending");
  });
});

describe("KB-304 - MEDIUM and LOW inform, never block; their sentence on tap", () => {
  it("MEDIUM already_on_bill: a REVIEW badge that reveals its reason; no check pending", () => {
    render(<Harness utterances={[layer1("1 kilo besan"), layer1("1 kilo besan")]} />);
    const badge = table().getByRole("button", { name: "REVIEW — Besan" });
    expect(badge.textContent).toBe("REVIEW");
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(table().queryByText(/already on the bill/)).toBeNull();
    act(() => badge.click());
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(table().getByText(/already on the bill/)).toBeTruthy();
    expect(pending()).toBeNull();
  });

  it("LOW unknown_product: a dot with an accessible name; its sentence only on tap (the numbers stay loudest)", () => {
    render(<Harness utterances={[layer1("2 kuch naya")]} />);
    const dot = table().getByRole("button", { name: "Note — kuch naya" });
    expect(dot.getAttribute("aria-expanded")).toBe("false");
    expect(table().queryByText(/isn't in your catalog yet/)).toBeNull();
    act(() => dot.click());
    expect(table().getByText(/isn't in your catalog yet/)).toBeTruthy();
    // The LOW note adds no check; the one pending check is the line's missing price (KB-307 decision 2).
    expect(pending()).toBe("1 check pending");
    expect(table().getByText("Price needed")).toBeTruthy();
  });
});

describe("KB-304 - screen-reader announcements", () => {
  it("a new HIGH flag is announced with the count; 'Theek hai' announces the new count", () => {
    render(<Harness utterances={[layer1(RT20)]} />);
    expect(screen.getByTestId("flag-announcer").getAttribute("aria-live")).toBe("polite");
    expect(announcer()).toBe(`Chakki Aata: ${DUP} 1 check pending.`);
    act(() => table().getByRole("button", { name: /^Theek hai/ }).click());
    expect(announcer()).toBe("Checked. 0 checks pending.");
  });
});

describe("KB-304 - the hook", () => {
  it("acknowledge(key) takes a HIGH flag out of the count; flags carry `acknowledged`", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const u = layer1(RT20);
    act(() => result.current.add(u.lines, u.flags, u.transcript));
    expect(result.current.pending).toBe(1);
    const flag = result.current.flags.find((f) => f.code === "duplicate_line")!;
    expect(flag.acknowledged).toBe(false);
    act(() => result.current.acknowledge(flag.key));
    expect(result.current.pending).toBe(0);
    expect(result.current.flags.find((f) => f.code === "duplicate_line")!.acknowledged).toBe(true);
  });
});
