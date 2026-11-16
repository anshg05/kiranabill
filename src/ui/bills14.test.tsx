// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { render as say } from "@/domain/messages";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/testNumbers";
import { cancelBillLocal } from "@/data/cancelBill";
import { HistoryScreen } from "./HistoryScreen";
import { setScreenLanguage } from "./screenLanguage";
import type { RenderReceiptFiles } from "./useReceiptShare";

// KB-414 step 2 (owner + reviewer, 16 Nov 2026; the approved plan): 14 Bills, 15 Bill detail, 25 Cancel in the new look. Everything
// today's History does stays (search, Show more, Search older bills, Not synced, the cancelled look, Replaced by / Replaces, the
// cancellation details, the conflict note); Reprint always prints REPRINT; the four tiles WhatsApp / PDF / Share / SMS as on 13; the
// cancel keeps the 5 reasons (one required), "Cancel & make corrected bill", "Cancel only" and "Keep". NOT built (parked, `12`):
// the date chips (SG-28), a print button per row (SG-29), "Show all N items" (SG-32), the unfinished-bill card (KB-423), the chart
// (KB-417). Every list and detail is read from the phone's database - a cold start (a fresh connection) shows the same.

const env = vi.hoisted(() => ({ native: false, print: vi.fn(async (_r: unknown) => true) }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));
vi.mock("./usePrint", () => ({ PRINT_FAILURE_TEXT: {}, usePrint: () => ({ state: { kind: "idle" }, print: env.print }) }));

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"]), pdf: new Blob(["pdf"]) });

