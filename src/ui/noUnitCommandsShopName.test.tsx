// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem, manualItem } from "@/domain/billEdit";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { KiranaBillDB } from "@/data/db";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";
import { useBillLines } from "./useBillLines";
import { COMMAND_CLEAR_HINT, COMMAND_FINISH_HINT, COMMAND_NOTHING_TO_REMOVE, runBillCommand } from "./voiceCommands";
import { useShopName } from "./useShopName";

// KB-338 (D86) '—' on every line's unit, KB-339 (D86) spoken commands run on the bill, KB-340 (D86) the shop's name in the header.
// Real parser output (D39).

afterEach(cleanup);
const catalog = SEED_PARSER_CATALOG.entries;
const chini = catalog.find((e) => e.displayName === "Chini")!;

function voice(transcript: string): { lines: BillLine[]; flags: ReturnType<typeof evaluateReviewFlags> } {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
  return {
    lines: items.map((item) => ({ item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const })),
    flags: evaluateReviewFlags(transcript, items, catalog),
  };
}

function Harness({ transcripts = [], hand = [] }: { transcripts?: string[]; hand?: ("chini" | "custom")[] }) {
  const bill = useBillLines(catalog);
  useEffect(() => {
    for (const t of transcripts) {
      const v = voice(t);
      bill.add(v.lines, v.flags);
    }
    for (const h of hand) {
      if (h === "chini") bill.addByHand(manualItem(chini), "Chini");
      else bill.addByHand(customItem("Kuch naya"), "Kuch naya");
    }
    // once, on mount
  }, []);
  return <BillView lines={bill.rows} onSignOut={() => {}} onEdit={bill.edit} onRemove={bill.remove} flags={bill.flags} pending={bill.pending} onAcknowledge={bill.acknowledge} />;
}

const table = () => within(screen.getByRole("table"));
const total = () => screen.getByTestId("bill-total").textContent;
const unitSelect = (name: string) => table().getByRole("combobox", { name }) as HTMLSelectElement;

function type(label: string, value: string) {
  act(() => table().getByRole("button", { name: label }).click());
  const input = table().getByRole("textbox", { name: label }) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("KB-338 - '—' (no unit) is a choice on EVERY line", () => {
  it("a voice line, an Add item line and a custom line each offer '—' (value '') in their unit picker", () => {
    render(<Harness transcripts={["5 kg chawal 30 ka", "2 kilo besan"]} hand={["chini", "custom"]} />);
    for (const name of ["Chini unit", "Chawal unit", "Besan unit", "Kuch naya unit"]) {
      const options = [...unitSelect(name).options].map((o) => o.value);
      expect(options).toContain("");
      expect(options.filter((v) => v === "")).toHaveLength(1);
    }
    expect([...unitSelect("Chini unit").options].map((o) => o.value)).toEqual(expect.arrayContaining(["", "kg", "gm"]));
  });

  it("picking '—' on a voice line changes no number: qty 2, the rate ₹45 and the amount ₹90 stay; the unit shows '—'", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    fireEvent.change(unitSelect("Chini unit"), { target: { value: "" } });
    expect(unitSelect("Chini unit").value).toBe("");
    expect(table().getByRole("button", { name: "Chini quantity" }).textContent).toBe("2");
    expect(table().getByRole("button", { name: "Chini rate" }).textContent).toBe("₹45");
    expect(total()).toBe("₹90");
  });

  it("then typing an amount works as in D85 - rate '—', qty stays; and the unit can be picked again", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    fireEvent.change(unitSelect("Chini unit"), { target: { value: "" } });
    type("Chini amount", "100");
    expect(total()).toBe("₹100");
    expect(table().getByRole("button", { name: "Chini rate" }).textContent).toBe("—");
    fireEvent.change(unitSelect("Chini unit"), { target: { value: "kg" } });
    expect(unitSelect("Chini unit").value).toBe("kg");
    expect(total()).toBe("₹100");
  });

  it("a line with no unit raises no check on its own (₹1 per '—' is the shopkeeper's own number)", () => {
    render(<Harness transcripts={["2 kilo chini"]} />);
    fireEvent.change(unitSelect("Chini unit"), { target: { value: "" } });
    type("Chini rate", "1");
    expect(screen.queryAllByText(/[1-9]\d* checks? pending/).filter((e) => !e.closest('[data-testid="flag-announcer"]'))).toEqual([]);
  });
});

