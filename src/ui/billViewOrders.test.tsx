// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ParsedItem } from "@/domain/grammar";
import { BillView } from "./BillingScreen";

// KB-385 step 5 (owner, 10 Nov 2026): on the bill screen - a price our code filled is marked "shop price" / "price said earlier" (card and
// table); the V3 recorder replaces the old Tap-to-speak; Bill Banao waits while a recording is not yet in the bill (counted as pending).

afterEach(cleanup);
const item = (spokenName: string, over: Partial<ParsedItem> = {}): ParsedItem => ({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate", ...over });
const lines = [
  { id: "l1", item: item("चीनी", { priceType: "default" }), displayName: "चीनी", source: "voice" as const, filled: "shop_price" as const },
  { id: "l2", item: item("बंसल तेल"), displayName: "बंसल तेल", source: "voice" as const, filled: "repeat" as const },
  { id: "l3", item: item("चावल"), displayName: "चावल", source: "voice" as const },
];
const editing = { onEdit: () => null, onRemove: () => {} };

describe("BillView with the V3 voice path", () => {
  it("marks each filled price on its own line, in the card list - and nothing on a spoken price", () => {
    render(<BillView lines={lines} onSignOut={() => {}} {...editing} />);
    const cards = within(screen.getByRole("list", { name: "Bill items" })).getAllByRole("listitem");
    expect(within(cards[0]!).getByText("shop price")).toBeTruthy();
    expect(within(cards[1]!).getByText("price said earlier")).toBeTruthy();
    expect(within(cards[2]!).queryByText(/shop price|price said earlier/)).toBeNull();
  });

  it("the order recorder replaces the old Tap to speak; the bill's recordings show under the lines", () => {
    render(<BillView lines={lines} onSignOut={() => {}} {...editing} orderBar={() => <button type="button">RECORDER</button>} orderEntries={() => <p>ENTRIES</p>} />);
    expect(screen.getByRole("button", { name: "RECORDER" })).toBeTruthy();
    expect(screen.getByText("ENTRIES")).toBeTruthy();
    expect(screen.queryByText("Tap to speak")).toBeNull();
  });

  it("a recording not in the bill counts as pending: Bill Banao waits", () => {
    render(<BillView lines={lines} onSignOut={() => {}} {...editing} pending={1} onFinalise={() => {}} orderBar={() => null} />);
    expect(screen.getByTestId("checks-pending")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bill Banao/ }).getAttribute("aria-disabled")).toBe("true");
  });
});
