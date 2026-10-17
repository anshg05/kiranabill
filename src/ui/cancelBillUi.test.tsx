// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { cancelBillLocal } from "@/data/cancelBill";
import { HistoryScreen } from "./HistoryScreen";
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-325 (D79): cancel and reissue from the bill detail (S6). Real finalised bills (D39). The cancel is local first and
// works offline; History still lists a cancelled bill, marked; its receipt carries CANCELLED and stays shareable; the
// replacement and the cancelled bill point at each other (found by the cancellation's replacement_local_id - no bills
// column); a bill in permanent conflict says its cancellation is on this phone only.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"]), pdf: new Blob(["pdf"]) });

beforeEach(async () => {
  db = new KiranaBillDB(`ui-cancel-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-14T00:00:00.000Z" });
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 1000, nextNumber: 1, allocatedAt: "2026-10-14T00:00:00.000Z", syncStatus: "synced" });
  await db.syncState.put({ tableName: `bills:${shopId}`, lastSyncedAt: null, cursor: JSON.stringify({ phase: "done", before: null }), pendingCount: 0 });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30)); // a closed overlay takes its history entry off on the next tick
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));
async function save(transcript = "2 kilo chini", at = new Date()) {
  const localId = crypto.randomUUID();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: at.toISOString(), customer: { name: "Cash", mobile: null }, lines: lines(transcript), flags: [], now: at });
  return { localId, number: (await db.bills.get(localId))!.receiptNumber };
}

interface Opts {
  billInProgress?: boolean;
  onReissue?: ReturnType<typeof vi.fn<(billLocalId: string, replacementLocalId: string) => void>>;
}
async function open({ billInProgress = false, onReissue = vi.fn<(billLocalId: string, replacementLocalId: string) => void>() }: Opts = {}) {
  render(<HistoryScreen localDb={db} shopId={shopId} deviceId={deviceId} render={renderFiles} billInProgress={billInProgress} onReissue={onReissue} onClose={() => {}} />);
  await screen.findByRole("region", { name: "History" });
  await screen.findByRole("list", { name: "Bills" });
  return { onReissue };
}
const rowFor = (number: string) => within(screen.getByRole("list", { name: "Bills" })).getAllByRole("button").find((b) => b.textContent!.includes(number))!;
async function openBill(number: string) {
  fireEvent.click(rowFor(number));
  return within(await screen.findByRole("region", { name: "Bill" }));
}
const tap = (el: HTMLElement) => fireEvent.click(el);

describe("History lists a cancelled bill, marked", () => {
  it("a 'Cancelled' tag on the row (text, not colour alone) - and not on a valid bill", async () => {
    const a = await save();
    const b = await save("1 kilo besan");
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_item", deviceId, replacementLocalId: null });
    await open();
    expect(rowFor(a.number).textContent).toContain("Cancelled");
    expect(rowFor(b.number).textContent).not.toContain("Cancelled");
  });
});

describe("the bill detail - Cancel bill", () => {
  it("a saved bill has a 'Cancel bill' button; a cancelled one does not", async () => {
    const a = await save();
    const b = await save("1 kilo besan");
    await cancelBillLocal(db, { shopId, billLocalId: b.localId, reason: "wrong_item", deviceId, replacementLocalId: null });
    await open();
    expect(await (await openBill(a.number)).findByRole("button", { name: "Cancel bill" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Bill" })).toBeNull());
    await new Promise((r) => setTimeout(r, 30)); // the closed detail takes its history entry off on the next tick - let it land before the next opens
    const cancelledDetail = await openBill(b.number);
    await cancelledDetail.findByRole("region", { name: "Cancellation" }); // loaded
    expect(cancelledDetail.queryByRole("button", { name: "Cancel bill" })).toBeNull();
  });

  it("the sheet asks 'Cancel Bill <number>?' with five reason chips; both actions wait for a reason; closing it cancels nothing", async () => {
    const a = await save();
    await open();
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    expect(sheet.getByRole("heading").textContent).toBe(`Cancel Bill ${a.number}?`);
    expect(sheet.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels![0]!.textContent)).toEqual(["Wrong item", "Wrong price", "Wrong quantity", "Customer cancelled", "Other"]);
    expect(sheet.queryByRole("textbox")).toBeNull(); // nothing to type
    const both = [sheet.getByRole("button", { name: "Cancel and make a new bill" }), sheet.getByRole("button", { name: "Cancel only" })];
    for (const b of both) expect(b.getAttribute("aria-disabled")).toBe("true");
    tap(both[1]!);
    expect((await db.bills.get(a.localId))!.status).toBe("final"); // a disabled button does nothing
    tap(sheet.getByRole("button", { name: "Keep the bill" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Cancel bill" })).toBeNull());
    expect((await db.bills.get(a.localId))!.status).toBe("final");
    expect(await db.billCancellations.count()).toBe(0);
  });

  it("Cancel only: the bill is cancelled with the chosen reason and NO replacement; the detail says so", async () => {
    const a = await save();
    const { onReissue } = await open();
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    tap(sheet.getByRole("radio", { name: "Wrong price" }));
    tap(sheet.getByRole("button", { name: "Cancel only" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Cancel bill" })).toBeNull());
    const row = (await db.billCancellations.get(a.localId))!;
    expect(row).toMatchObject({ reason: "wrong_price", replacementLocalId: null, syncStatus: "pending", deviceId });
    expect((await db.bills.get(a.localId))!.status).toBe("cancelled");
    const info = await within(screen.getByRole("region", { name: "Bill" })).findByRole("region", { name: "Cancellation" });
    const day = new Date(row.cancelledAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    expect(info.textContent).toContain("Cancelled — Wrong price");
    expect(info.textContent).toContain(day);
    expect(info.textContent).toContain("No replacement bill made");
    expect(onReissue).not.toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "Bill" })).queryByRole("button", { name: "Cancel bill" })).toBeNull();
  });

  it("Cancel only: the shopkeeper STAYS on the cancelled bill, CANCELLED showing, with History still underneath (also after the history entries settle)", async () => {
    const a = await save();
    await open();
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    tap(sheet.getByRole("radio", { name: "Wrong item" }));
    tap(sheet.getByRole("button", { name: "Cancel only" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Cancel bill" })).toBeNull());
    await new Promise((r) => setTimeout(r, 150)); // the closed sheet takes its history entry off on the next tick - in a browser that is what used to close everything
    expect(screen.getByRole("region", { name: "Bill" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "History" })).toBeTruthy();
    expect(await within(screen.getByRole("region", { name: "Bill" })).findByTestId("receipt-cancelled")).toBeTruthy();
    // Back goes to History (one step), then closes it - never skips a level.
    fireEvent.click(within(screen.getByRole("region", { name: "Bill" })).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Bill" })).toBeNull());
    expect(screen.getByRole("region", { name: "History" })).toBeTruthy();
  });

  it("the cancelled receipt carries CANCELLED and the share buttons stay (always with that mark)", async () => {
    const a = await save();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "other", deviceId, replacementLocalId: null });
    await open();
    const detail = await openBill(a.number);
    expect((await detail.findByTestId("receipt-cancelled")).textContent).toBe("CANCELLED");
    expect(detail.getAllByRole("button").filter((b) => /whatsapp|sms|image|pdf/i.test(b.textContent ?? "")).length).toBeGreaterThanOrEqual(4);
    expect(detail.getByTestId("receipt-number").textContent).toBe(a.number); // the number stays on the list
  });

  it("a valid bill's receipt has no CANCELLED line", async () => {
    const a = await save();
    await open();
    const detail = await openBill(a.number);
    await detail.findByRole("article", { name: "Receipt" });
    expect(detail.queryByTestId("receipt-cancelled")).toBeNull();
  });

  it("works with no network at all: the cancel only writes this phone's database", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const a = await save();
    await open();
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    tap(sheet.getByRole("radio", { name: "Customer cancelled" }));
    tap(sheet.getByRole("button", { name: "Cancel only" }));
    await waitFor(async () => expect((await db.bills.get(a.localId))!.status).toBe("cancelled"));
  });

  it("if the bill was cancelled elsewhere meanwhile, the sheet says so and nothing is doubled", async () => {
    const a = await save();
    await open();
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "other", deviceId: "phone-b", replacementLocalId: null }); // another cycle applied it
    tap(sheet.getByRole("radio", { name: "Wrong item" }));
    tap(sheet.getByRole("button", { name: "Cancel only" }));
    expect((await sheet.findByRole("alert")).textContent).toBe("This bill is already cancelled");
    expect(await db.billCancellations.count()).toBe(1);
  });
});

describe("Cancel and make a new bill - the reissue", () => {
  it("cancels with the replacement's id, then hands it to the billing screen once", async () => {
    const a = await save();
    const { onReissue } = await open();
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    tap(sheet.getByRole("radio", { name: "Wrong quantity" }));
    tap(sheet.getByRole("button", { name: "Cancel and make a new bill" }));
    await waitFor(() => expect(onReissue).toHaveBeenCalledOnce());
    const [billId, replacementId] = onReissue.mock.calls[0]!;
    expect(billId).toBe(a.localId);
    expect(replacementId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.billCancellations.get(a.localId)).toMatchObject({ reason: "wrong_quantity", replacementLocalId: replacementId });
    expect((await db.bills.get(a.localId))!.status).toBe("cancelled");
  });

  it("with a bill already in progress the reissue is off (never wipes it) - 'Cancel only' still works", async () => {
    const a = await save();
    await open({ billInProgress: true });
    const detail = await openBill(a.number);
    tap(await detail.findByRole("button", { name: "Cancel bill" }));
    const sheet = within(await screen.findByRole("region", { name: "Cancel bill" }));
    tap(sheet.getByRole("radio", { name: "Other" }));
    const reissue = sheet.getByRole("button", { name: "Cancel and make a new bill" });
    expect(reissue.getAttribute("aria-disabled")).toBe("true");
    expect(sheet.getByText("A bill is in progress — finish it or clear it first to make the new bill.")).toBeTruthy();
    tap(reissue);
    expect((await db.bills.get(a.localId))!.status).toBe("final");
    expect(sheet.getByRole("button", { name: "Cancel only" }).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("the cancelled bill says 'Replaced by Bill <n>' once the replacement exists - tapping it opens that bill - and the new bill says 'Replaces Bill <n>'", async () => {
    const a = await save();
    const replacementId = crypto.randomUUID();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_price", deviceId, replacementLocalId: replacementId });
    await finaliseBill(db, { localId: replacementId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo cheeni 48 wala"), flags: [] });
    const rep = (await db.bills.get(replacementId))!.receiptNumber;
    await open();
    const detail = await openBill(a.number);
    const link = await detail.findByRole("button", { name: `Replaced by Bill ${rep}` });
    tap(link);
    await waitFor(() => expect(screen.getAllByRole("region", { name: "Bill" })[0]!.textContent).toContain(rep));
    const second = within(screen.getAllByRole("region", { name: "Bill" }).at(-1)!);
    expect(await second.findByRole("button", { name: `Replaces Bill ${a.number}` })).toBeTruthy();
    expect(second.queryByRole("region", { name: "Cancellation" })).toBeNull(); // the new bill is a normal bill
    expect((await second.findByTestId("receipt-replaces")).textContent).toBe(`Replaces Bill ${a.number}`); // printed on the receipt too (SG-13)
  });
});

describe("a bill whose own push is in permanent conflict", () => {
  it("can be cancelled on the phone; the detail says the cancellation is on this phone only - never silently 'done'", async () => {
    const a = await save();
    await db.bills.update(a.localId, { syncStatus: "conflict" });
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_price", deviceId, replacementLocalId: null });
    await open();
    expect(rowFor(a.number).textContent).toContain("Not synced");
    const detail = await openBill(a.number);
    const info = await detail.findByRole("region", { name: "Cancellation" });
    expect(info.textContent).toContain("This bill couldn't be saved to the server, so its cancellation is on this phone only.");
  });

  it("a normal cancelled bill that is still waiting to sync says 'will sync when you're online' - not the conflict text", async () => {
    const a = await save();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_price", deviceId, replacementLocalId: null });
    await open();
    const info = await (await openBill(a.number)).findByRole("region", { name: "Cancellation" });
    expect(info.textContent).toContain("Will reach your other phones when this one is online");
    expect(info.textContent).not.toContain("on this phone only");
  });
});
