import { describe, expect, it } from "vitest";
import { addMissingBlocks, buildOrders, canLock, SHEET_HEADER } from "./tools";
import type { OrdersFile } from "./store";

// KB-364: the tools between the phone's session file, the sheet and orders.json.

describe("addMissingBlocks", () => {
  it("a new sheet gets the header and a block for every one of the 50 slots, in order", () => {
    const s = addMissingBlocks("");
    expect(s.startsWith(SHEET_HEADER)).toBe(true);
    const ids = [...s.matchAll(/^## (A\d\d) (\S+)/gm)].map((m) => m[1]);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe("A01");
    expect(ids[49]).toBe("A50");
    expect(s).toMatch(/## A07 short-priceless/);
  });
  it("never touches a block the owner filled in - only missing ones are added", () => {
    const filled = `${SHEET_HEADER}## A01 short-priced\nsaid: दो किलो चीनी\n- 2 kg चीनी\nchecks: 0\n\n`;
    const s = addMissingBlocks(filled);
    expect(s.startsWith(filled)).toBe(true);
    expect([...s.matchAll(/^## (A\d\d)/gm)].map((m) => m[1])).toHaveLength(50);
    expect(s.match(/^## A01 /gm)).toHaveLength(1);
  });
  it("running it again changes nothing", () => {
    const once = addMissingBlocks("");
    expect(addMissingBlocks(once)).toBe(once);
  });
});

describe("buildOrders", () => {
  const sheet = `## A01 short-priced
said: दो किलो चीनी पैंतालीस रुपए किलो
- 2 kg चीनी @45
checks: 0

## A02 short-priced
said:

## A07 short-priceless
said: बेसन एक किलो
- 1 kg बेसन
`;
  it("keeps only the filled blocks; the category comes from the slot, not from the typed header", () => {
    const r = buildOrders(sheet.replace("## A07 short-priceless", "## A07 whatever"), { frozen: false, orders: [] });
    expect(r.errors).toEqual([]);
    expect(r.file!.orders.map((o) => [o.id, o.category, o.transcript])).toEqual([["A01", "short-priced", null], ["A07", "short-priceless", null]]);
    expect(r.pending).toEqual(["A02"]);
  });
  it("keeps a frozen transcript for an order that is still there, and the frozen flag", () => {
    const prev: OrdersFile = { frozen: true, orders: [{ id: "A01", category: "short-priced", said: "old", transcript: "2 किलो चीनी 45 रुपए किलो", expected: { lines: [], notAdded: 0, checks: 0 } }] };
    const r = buildOrders(sheet, prev);
    expect(r.file!.frozen).toBe(true);
    expect(r.file!.orders.find((o) => o.id === "A01")!.transcript).toBe("2 किलो चीनी 45 रुपए किलो");
    expect(r.file!.orders.find((o) => o.id === "A07")!.transcript).toBeNull();
  });
  it("a sheet error stops it - the previous orders.json is kept (never half-built)", () => {
    const r = buildOrders("## A01 x\nsaid: x\n- 2 चीनी\n", { frozen: false, orders: [] });
    expect(r.errors).toHaveLength(1);
    expect(r.file).toBeNull();
  });
  it("an id that is not one of the 50 slots is refused", () => {
    const r = buildOrders("## A77 x\nsaid: x\n- 1 kg चीनी\n", { frozen: false, orders: [] });
    expect(r.errors.join()).toMatch(/A77/);
    expect(r.file).toBeNull();
  });
});

describe("buildOrders - skipped blocks", () => {
  it("a SKIP block is not an order, is not 'pending', and is reported with its reason", () => {
    const r = buildOrders("## A01 x\nsaid: a\n- 1 kg चीनी\n## A02 x\nsaid: b\n# SKIP: Whisper heard other words\n- 1 kg चावल\n## A03 x\nsaid:\n", { frozen: false, orders: [] });
    expect(r.errors).toEqual([]);
    expect(r.file!.orders.map((o) => o.id)).toEqual(["A01"]);
    expect(r.pending).toEqual(["A03"]);
    expect(r.skipped).toEqual([{ id: "A02", reason: "Whisper heard other words" }]);
  });
});

describe("canLock - the set locks only after a PASSING run of the WHOLE set", () => {
  const ok = { passed: true, ranOrders: 41, ordersWithText: 41, min: 40 };
  it("a full passing run locks", () => {
    expect(canLock(ok)).toBe(true);
  });
  it("a passing run of ONE order (accept:live --only A14) never locks - it said 'LOCKED' after A14 on 30 Oct", () => {
    expect(canLock({ ...ok, ranOrders: 1 })).toBe(false);
  });
  it("a failing run never locks", () => {
    expect(canLock({ ...ok, passed: false })).toBe(false);
  });
  it("too few orders never lock", () => {
    expect(canLock({ passed: true, ranOrders: 39, ordersWithText: 39, min: 40 })).toBe(false);
  });
  it("orders with no frozen text do not count as covered", () => {
    expect(canLock({ passed: true, ranOrders: 40, ordersWithText: 41, min: 40 })).toBe(false);
  });
});