beforeEach(async () => {
  env.native = false;
  env.print.mockClear();
  db = new KiranaBillDB(`ui-bills14-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-11-16T00:00:00.000Z" });
  await db.syncState.put({ tableName: `bills:${shopId}`, lastSyncedAt: null, cursor: JSON.stringify({ phase: "done", before: null }), pendingCount: 0 });
});
afterEach(async () => {
  cleanup();
  act(() => setScreenLanguage("en"));
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30));
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));
/** A real finalised bill at 1:18 pm today (or `at`). */
async function save(transcript = "2 kilo chini", customer = "Cash", at = today(13, 18)) {
  const localId = crypto.randomUUID();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: at.toISOString(), customer: { name: customer, mobile: null }, lines: lines(transcript), flags: [], now: at });
  return { localId, number: (await db.bills.get(localId))!.receiptNumber };
}
function today(h: number, m: number) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function open(over: Partial<Parameters<typeof HistoryScreen>[0]> = {}) {
  const props = { localDb: db, shopId, render: renderFiles, deviceId, onClose: vi.fn(), onReissue: vi.fn(), ...over };
  render(<HistoryScreen {...props} />);
  return props;
}
const list = () => screen.findByRole("list", { name: "Bills" });
const cards = async () => within(await list()).getAllByRole("button");
const card = async (n: string) => (await cards()).find((b) => b.querySelector("[data-bill-title]")?.textContent?.startsWith(`Bill ${n}`))!;
const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";
const detail = () => screen.findByRole("region", { name: "Bill" });

describe("14 Bills, as drawn", () => {
  it("the tab title 'Bills' (26 / 800), today's search field in the new look; no back arrow (the nav and Android Back go Home)", async () => {
    open();
    const h = await screen.findByRole("heading", { level: 1, name: "Bills" });
    expect(cls(h)).toContain("text-kb-26");
    expect(cls(h)).toContain("font-extrabold");
    const box = screen.getByRole("searchbox", { name: "Search bills" }) as HTMLInputElement;
    expect(box.placeholder).toBe("Name, amount, date (4/10), item, bill no.");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("NOT built (parked): no date chips, no print button per row, no unfinished-bill card, no 'Today · N bills' chart", async () => {
    await save();
    open();
    await list();
    for (const chip of ["Today", "Yesterday", "This week", "Pick dates"]) expect(screen.queryByRole("button", { name: chip })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Print/ })).toBeNull();
    expect(screen.queryByText(/Unfinished bill/)).toBeNull();
    expect(screen.queryByText(/· \d+ bills/)).toBeNull(); // "Today · 12 bills"
  });

  it("a bill card: the receipt tile, 'Bill N' (15 / 700), 'time · N items' (13 sub, the name unless Cash), the amount (16 / 800)", async () => {
    await save("2 kilo chini, 1 kilo besan", "Ramesh");
    await save("2 kilo chini");
    open();
    const ramesh = await card("1");
    const cash = await card("2");
    await waitFor(() => expect(ramesh.querySelector("[data-meta]")!.textContent).toBe("1:18 pm · 2 items · Ramesh"));
    await waitFor(() => expect(cash.querySelector("[data-meta]")!.textContent).toBe("1:18 pm · 1 item"));
    expect(cls(cash)).toContain("rounded-[16px]");
    expect(cls(cash)).toContain("border-kb-border");
    expect(cls(cash.querySelector("[data-bill-title]"))).toContain("text-kb-15");
    expect(cls(cash.querySelector("[data-bill-tile]"))).toContain("bg-kb-primary-pale");
    const amount = within(cash).getByText("₹90");
    expect(cls(amount)).toContain("text-kb-16");
    expect(cls(amount)).toContain("font-extrabold");
    // "1:18 pm" and "1 item" never break inside (Home's rule) - the line wraps only at the " · "
    for (const part of cash.querySelector("[data-meta]")!.children) expect(cls(part)).toContain("whitespace-nowrap");
  });

  it("the date groups stay (Today / Yesterday / dd-mm-yyyy) in the 26 §2.2 group label look", async () => {
    await save();
    const y = new Date(Date.now() - 86_400_000);
    y.setHours(12, 0, 0, 0);
    await save("1 kilo besan", "Cash", y);
    open();
    await list();
    const heads = screen.getAllByRole("heading", { level: 3 });
    expect(heads.map((h) => h.textContent)).toEqual(["Today", "Yesterday"]);
    expect(cls(heads[0])).toContain("uppercase");
  });

  it("a cancelled bill: the red 'Cancelled' pill by its number (text, not colour alone), the grey tile, the amount struck through", async () => {
    const a = await save();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_item", deviceId, replacementLocalId: null });
    open();
    const c = await card(a.number);
    const pill = within(c).getByText("Cancelled");
    expect(cls(pill)).toContain("bg-kb-err-pale");
    expect(cls(pill)).toContain("text-kb-err");
    expect(c.querySelector("[data-bill-title]")!.contains(pill)).toBe(true);
    expect(cls(c.querySelector("[data-bill-tile]"))).toContain("bg-kb-muted");
    expect(cls(within(c).getByText("₹90"))).toContain("line-through");
  });

  it("'Not synced' while a bill waits for the server - a small pill; none once synced", async () => {
    const a = await save();
    const b = await save("1 kilo besan");
    await db.bills.update(b.localId, { syncStatus: "synced" });
    open();
    expect(within(await card(a.number)).getByText("Not synced")).toBeTruthy();
    expect(within(await card(b.number)).queryByText("Not synced")).toBeNull();
  });

  it("Show more / Search older bills keep today's behaviour, as secondary buttons", async () => {
    await save();
    open();
    await list();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search bills" }), { target: { value: "chini" } });
    const older = await screen.findByRole("button", { name: "Search older bills" });
    expect(cls(older)).toContain("border-kb-border");
    expect(screen.getByText("Searching the last 90 days")).toBeTruthy();
  });

  it("a cold start: a fresh connection reads the list from the phone - the same cards, counts and marks", async () => {
    const a = await save("2 kilo chini, 1 kilo besan", "Ramesh");
    const b = await save();
    await cancelBillLocal(db, { shopId, billLocalId: b.localId, reason: "other", deviceId, replacementLocalId: null });
    const name = db.name;
    db.close();
    db = new KiranaBillDB(name);
    open();
    await waitFor(async () => expect((await card(a.number)).querySelector("[data-meta]")!.textContent).toBe("1:18 pm · 2 items · Ramesh"));
    expect(within(await card(b.number)).getByText("Cancelled")).toBeTruthy();
  });

  it("Hindi: the title, the search and the card words from the catalog", async () => {
    setScreenLanguage("hi");
    await save();
    open();
    await screen.findByRole("heading", { level: 1, name: say("history.billsLabel", {}, "hi") });
    const c = (await within(await screen.findByRole("list", { name: say("history.billsLabel", {}, "hi") })).findAllByRole("button"))[0]!;
    await waitFor(() => expect(c.querySelector("[data-meta]")!.textContent).toBe(say("bills.metaOne", { time: "1:18 pm" }, "hi")));
  });
});

describe("15 Bill detail, as drawn", () => {
  async function openDetail(n: string) {
    fireEvent.click(await card(n));
    return within(await detail());
  }

  it("the top bar: Back, 'Bill N' (18 / 700), the green Saved badge; under it 'date · time · N items · customer' (14 sub)", async () => {
    const a = await save("2 kilo chini, 1 kilo besan");
    open();
    const d = await openDetail(a.number);
    const h = await d.findByRole("heading", { level: 1, name: `Bill ${a.number}` }); // "Bill" until the receipt is read
    expect(cls(h)).toContain("text-kb-18");
    expect(cls(d.getByText("Saved"))).toContain("text-kb-ok");
    const day = today(13, 18).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    expect(d.getByText(`${day} · 1:18 pm · 2 items · Cash`)).toBeTruthy();
  });

  it("the whole receipt on 15's 340 px paper (no 'Show all N items' - parked SG-32)", async () => {
    const a = await save("2 kilo chini, 1 kilo besan, 1 kilo chawal, 1 kilo maida");
    open();
    const d = await openDetail(a.number);
    const receipt = await d.findByRole("article", { name: "Receipt" });
    expect(receipt.closest("[data-receipt-paper]")?.getAttribute("style") ?? "").toContain("340px");
    expect(d.queryByText(/Show all/)).toBeNull();
  });

  it("the four tiles as on 13 - WhatsApp, PDF, Share, SMS; no Bill Banao (read-only)", async () => {
    const a = await save();
    open();
    const d = await openDetail(a.number);
    for (const name of ["WhatsApp", "PDF", "Share", "SMS"]) expect(await d.findByRole("button", { name })).toBeTruthy();
    expect(d.queryByRole("button", { name: "Bill Banao" })).toBeNull();
  });

  it("in the Android app: 'Reprint' (the primary button) - EVERY copy prints REPRINT, the first too; not in the browser", async () => {
    const a = await save();
    open();
    let d = await openDetail(a.number);
    await d.findByRole("article", { name: "Receipt" });
    expect(d.queryByRole("button", { name: "Reprint" })).toBeNull(); // the browser / PWA: no printing
    cleanup();
    env.native = true;
    open();
    d = await openDetail(a.number);
    const reprint = await d.findByRole("button", { name: "Reprint" });
    expect(cls(reprint)).toContain("bg-kb-primary");
    fireEvent.click(reprint);
    await waitFor(() => expect(env.print).toHaveBeenCalledTimes(1));
    fireEvent.click(reprint);
    await waitFor(() => expect(env.print).toHaveBeenCalledTimes(2));
    expect(env.print.mock.calls.map((c) => (c[0] as { reprint?: string }).reprint)).toEqual(["REPRINT", "REPRINT"]);
  });

  it("'Cancel bill' is 15's red text button with the redo arrow; it opens 25; a cancelled bill has none", async () => {
    const a = await save();
    open();
    const d = await openDetail(a.number);
    const btn = await d.findByRole("button", { name: "Cancel bill" });
    expect(cls(btn)).toContain("text-kb-err");
    expect(btn.querySelector("svg")).toBeTruthy();
    fireEvent.click(btn);
    expect(await screen.findByRole("dialog", { name: `Cancel Bill ${a.number}?` })).toBeTruthy();
  });

  it("a cancelled bill: the red Cancelled badge in the top bar; the cancellation card (reason, date, no replacement) above the receipt", async () => {
    const a = await save();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_price", deviceId, replacementLocalId: null });
    open();
    const d = await openDetail(a.number);
    const info = await d.findByRole("region", { name: "Cancellation" });
    expect(info.textContent).toContain("Cancelled — Wrong price");
    expect(info.textContent).toContain("No replacement bill made");
    expect(cls(d.getAllByText("Cancelled")[0])).toContain("text-kb-err");
    expect(d.queryByText("Saved")).toBeNull();
    expect(info.compareDocumentPosition(d.getByRole("article", { name: "Receipt" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(d.queryByRole("button", { name: "Cancel bill" })).toBeNull();
  });

  it("a replaced bill and its replacement point at each other (links in the primary colour, 44+ px)", async () => {
    const a = await save();
    const replacement = crypto.randomUUID();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_item", deviceId, replacementLocalId: replacement });
    await finaliseBill(db, { localId: replacement, shopId, deviceId, startedAt: today(13, 30).toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("1 kilo besan"), flags: [], now: today(13, 30) });
    const newNumber = (await db.bills.get(replacement))!.receiptNumber;
    open();
    const d = await openDetail(a.number);
    const by = await d.findByRole("button", { name: `Replaced by Bill ${newNumber}` });
    expect(cls(by)).toContain("text-kb-primary");
    expect(cls(by)).toContain("min-h-11");
    fireEvent.click(by);
    const top = within(screen.getAllByRole("region", { name: "Bill" }).at(-1)!);
    expect(await top.findByRole("button", { name: `Replaces Bill ${a.number}` })).toBeTruthy();
  });

  it("a cold start: a fresh connection reads the detail from the phone - receipt, cancellation and its replacement link", async () => {
    const a = await save();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "other", deviceId, replacementLocalId: null });
    const name = db.name;
    db.close();
    db = new KiranaBillDB(name);
    open({ openBill: a.localId });
    const d = within(await detail());
    expect((await d.findByRole("article", { name: "Receipt" })).textContent).toContain("CANCELLED");
    expect((await d.findByRole("region", { name: "Cancellation" })).textContent).toContain("Cancelled — Other");
  });
});

describe("25 Cancel bill, as drawn", () => {
  async function openSheet() {
    const a = await save();
    const props = open();
    fireEvent.click(await card(a.number));
    fireEvent.click(await within(await detail()).findByRole("button", { name: "Cancel bill" }));
    const sheet = await screen.findByRole("dialog", { name: `Cancel Bill ${a.number}?` });
    return { a, props, sheet: within(sheet), el: sheet };
  }

  it("the bottom sheet: 'Cancel Bill N?' (22 / 800), today's note, the 5 reasons as chips (one required), the 'Why not just edit?' card", async () => {
    const { sheet } = await openSheet();
    expect(cls(sheet.getByRole("heading"))).toContain("text-kb-22");
    expect(sheet.getByText(say("cancel.note", {}, "en"))).toBeTruthy();
    const reasons = sheet.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels![0]!);
    expect(reasons.map((l) => l.textContent)).toEqual(["Wrong item", "Wrong price", "Wrong quantity", "Customer cancelled", "Other"]);
    for (const l of reasons) expect(cls(l)).toContain("rounded-full");
    expect(sheet.getByText("Why not just edit?")).toBeTruthy();
    expect(sheet.getByText(say("cancel.whyNotEdit", {}, "en"))).toBeTruthy();
  });

  it("a chosen reason is drawn as 25's selected chip (pale primary)", async () => {
    const { sheet } = await openSheet();
    fireEvent.click(sheet.getByRole("radio", { name: "Wrong price" }));
    const label = (sheet.getByRole("radio", { name: "Wrong price" }) as HTMLInputElement).labels![0]!;
    expect(cls(label)).toContain("has-checked:bg-kb-primary-pale");
  });

  it("the buttons: 'Cancel & make corrected bill' (red, redo arrow), 'Cancel only', 'Keep Bill N'; both cancels wait for a reason", async () => {
    const { a, sheet } = await openSheet();
    const corrected = sheet.getByRole("button", { name: "Cancel & make corrected bill" });
    const only = sheet.getByRole("button", { name: "Cancel only" });
    expect(cls(corrected)).toContain("bg-kb-err");
    expect(corrected.querySelector("svg")).toBeTruthy();
    for (const b of [corrected, only]) expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(sheet.getByText("Choose a reason first")).toBeTruthy();
    fireEvent.click(only);
    expect((await db.bills.get(a.localId))!.status).toBe("final");
    fireEvent.click(sheet.getByRole("button", { name: `Keep Bill ${a.number}` }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await db.billCancellations.count()).toBe(0);
  });

  it("Cancel & make corrected bill: cancelled with the reason and a replacement id handed to the billing screen", async () => {
    const { a, props, sheet } = await openSheet();
    fireEvent.click(sheet.getByRole("radio", { name: "Wrong item" }));
    fireEvent.click(sheet.getByRole("button", { name: "Cancel & make corrected bill" }));
    await waitFor(() => expect(props.onReissue).toHaveBeenCalledOnce());
    const row = (await db.billCancellations.get(a.localId))!;
    expect(row.reason).toBe("wrong_item");
    expect(props.onReissue).toHaveBeenCalledWith(a.localId, row.replacementLocalId);
  });

  it("taller than a short phone (a big text size): the sheet scrolls inside the screen - its title and buttons always reachable", async () => {
    const { el } = await openSheet();
    expect(cls(el)).toContain("max-h-[100dvh]");
    expect(cls(el)).toContain("overflow-y-auto");
  });

  it("a tap on the dimmed backdrop closes it, cancelling nothing", async () => {
    const { a, el } = await openSheet();
    fireEvent.pointerDown(el.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await db.bills.get(a.localId))!.status).toBe("final");
  });

  it("Hindi: the sheet's words from the catalog", async () => {
    setScreenLanguage("hi");
    const a = await save();
    open();
    fireEvent.click((await within(await screen.findByRole("list", { name: say("history.billsLabel", {}, "hi") })).findAllByRole("button"))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: say("history.cancelButton", {}, "hi") }));
    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.getByRole("button", { name: say("cancel.andNew", {}, "hi") })).toBeTruthy();
    expect(sheet.getByRole("button", { name: say("cancel.keep", { n: a.number }, "hi") })).toBeTruthy();
    expect(sheet.getByText(say("cancel.whyNotTitle", {}, "hi"))).toBeTruthy();
  });
});