describe("KB-339 - what a spoken command does to the bill", () => {
  it("'hatao' removes the LAST added line and the existing one-level Undo brings it back", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    for (const t of ["2 kilo chini", "5 kg chawal 30 ka"]) {
      const v = voice(t);
      act(() => result.current.add(v.lines, v.flags));
    }
    let notice: string | null = "x";
    act(() => {
      notice = runBillCommand("removeLast", result.current.rows, result.current.remove);
    });
    expect(notice).toBeNull(); // the Undo strip says it
    expect(result.current.rows.map((r) => r.displayName)).toEqual(["Chini"]);
    expect(result.current.removed?.displayName).toBe("Chawal");
    act(() => result.current.undo());
    expect(result.current.rows.map((r) => r.displayName)).toEqual(["Chini", "Chawal"]);
  });

  it("'hatao' on an empty bill: a short message, nothing happens", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    expect(runBillCommand("removeLast", result.current.rows, result.current.remove)).toBe(COMMAND_NOTHING_TO_REMOVE);
    expect(COMMAND_NOTHING_TO_REMOVE).toBe("Nothing to remove");
  });

  it("'bas' / 'ho gaya' never finalise: only the hint; 'sab hatao' never clears: only the hint to use the menu", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const v = voice("2 kilo chini");
    act(() => result.current.add(v.lines, v.flags));
    expect(runBillCommand("finalize", result.current.rows, result.current.remove)).toBe(COMMAND_FINISH_HINT);
    expect(runBillCommand("clearAll", result.current.rows, result.current.remove)).toBe(COMMAND_CLEAR_HINT);
    expect(COMMAND_FINISH_HINT).toBe("Tap Bill Banao to finish");
    expect(COMMAND_CLEAR_HINT).toBe("To clear the whole bill, use the menu → Clear bill");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.removed).toBeNull();
  });
});

describe("KB-340 - the shop's name in the billing header", () => {
  it("shows the name, truncated cleanly (one line, ellipsis, the full name as the title); 'KiranaBill' only when there is none", () => {
    const long = "Shri Ganesh General & Kirana Store, Sadar Bazaar, Gwalior";
    const { rerender } = render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} shopName={long} />);
    const h = screen.getByRole("heading", { level: 1 });
    expect(h.textContent).toBe(long);
    expect(h.getAttribute("title")).toBe(long);
    expect(h.className).toContain("truncate");
    expect(h.className).toContain("min-w-0");
    rerender(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("KiranaBill");
  });
});

describe("KB-340 - useShopName follows a rename", () => {
  const shopId = "11111111-1111-4111-8111-111111111111";
  let db: KiranaBillDB;
  beforeEach(async () => {
    db = new KiranaBillDB(`shopname-${crypto.randomUUID()}`);
    await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-18T00:00:00.000Z" });
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("starts from the shop in memory, reads the stored name, and re-reads it when asked (Settings saved a new one)", async () => {
    const { result, rerender } = renderHook(({ refresh }) => useShopName(db, shopId, "Old Name", refresh), { initialProps: { refresh: 0 } });
    expect(result.current).toBe("Old Name"); // before the read finishes
    await waitFor(() => expect(result.current).toBe("Sharma Kirana"));
    await db.shops.update(shopId, { name: "Verma General Store" });
    rerender({ refresh: 1 });
    await waitFor(() => expect(result.current).toBe("Verma General Store"));
  });

  it("with no database (signed out) it is just the fallback", () => {
    const { result } = renderHook(() => useShopName(null, undefined, "Name", 0));
    expect(result.current).toBe("Name");
  });
});
