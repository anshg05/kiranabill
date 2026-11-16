// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem } from "@/domain/billEdit";
import { BillView } from "./BillingScreen";
import { useBillLines } from "./useBillLines";

// KB-307 commit 2 fix (owner's real-Chrome check, 3 Oct 2026): a Bill Banao
// tap while checks are pending must land on the first pending item THAT IS ON
// SCREEN, scrolled into view, with a visible ring. Real cause: which markup
// (cards vs table) is visible was decided once at mount; when the window size
// changed after mount, focus went to an element inside the hidden markup -
// focusing a display:none element does nothing. jsdom has no CSS, so these
// tests simulate what's rendered through getClientRects (empty = not rendered).

const catalog = SEED_PARSER_CATALOG.entries;

function spoken(transcript: string) {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
  return {
    transcript,
    lines: items.map((item) => ({ item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const })),
    flags: [...evaluateReviewFlags(transcript, items, catalog)],
  };
}

function Harness({ pre, custom }: { pre: ReturnType<typeof spoken>[]; custom?: string }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const u of pre) bill.add(u.lines, u.flags, u.transcript);
    if (custom) bill.addByHand(customItem(custom), custom);
    // once, on mount
  }, []);
  return (
    <BillView
      lines={bill.rows}
      onEdit={bill.edit}
      onRemove={bill.remove}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      onFinalise={() => {}}
    />
  );
}

let scrolled: Element[] = [];

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  // The window was NARROW when the screen mounted (matchMedia: no match) ...
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("KB-307 fix - focus goes to the pending item that is actually on screen", () => {
  // KB-413: one layout now (the phone layout, centred - D110 8.11); the table these two checks were about is gone.
  it("the tap focuses the first 'Theek hai' on screen, scrolled into view", () => {
    render(<Harness pre={[spoken("1 kilo besan"), spoken("2 kilo chini 5 wala")]} />);
    act(() => screen.getByRole("button", { name: "Bill Banao" }).click());
    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute("aria-label")).toMatch(/^Theek hai — Chini/);
    expect(active.closest('[aria-label="Bill items"]')).not.toBeNull();
    expect(scrolled).toContain(active);
  });

  it("a missing amount: the Price needed line's own field, scrolled into view", () => {
    render(<Harness pre={[]} custom="kuch naya" />);
    if (screen.queryByRole("dialog")) fireEvent.keyDown(document, { key: "Escape" }); // the hand-added line's sheet
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => screen.getByRole("button", { name: "Bill Banao" }).click());
    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute("aria-label")).toBe("kuch naya amount");
    expect(active.tagName).toBe("INPUT");
    expect(scrolled).toContain(active);
  });

  it("a focused pending item gets a visible ring even when the browser shows no :focus-visible (focus moved by script after a tap)", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\[data-pending-target\]:focus\s*\{[^}]*outline:\s*3px solid/);
  });
});
