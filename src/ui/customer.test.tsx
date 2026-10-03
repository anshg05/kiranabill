// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useEffect, type MutableRefObject } from "react";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { MOBILE_LENGTH, NAME_TOO_LONG } from "@/domain/customer";
import { parseTranscript } from "@/data/voiceApi";
import { BillView } from "./BillingScreen";
import { useBillLines, type BillLines } from "./useBillLines";
import { useOrderResolver } from "./useOrderResolver";

// KB-306 (owner, 3 Oct 2026; D6, D52): the customer on the bill - "Cash" by
// default, an optional mobile stored as 10 digits. Editable any time, before
// or after lines; never touches lines, totals, flags or pending; never asks,
// never blocks. Lines are REAL parser output (D39).

afterEach(cleanup);

const catalog = SEED_PARSER_CATALOG.entries;

function spoken(transcript: string) {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
  return {
    transcript,
    lines: items.map((item) => ({ item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const })),
    flags: [...evaluateReviewFlags(transcript, items, catalog)],
  };
}

function Harness({ pre = [], api }: { pre?: ReturnType<typeof spoken>[]; api?: MutableRefObject<BillLines | null> }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const u of pre) bill.add(u.lines, u.flags, u.transcript);
    // once, on mount
  }, []);
  if (api) api.current = bill;
  return (
    <BillView
      lines={bill.rows}
      onSignOut={() => {}}
      onEdit={bill.edit}
      onRemove={bill.remove}
      onUndo={bill.undo}
      removed={bill.removed}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      customer={bill.customer}
      onCustomerName={bill.setCustomerName}
      onCustomerMobile={bill.setCustomerMobile}
    />
  );
}

const nameButton = () => screen.getByRole("button", { name: "Customer name" });
const mobileButton = () => screen.getByRole("button", { name: "Customer mobile" });
function edit(button: HTMLElement, label: string, value: string, key = "Enter") {
  act(() => button.click());
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key });
}

describe("KB-306 - the customer row", () => {
  it("defaults to 'Cash' and '+ Mobile'; editable with no lines on the bill", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    expect(nameButton().textContent).toBe("Cash");
    expect(mobileButton().textContent).toBe("+ Mobile");
    edit(nameButton(), "Customer name", "Ramesh");
    expect(api.current!.customer).toEqual({ name: "Ramesh", mobile: null });
  });

  it("opening the name selects 'Cash', so typing replaces it", () => {
    render(<Harness />);
    act(() => nameButton().click());
    const input = screen.getByRole("textbox", { name: "Customer name" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(["Cash", 0, 4]);
  });

  it("an empty name goes back to 'Cash'; spaces are tidied", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    edit(nameButton(), "Customer name", "  Ramesh   Kumar ");
    expect(nameButton().textContent).toBe("Ramesh Kumar");
    edit(nameButton(), "Customer name", "");
    expect(nameButton().textContent).toBe("Cash");
    expect(api.current!.customer.name).toBe("Cash");
  });

  it("a name over 60 characters stays open with its reason; nothing stored", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    edit(nameButton(), "Customer name", "😀".repeat(61));
    expect(screen.getByRole("alert").textContent).toBe(NAME_TOO_LONG);
    expect(api.current!.customer.name).toBe("Cash");
  });

  it("mobile: '+91 98765 43210' and Devanagari digits store 10 digits, shown '98765 43210'", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    edit(mobileButton(), "Customer mobile", "+91 98765 43210");
    expect(api.current!.customer.mobile).toBe("9876543210");
    expect(mobileButton().textContent).toBe("98765 43210");
    edit(mobileButton(), "Customer mobile", "९८७६५४३२११");
    expect(api.current!.customer.mobile).toBe("9876543211");
  });

  it("an invalid mobile keeps the editor open with its reason and stores nothing; empty clears it", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    edit(mobileButton(), "Customer mobile", "12345");
    expect(screen.getByRole("alert").textContent).toBe(MOBILE_LENGTH);
    expect(api.current!.customer.mobile).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Customer mobile" }), { key: "Escape" });
    edit(mobileButton(), "Customer mobile", "9876543210");
    edit(mobileButton(), "Customer mobile", "");
    expect(api.current!.customer.mobile).toBeNull();
    expect(mobileButton().textContent).toBe("+ Mobile");
  });

  it("the mobile input is a phone field the browser never autofills (the shopkeeper's own number)", () => {
    render(<Harness />);
    act(() => mobileButton().click());
    const input = screen.getByRole("textbox", { name: "Customer mobile" }) as HTMLInputElement;
    expect([input.type, input.inputMode, input.autocomplete]).toEqual(["tel", "tel", "off"]);
    act(() => nameButton().click());
    expect((screen.getByRole("textbox", { name: "Customer name" }) as HTMLInputElement).autocomplete).toBe("off");
  });

  it("44 px targets", () => {
    render(<Harness />);
    expect(nameButton().className).toMatch(/min-h-11/);
    expect(mobileButton().className).toMatch(/min-h-11/);
  });
});

describe("KB-306 - the customer never touches the bill's lines", () => {
  it("real lines ('2 kilo chini', '1 kilo besan'): lines, total, flags and pending unchanged by the customer", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} pre={[spoken("2 kilo chini"), spoken("1 kilo besan")]} />);
    const before = { rows: api.current!.rows, flags: api.current!.flags, pending: api.current!.pending, total: screen.getByTestId("bill-total").textContent };
    edit(nameButton(), "Customer name", "Ramesh");
    edit(mobileButton(), "Customer mobile", "9876543210");
    expect(api.current!.rows).toBe(before.rows);
    expect(api.current!.flags).toEqual(before.flags);
    expect(api.current!.pending).toBe(before.pending);
    expect(screen.getByTestId("bill-total").textContent).toBe(before.total);
  });

  it("survives a line edit, a removal and Undo", () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} pre={[spoken("2 kilo chini")]} />);
    edit(nameButton(), "Customer name", "Ramesh");
    edit(mobileButton(), "Customer mobile", "9876543210");
    act(() => screen.getAllByRole("button", { name: "Chini quantity" })[0]!.click());
    const qty = screen.getAllByRole("textbox", { name: "Chini quantity" })[0]!;
    fireEvent.change(qty, { target: { value: "3" } });
    fireEvent.keyDown(qty, { key: "Enter" });
    act(() => screen.getAllByRole("button", { name: "Remove Chini" })[0]!.click());
    act(() => screen.getByRole("button", { name: "Undo" }).click());
    expect(api.current!.customer).toEqual({ name: "Ramesh", mobile: "9876543210" });
  });
});

describe("KB-306 - customer data never goes to /voice", () => {
  it("a Layer 2 parse after the customer is set carries neither the name nor the number", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as typeof fetch;
    const { result } = renderHook(() => {
      const bill = useBillLines(catalog);
      const resolver = useOrderResolver({ shop: SEED_PARSER_CATALOG, bill, parse: (t, s) => parseTranscript(t, { accessToken: "jwt", catalogSlice: s, fetchImpl }) });
      return { bill, resolver };
    });
    act(() => {
      result.current.bill.setCustomerName("Ramesh Kumar");
      result.current.bill.setCustomerMobile("9876543210");
    });
    await act(async () => {
      await result.current.resolver.onTranscript("2 kuch naya").catch(() => {});
    });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify([...((calls[0]![1] as RequestInit).body as FormData).entries()]) + JSON.stringify((calls[0]![1] as RequestInit).headers);
    expect(sent).not.toContain("Ramesh");
    expect(sent).not.toContain("9876543210");
  });
});
