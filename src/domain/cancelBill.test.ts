import { describe, expect, it } from "vitest";
import { parseUtterance } from "./grammar";
import { SEED_PARSER_CATALOG } from "./seedCatalog";
import { editRate } from "./billEdit";
import { buildFinalBill, type FinalLine } from "./finalBill";
import { CANCEL_REASONS, REASON_LABEL, cancelBlocker, isCancelReason, reissueRows } from "./cancelBill";

// KB-325 (D79): cancel and reissue. Pure rules: the five preset reasons, who can be cancelled, and how a stored bill
// becomes the lines of its replacement - exactly as stored, never a guessed number (hard rules 1, 5, 7).

describe("reasons - five presets, nothing typed", () => {
  it("the codes the server's CHECK accepts, each with a label", () => {
    expect([...CANCEL_REASONS]).toEqual(["wrong_item", "wrong_price", "wrong_quantity", "customer_cancelled", "other"]);
    expect(REASON_LABEL).toEqual({
      wrong_item: "Wrong item",
      wrong_price: "Wrong price",
      wrong_quantity: "Wrong quantity",
      customer_cancelled: "Customer cancelled",
      other: "Other",
    });
  });
  it("isCancelReason accepts only a preset", () => {
    expect(isCancelReason("wrong_price")).toBe(true);
    expect(isCancelReason("Wrong price")).toBe(false);
    expect(isCancelReason("")).toBe(false);
    expect(isCancelReason(undefined)).toBe(false);
    expect(isCancelReason("<script>")).toBe(false);
  });
});

describe("cancelBlocker - only a final bill, once", () => {
  it("a final bill with no cancellation may be cancelled", () => {
    expect(cancelBlocker({ status: "final" }, false)).toBeNull();
  });
  it("a draft, a cancelled bill, or one with a cancellation row may not", () => {
    expect(cancelBlocker({ status: "draft" }, false)).toBe("Only a saved bill can be cancelled");
    expect(cancelBlocker({ status: "cancelled" }, false)).toBe("This bill is already cancelled");
    expect(cancelBlocker({ status: "final" }, true)).toBe("This bill is already cancelled");
  });
});

describe("reissueRows - a stored bill's lines, exactly", () => {
  const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
    if (!r.ok) throw new Error(r.error);
    return r.item;
  };
  /** Stored items as finalise writes them, from real parser output. */
  function stored(...lines: { transcript: string; edit?: (i: FinalLine["item"]) => FinalLine["item"] }[]) {
    const finalLines: FinalLine[] = lines.flatMap((l, u) =>
      parseUtterance(l.transcript, SEED_PARSER_CATALOG)!.map((item) => ({
        id: `l${u}`, utteranceId: u, item: l.edit ? l.edit(item) : item, original: item,
        displayName: item.catalogId ? SEED_PARSER_CATALOG.byId.get(item.catalogId)!.displayName : item.spokenName, source: "fastpath" as const,
      })),
    );
    const built = buildFinalBill(finalLines, []);
    if (!built.ok) throw new Error(built.error);
    return built.items;
  }

  it("every line keeps its name, qty, unit, rate, rate unit, total and price type; the sum is the original total", () => {
    const items = stored({ transcript: "2 kilo cheeni 48 wala" }, { transcript: "500 gram besan" }, { transcript: "sabun 180 rupay" });
    const rows = reissueRows(items);
    expect(rows).toHaveLength(items.length);
    rows.forEach((row, i) => {
      const it = items[i]!;
      expect(row.displayName).toBe(it.displayName);
      expect(row.item).toMatchObject({ catalogId: it.shopProductId, qty: it.qty, unit: it.unit ?? "", rate: it.ratePaise, rateUnit: it.rateUnit, total: it.totalPaise, priceType: it.priceType });
    });
    expect(rows.reduce((s, r) => s + (r.item.total ?? 0), 0)).toBe(items.reduce((s, i) => s + i.totalPaise, 0));
  });

  it("an edited rate (₹48 on a ₹45 product) is carried as stored - never re-priced from today's catalog", () => {
    const items = stored({ transcript: "2 kilo cheeni", edit: (i) => ok(editRate(i, "48")) });
    const [row] = reissueRows(items);
    expect(row!.item.rate).toBe(4800);
    expect(row!.item.total).toBe(9600);
  });

  it("a total-only line stays total-only: no rate and no rate unit are invented", () => {
    const items = stored({ transcript: "sabun 180 rupay" });
    const [row] = reissueRows(items);
    expect(row!.item.rate).toBeNull();
    expect(row!.item.rateUnit).toBeNull();
    expect(row!.item.total).toBe(18_000);
  });

  it("a line with no product comes back as a custom line (no catalog id, matchStatus 'none')", () => {
    const [row] = reissueRows([{ displayName: "kuch naya", spokenName: "kuch naya", shopProductId: null, qty: 2, unit: "kg", ratePaise: 3000, rateUnit: "kg", totalPaise: 6000, priceType: "rate" }]);
    expect(row!.item).toMatchObject({ catalogId: null, isCustom: true, matchStatus: "none", spokenName: "kuch naya" });
  });

  it("an unpriced line stays unpriced - 'Price needed' comes back, nothing is made up", () => {
    const [row] = reissueRows([{ displayName: "ajwain", spokenName: "ajwain", shopProductId: null, qty: null, unit: null, ratePaise: null, rateUnit: null, totalPaise: 0, priceType: "unknown" }]);
    expect(row!.item).toMatchObject({ qty: null, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown" });
  });

  it("every reissued line is a MANUAL line: it is not speech, so it teaches no alias a second time (the cancelled bill already taught)", () => {
    const rows = reissueRows(stored({ transcript: "2 kilo चिनी" }));
    expect(rows.every((r) => r.source === "manual")).toBe(true);
  });

  it("no float and no division anywhere: every number is an integer paise or the stored qty", () => {
    const rows = reissueRows(stored({ transcript: "500 gram chini" }, { transcript: "2 kilo cheeni 48 wala" }));
    for (const r of rows) for (const p of [r.item.rate, r.item.total]) if (p !== null) expect(Number.isSafeInteger(p)).toBe(true);
  });
});
