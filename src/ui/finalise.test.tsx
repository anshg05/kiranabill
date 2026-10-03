// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type MutableRefObject } from "react";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem } from "@/domain/billEdit";
import { KiranaBillDB } from "@/data/db";
import { SAVE_FAILED } from "@/data/finalise";
import { BillView } from "./BillingScreen";
import { useBillLines, type BillLines } from "./useBillLines";
import { useFinalise } from "./useFinalise";

// KB-307 commit 2 (owner, 3 Oct 2026): Bill Banao. Enabled only with >=1 line
// AND pending = 0 ("Price needed" included); tapping it while not enabled
// focuses the first pending item; one atomic local write (real Dexie on
// fake-indexeddb); the saved screen shows the receipt number, read-only, with
// New bill; the mic or Add item there starts the next bill. Real parser output.

const catalog = SEED_PARSER_CATALOG.entries;
const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;

beforeEach(async () => {
  db = new KiranaBillDB(`ui-finalise-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Test", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "hi", receiptPrefix: "KB", updatedAt: "2026-10-03T00:00:00.000Z" });
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "2026-10-03T00:00:00.000Z", syncStatus: "synced" });
});
afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

function spoken(transcript: string) {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
  return {
    transcript,
    lines: items.map((item) => ({ item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const })),
    flags: [...evaluateReviewFlags(transcript, items, catalog)],
  };
}

interface Props {
  pre?: ReturnType<typeof spoken>[];
  api?: MutableRefObject<BillLines | null>;
  onMicTap?: () => void;
}

function Harness({ pre = [], api, onMicTap = () => {} }: Props) {
  const bill = useBillLines(catalog);
  const fin = useFinalise({ localDb: db, shopId, deviceId });
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
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      notAdded={bill.notAdded}
      onRetry={() => {}}
      onDismiss={bill.dismiss}
      onMicTap={onMicTap}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={bill.addByHand}
      focusLineId={bill.focusLineId}
      customer={bill.customer}
      onCustomerName={bill.setCustomerName}
      onCustomerMobile={bill.setCustomerMobile}
      onFinalise={() => void fin.finalise(bill.draft)}
      saving={fin.phase === "saving"}
      saved={fin.saved}
      saveError={fin.error}
      onNewBill={() => {
        bill.reset();
        fin.clear();
      }}
    />
  );
}

const billBanao = () => screen.getByRole("button", { name: "Bill Banao" });
const isDisabled = (b: HTMLElement) => b.getAttribute("aria-disabled") === "true";
const pendingText = () => screen.queryByTestId("checks-pending")?.textContent ?? null;
const cards = () => within(screen.getByRole("list", { name: "Bill items" }));

async function tapBillBanao() {
  await act(async () => {
    billBanao().click();
  });
}

describe("KB-307 - when Bill Banao is enabled", () => {
  it("an empty bill: not enabled; a tap does nothing", async () => {
    render(<Harness />);
    expect(isDisabled(billBanao())).toBe(true);
    await tapBillBanao();
    expect(await db.bills.count()).toBe(0);
  });

  it("priced lines and nothing pending: enabled", () => {
    render(<Harness pre={[spoken("1 kilo besan")]} />);
    expect(isDisabled(billBanao())).toBe(false);
  });

  it("an unacknowledged HIGH flag: not enabled; the tap focuses the first 'Theek hai' and saves nothing", async () => {
    render(<Harness pre={[spoken("1 kilo besan"), spoken("2 kilo chini 5 wala")]} />);
    expect(isDisabled(billBanao())).toBe(true);
    await tapBillBanao();
    expect(document.activeElement?.textContent).toBe("Theek hai");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Theek hai — Chini/);
    expect(screen.getByTestId("flag-announcer").textContent).toBe("2 checks pending.");
    expect(await db.bills.count()).toBe(0);
  });

  it("'Price needed' (decision 2): a custom item with no price is one pending check - no 'Theek hai', the tap focuses its amount", async () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} />);
    act(() => api.current!.addByHand(customItem("kuch naya"), "kuch naya"));
    fireEvent.keyDown(cards().getByRole("textbox", { name: "kuch naya quantity" }), { key: "Escape" });
    expect(cards().getByText("Price needed")).toBeTruthy();
    expect(pendingText()).toBe("1 check pending");
    expect(screen.queryAllByRole("button", { name: /^Theek hai/ })).toHaveLength(0);
    await tapBillBanao();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("kuch naya amount");
    expect(await db.bills.count()).toBe(0);
  });

  // A typed ₹0 is refused by KB-303 ("Must be more than ₹0"); the parser's Rule 5b
  // "ajwain" comes as total 0 with priceType unknown - that is NO price.
  it("real 'ajwain' (Rule 5b, total 0 = no price): 'Price needed', one check, not finalisable", async () => {
    render(<Harness pre={[spoken("ajwain")]} />);
    expect(cards().getByText("Price needed")).toBeTruthy();
    expect(pendingText()).toBe("1 check pending");
    expect(isDisabled(billBanao())).toBe(true);
    await tapBillBanao();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Ajwain amount");
    expect(await db.bills.count()).toBe(0);
  });

  it("a not-added utterance is pending too: the tap focuses its Retry", async () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} pre={[spoken("1 kilo besan")]} />);
    act(() => api.current!.fail("2 kuch naya"));
    expect(isDisabled(billBanao())).toBe(true);
    await tapBillBanao();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Retry “2 kuch naya”");
  });
});

describe("KB-307 - finalise and the saved screen", () => {
  it("saves one bill; the screen shows its receipt number, read-only, with New bill", async () => {
    render(<Harness pre={[spoken("1 kilo besan")]} />);
    await tapBillBanao();
    await waitFor(() => expect(screen.getByRole("status", { name: "Bill saved" }).textContent).toContain("KB-000001"));
    expect(await db.bills.count()).toBe(1);
    expect(screen.queryAllByRole("button", { name: "Besan quantity" })).toHaveLength(0); // read-only
    expect(screen.queryAllByRole("button", { name: "Remove Besan" })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Customer name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bill Banao" })).toBeNull();
    expect(screen.getByRole("button", { name: "New bill" })).toBeTruthy();
  });

  it("New bill: an empty bill, customer back to Cash, a new bill id", async () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} pre={[spoken("1 kilo besan")]} />);
    act(() => {
      api.current!.setCustomerName("Ramesh");
    });
    const firstId = api.current!.localId;
    await tapBillBanao();
    await waitFor(() => screen.getByRole("button", { name: "New bill" }));
    act(() => screen.getByRole("button", { name: "New bill" }).click());
    expect(api.current!.rows).toHaveLength(0);
    expect(api.current!.customer).toEqual({ name: "Cash", mobile: null });
    expect(api.current!.localId).not.toBe(firstId);
    expect(isDisabled(billBanao())).toBe(true);
  });

  it("the mic on the saved screen starts the next bill and records (owner, decision 4)", async () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    const onMicTap = vi.fn();
    render(<Harness api={api} pre={[spoken("1 kilo besan")]} onMicTap={onMicTap} />);
    await tapBillBanao();
    await waitFor(() => screen.getByRole("button", { name: "New bill" }));
    act(() => screen.getByRole("button", { name: /बोलने के लिए दबाएं/ }).click());
    expect(onMicTap).toHaveBeenCalledTimes(1);
    expect(api.current!.rows).toHaveLength(0);
    expect(screen.queryByRole("status", { name: "Bill saved" })).toBeNull();
  });

  it("Add item on the saved screen starts the next bill with the add panel open", async () => {
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} pre={[spoken("1 kilo besan")]} />);
    await tapBillBanao();
    await waitFor(() => screen.getByRole("button", { name: "New bill" }));
    act(() => screen.getByRole("button", { name: "Add item" }).click());
    expect(api.current!.rows).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Add item" })).toBeTruthy();
  });

  it("double tap on Bill Banao -> exactly one bill", async () => {
    render(<Harness pre={[spoken("1 kilo besan")]} />);
    await act(async () => {
      billBanao().click();
      billBanao().click();
    });
    await waitFor(() => screen.getByRole("button", { name: "New bill" }));
    expect(await db.bills.count()).toBe(1);
    expect((await db.receiptNumberBlocks.toArray())[0]!.nextNumber).toBe(2);
  });

  it("a save that fails: the message, the bill stays as it was and editable, nothing written", async () => {
    const fail = () => {
      throw new Error("simulated disk failure");
    };
    db.bills.hook("creating", fail);
    render(<Harness pre={[spoken("1 kilo besan")]} />);
    await tapBillBanao();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SAVE_FAILED));
    expect(screen.getAllByRole("button", { name: "Besan quantity" }).length).toBeGreaterThan(0);
    expect(isDisabled(billBanao())).toBe(false);
    expect(await db.bills.count()).toBe(0);
    db.bills.hook("creating").unsubscribe(fail);
  });
});
