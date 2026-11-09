// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import type { BillLine } from "@/data/voiceBilling";
import type { ParsedItem } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { DRAFT_SAVE_DELAY_MS, loadDraft } from "./billDraftStore";
import { useBillLines } from "./useBillLines";

// KB-385 step 5 (owner, 10 Nov 2026; D106 item 3): a price OUR CODE filled stays marked on its line ("filled, not spoken") - through the
// saved draft (a reload) - until the shopkeeper types the rate or the amount himself: then the price is his, and the mark goes.

const item = (over: Partial<ParsedItem>): ParsedItem => ({ spokenName: "चीनी", catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "default", ...over });
const lines: BillLine[] = [
  { item: item({}), displayName: "चीनी", source: "voice", filled: "shop_price" },
  { item: item({ spokenName: "चावल", priceType: "rate", rate: 6000, total: 6000, qty: 1 }), displayName: "चावल", source: "voice" },
];

describe("the 'filled, not spoken' mark on a bill line", () => {
  it("is carried onto the bill's row, and only on the filled line", () => {
    const { result } = renderHook(() => useBillLines(SEED_PARSER_CATALOG.entries));
    act(() => result.current.add(lines, [], "2 किलो चीनी, 1 किलो चावल 60 रुपए किलो"));
    expect(result.current.rows.map((r) => r.filled ?? null)).toEqual(["shop_price", null]);
  });

  it("survives the saved draft (a reload)", async () => {
    const db = new KiranaBillDB(`fm-${crypto.randomUUID()}`);
    const first = renderHook(() => useBillLines(SEED_PARSER_CATALOG.entries, { db, shopId: "s1" }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    act(() => first.result.current.add(lines, [], "x"));
    await waitFor(async () => expect((await loadDraft(db, "s1"))?.rows).toHaveLength(2), { timeout: DRAFT_SAVE_DELAY_MS * 8 });
    first.unmount();
    const again = renderHook(() => useBillLines(SEED_PARSER_CATALOG.entries, { db, shopId: "s1" }));
    await waitFor(() => expect(again.result.current.rows).toHaveLength(2));
    expect(again.result.current.rows.map((r) => r.filled ?? null)).toEqual(["shop_price", null]);
    db.close();
  });

  it("goes when the shopkeeper types the rate or the amount; a quantity edit keeps it (the price is still the shop's)", () => {
    const { result } = renderHook(() => useBillLines(SEED_PARSER_CATALOG.entries));
    act(() => result.current.add([lines[0]!, { ...lines[0]!, filled: "repeat" }], [], "x"));
    const [a, b] = result.current.rows;
    act(() => void result.current.edit(a!.id, "qty", "3"));
    expect(result.current.rows[0]!.filled).toBe("shop_price");
    act(() => void result.current.edit(a!.id, "rate", "50"));
    act(() => void result.current.edit(b!.id, "amount", "100"));
    expect(result.current.rows.map((r) => r.filled ?? null)).toEqual([null, null]);
  });
});
