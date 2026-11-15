// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ParsedItem } from "@/domain/grammar";
import type { ShownFlag } from "./useBillLines";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { BillView } from "./BillingScreen";

// KB-413 step 1 (owner-approved plan + answers, 15 Nov 2026): screen 12 "Bill review" in the new look - docs/design/screens/12-BillReview.html
// for the look, today's app for the content and every rule. Behaviour unchanged: checks, Theek hai, BLOCK, Bill Banao locked, Undo.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 30)); // the sheets' deferred history clean-up
});
const item = (spokenName: string, over: Partial<ParsedItem> = {}): ParsedItem => ({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate", ...over });
const row = (id: string, name: string, over: Partial<ParsedItem> = {}, filled?: "shop_price" | "repeat") => ({ id, item: item(name, over), displayName: name, source: "voice" as const, ...(filled ? { filled } : {}) });
const flag = (lineId: string, severity: ShownFlag["severity"], message: string, acknowledged = false): ShownFlag =>
  ({ id: `${lineId}-${severity}`, code: "unusual_rate", severity, message, itemIndex: 0, lineId, utteranceId: 1, anchorLineId: lineId, transcript: "", key: `${lineId}-${severity}`, acknowledged }) as ShownFlag;
const base = { onSignOut: () => {}, onEdit: () => null, onRemove: () => {} };
const firstCard = () => within(screen.getByRole("list", { name: "Bill items" })).getAllByRole("listitem")[0]!.firstElementChild!;

describe("screen 12: the frame", () => {
  it("'New bill' (owner, 15 Nov 2026 - replaces KB-340's shop name here), the Draft badge and the menu; NO back arrow until Home exists (owner, answer 1); the phone layout, centred, on any width (D110 8.11)", () => {
    const { container } = render(<BillView {...base} shopName="Gupta Kirana Store" lines={[row("l1", "चीनी")]} onOpenHistory={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("New bill");
    expect(screen.getByRole("heading", { level: 1 }).className).toMatch(/text-kb-18/);
    expect(screen.getByText("Draft · not saved").className).toMatch(/bg-kb-muted/);
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector("[class*='max-w-[480px]']")).toBeTruthy();
  });

  it("the Heard card(s) first, then the customer row (owner, answer 2), then the lines, the recordings still waiting, then the dashed Add item", () => {
    render(
      <BillView {...base} lines={[row("l1", "चीनी")]} customer={{ name: "Cash", mobile: null }} onCustomerName={() => null} onCustomerMobile={() => null}
        catalog={SEED_PARSER_CATALOG} onAddByHand={() => {}} orderEntries={(_add, part) => (part === "heard" ? <p>HEARD</p> : <p>PENDING</p>)} />,
    );
    const text = document.body.textContent!;
    const at = (s: string) => text.indexOf(s);
    expect(at("HEARD")).toBeGreaterThan(-1);
    expect(at("HEARD")).toBeLessThan(at("Customer"));
    expect(at("Customer")).toBeLessThan(at("चीनी"));
    expect(at("चीनी")).toBeLessThan(at("PENDING"));
    expect(at("PENDING")).toBeLessThan(at("Add item"));
    expect(screen.getByRole("button", { name: "Add item" }).className).toMatch(/border-dashed/);
  });
});

describe("screen 12: the lines", () => {
  it("a line is the kit's bill line: name as said, '2 kg × ₹45', the mark, the amount, the edit button", () => {
    render(<BillView {...base} lines={[row("l1", "चीनी", {}, "shop_price")]} />);
    const card = within(screen.getByRole("list", { name: "Bill items" })).getAllByRole("listitem")[0]!;
    expect(within(card).getByText("2 kg × ₹45")).toBeTruthy();
    expect(within(card).getByText("your price")).toBeTruthy();
    expect(within(card).getByText("₹90")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Edit चीनी" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "चीनी quantity" })).toBeNull(); // the editors live in the sheet (answer 9)
  });

  it("the edit button opens a sheet with today's editors: quantity, unit, rate, amount, Change item, Remove (owner, answer 9)", () => {
    const onRemove = vi.fn();
    render(<BillView {...base} onRemove={onRemove} lines={[row("l1", "चीनी")]} catalog={SEED_PARSER_CATALOG} onChangeProduct={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit चीनी" }));
    const sheet = screen.getByRole("dialog", { name: "Edit चीनी" });
    for (const name of ["चीनी quantity", "चीनी rate", "चीनी amount", "Change item चीनी", "Remove चीनी"]) expect(within(sheet).getByRole("button", { name })).toBeTruthy();
    // owner, 15 Nov 2026: the button SAYS "Change item" (the name is in the sheet's title); its accessible name keeps the item
    expect(within(sheet).getByRole("button", { name: "Change item चीनी" }).textContent).toBe("Change item");
    expect(within(sheet).getByRole("combobox", { name: "चीनी unit" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove चीनी" }));
    expect(onRemove).toHaveBeenCalledWith("l1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Undo stays after a remove (unchanged)", () => {
    const onUndo = vi.fn();
    render(<BillView {...base} lines={[]} removed={{ displayName: "चीनी" } as never} onUndo={onUndo} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("a line with no price is the Price needed line: its own labelled amount field, Add commits it, refused values say why; it is where Bill Banao sends focus", () => {
    const onEdit = vi.fn((_id: string, _field: string, v: string) => (v === "0" ? "Type an amount above ₹0" : null));
    render(<BillView {...base} onEdit={onEdit} lines={[row("l1", "दाने", { qty: 1, rate: null, rateUnit: null, total: null, priceType: "default" })]} pending={1} onFinalise={() => {}} />);
    expect(screen.getByText("Price needed")).toBeTruthy();
    const field = screen.getByLabelText("दाने amount") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Type an amount above ₹0");
    fireEvent.change(field, { target: { value: "150" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEdit).toHaveBeenLastCalledWith("l1", "amount", "150");
    fireEvent.click(screen.getByRole("button", { name: /Bill Banao/ }));
    expect(document.activeElement).toBe(field);
  });
});

describe("screen 12: the check cards (owner, answer 8 - for approval on the sheet)", () => {
  it("HIGH: the warn card with the reason and Theek hai; once checked the line looks normal", () => {
    const onAcknowledge = vi.fn();
    const lines = [row("l1", "चीनी")];
    const { rerender } = render(<BillView {...base} lines={lines} flags={[flag("l1", "HIGH", "Unusual price for चीनी")]} pending={1} onAcknowledge={onAcknowledge} />);
    expect(firstCard().className).toMatch(/bg-kb-warn-bg/);
    fireEvent.click(screen.getByRole("button", { name: /Theek hai/ }));
    expect(onAcknowledge).toHaveBeenCalled();
    rerender(<BillView {...base} lines={lines} flags={[flag("l1", "HIGH", "Unusual price for चीनी", true)]} pending={0} onAcknowledge={onAcknowledge} />);
    expect(firstCard().className).toMatch(/bg-kb-card/);
  });

  it("BLOCK: the error card, NO Theek hai (only an edit clears it); Bill Banao stays locked", () => {
    render(<BillView {...base} lines={[row("l1", "चीनी")]} flags={[flag("l1", "BLOCK", "₹18,000 for 2 kg is far too high")]} pending={1} onFinalise={() => {}} />);
    expect(firstCard().className).toMatch(/bg-kb-err-pale/);
    expect(screen.queryByRole("button", { name: /Theek hai/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Bill Banao/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("MEDIUM and LOW inform inside a normal card and never lock anything", () => {
    render(<BillView {...base} lines={[row("l1", "चीनी")]} flags={[flag("l1", "MEDIUM", "Check the item"), flag("l1", "LOW", "A note")]} onFinalise={() => {}} />);
    expect(firstCard().className).toMatch(/bg-kb-card/);
    expect(screen.getByRole("button", { name: /Bill Banao/ }).getAttribute("aria-disabled")).not.toBe("true");
    // the REVIEW pill and the note dot sit 8 px apart: their row says so, so their tap areas stop half way (owner, 15 Nov 2026)
    expect(screen.getByRole("button", { name: /^REVIEW/ }).parentElement!.parentElement!.className).toContain("[--kb-gap-x:8px]");
  });
});

describe("screen 12: the bottom panel", () => {
  it("'Total so far · N items', the pending line in warn text, the 30 / 800 total; Bill Banao locked says why (the pending line)", () => {
    render(<BillView {...base} lines={[row("l1", "चीनी"), row("l2", "चावल")]} pending={1} onFinalise={() => {}} />);
    expect(screen.getByText("Total so far · 2 items")).toBeTruthy();
    const why = screen.getByTestId("checks-pending");
    expect(why.className).toMatch(/text-kb-warn-text/);
    expect(screen.getByTestId("bill-total").className).toMatch(/text-kb-30/);
    const banao = screen.getByRole("button", { name: /Bill Banao/ });
    expect(banao.getAttribute("aria-disabled")).toBe("true");
    expect(banao.getAttribute("aria-describedby")).toBe(why.id);
    expect(banao.className).toMatch(/bg-kb-disabled-bg/);
  });

  it("clear to save: Bill Banao is the primary button and saves", () => {
    const onFinalise = vi.fn();
    render(<BillView {...base} lines={[row("l1", "चीनी")]} onFinalise={onFinalise} />);
    const banao = screen.getByRole("button", { name: /Bill Banao/ });
    expect(banao.className).toMatch(/bg-kb-primary/);
    act(() => banao.click());
    expect(onFinalise).toHaveBeenCalledOnce();
  });
});

// Owner, 15 Nov 2026: when everything Bill Banao waits for is ONE kind, the panel says that kind, as 12 draws it.
describe("screen 12: what Bill Banao waits for, in words", () => {
  const noPrice = (id: string, name: string) => row(id, name, { qty: 1, rate: null, rateUnit: null, total: null, priceType: "default" });
  const noQty = (id: string, name: string) => row(id, name, { qty: null, unit: "", total: null, rate: 4500, priceType: "rate" });
  it("one line without a price: '1 item needs a price'; two: '2 items need a price'", () => {
    const { rerender } = render(<BillView {...base} lines={[noPrice("a", "दाने")]} pending={1} onFinalise={() => {}} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("1 item needs a price");
    rerender(<BillView {...base} lines={[noPrice("a", "दाने"), noPrice("b", "चना")]} pending={2} onFinalise={() => {}} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("2 items need a price");
  });
  it("only quantities missing: '1 item needs a quantity'", () => {
    render(<BillView {...base} lines={[noQty("a", "दाने")]} pending={1} onFinalise={() => {}} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("1 item needs a quantity");
  });
  it("mixed kinds (a price and a Theek hai): 'N checks pending'", () => {
    render(<BillView {...base} lines={[noPrice("a", "दाने"), row("b", "चीनी")]} flags={[flag("b", "HIGH", "Check")]} pending={2} onFinalise={() => {}} />);
    expect(screen.getByTestId("checks-pending").textContent).toBe("2 checks pending");
  });
  it("in Hindi and Hinglish too (the catalog)", async () => {
    const { render: say } = await import("@/domain/messages");
    expect([say("need.priceOne", {}, "hi"), say("need.priceMany", { n: 2 }, "hi"), say("need.priceOne", {}, "hl"), say("need.qtyOne", {}, "hi")])
      .toEqual(["1 सामान का भाव चाहिए", "2 सामान का भाव चाहिए", "1 saaman ka bhaav chahiye", "1 सामान की मात्रा चाहिए"]);
  });
});

// Owner + reviewer, 15 Nov 2026 (step-2 fix 1): a recorder warning (mic refused, nothing recorded) sits in the bill's scrolling list, like a
// failed recording - the sticky panel keeps "More" and Bill Banao on one row, as 12 draws it.
describe("screen 12: the recorder's warnings are in the list, not the bottom panel", () => {
  it("mic refused: the warning row is in the scrolling list; More and Bill Banao share the panel's one row", async () => {
    const { OrderRecorder } = await import("./VoiceOrderPanel");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))) } });
    vi.stubGlobal("MediaRecorder", class {});
    try {
      render(
        <BillView {...base} lines={[row("l1", "चीनी")]} pending={0} onFinalise={() => {}}
          orderBar={(openAdd, noteSlot) => <OrderRecorder hasLines onGenerate={() => {}} onAddByHand={openAdd} noteSlot={noteSlot} />} />,
      );
      await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add more by voice" })));
      const warning = screen.getByText(/Mic permission denied/);
      expect(warning.closest("[class*='overflow-y-auto']")).toBeTruthy();
      expect(warning.closest("[class*='shadow-kb-panel']")).toBeNull();
      const more = screen.getByRole("button", { name: "Add more by voice" });
      const banao = screen.getByRole("button", { name: "Bill Banao" });
      expect(more.closest("[class*='flex-wrap']")).toBe(banao.closest("[class*='flex-wrap']"));
      expect(more.parentElement!.className).not.toContain("w-full");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("the warning scrolls into view as it appears, as a failed recording does (it may start below the fold at 130% text)", async () => {
    const { OrderRecorder } = await import("./VoiceOrderPanel");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))) } });
    vi.stubGlobal("MediaRecorder", class {});
    const scrolled: Element[] = [];
    const spy = vi.fn(function (this: Element, opts?: ScrollIntoViewOptions) { if (opts?.block === "end") scrolled.push(this); });
    Element.prototype.scrollIntoView = spy;
    try {
      render(
        <BillView {...base} lines={[row("l1", "चीनी")]} pending={0} onFinalise={() => {}}
          orderBar={(openAdd, noteSlot) => <OrderRecorder hasLines onGenerate={() => {}} onAddByHand={openAdd} noteSlot={noteSlot} />} />,
      );
      scrolled.length = 0;
      await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add more by voice" })));
      const warning = screen.getByText(/Mic permission denied/);
      expect(scrolled.some((el) => el.contains(warning))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

