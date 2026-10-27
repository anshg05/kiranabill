// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { LANGUAGES, MESSAGES, render as say, type Language, type MessageId } from "@/domain/messages";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import { finaliseBill } from "@/data/testNumbers";
import { cancelBillLocal } from "@/data/cancelBill";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import { AddProductSheet } from "./AddProductSheet";
import { CancelBillSheet } from "./CancelBillSheet";
import { CatalogScreen } from "./CatalogScreen";
import { EditProductSheet } from "./EditProductSheet";
import { HistoryScreen } from "./HistoryScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { ShopGate } from "@/app/App";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";
import type { RenderReceiptFiles } from "./useReceiptShare";

const shopState = vi.hoisted(() => ({ loading: false, shop: null as unknown, loadError: false, createShop: vi.fn(() => Promise.resolve()), retry: vi.fn() }));
vi.mock("@/providers/ShopProvider", () => ({ useShop: () => shopState, ShopProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve(), userId: "u", mode: "online", deviceDb: null, loading: false }), AuthProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/ui/BillingScreen", () => ({ BillingScreen: () => null }));

// KB-332 (D84), Checkpoint B: Catalog, History and Cancel, the product sheets, the import, the first-time shop set-up and the
// shop-load error, in the chosen language. Wording is read from the catalog (the owner reviews it on the real screens);
// what is proven here is that each screen USES it, that what must not change does not (product and customer names, numbers,
// units, "Cash", "Bill Banao"), and that the domain's English sentences are said in the chosen language.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
let online = true;
const renderFiles: RenderReceiptFiles = async () => ({ png: new Blob(["png"]), pdf: new Blob(["pdf"]) });
const T = (id: MessageId, l: Language, params: Record<string, string | number> = {}) => say(id, params, l);
const use = (l: Language) => act(() => setScreenLanguage(l));

const product = (displayName: string, over: Partial<LocalShopProduct> = {}): LocalShopProduct => ({
  id: crypto.randomUUID(), shopId, baseProductId: null, displayName, category: null, unit: "kg", pricePaise: 4_800, aliases: [displayName.toLowerCase()],
  source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...over,
});
const sugar = product("Sugar", { aliases: ["chini"], useCount: 9, source: "base" });
const oldSoap = product("Old Soap", { isActive: false, pricePaise: 3_000 });

beforeEach(async () => {
  stubLocalStorage();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  db = new KiranaBillDB(`ui-lang-b-${crypto.randomUUID()}`);
  await db.shopProducts.bulkPut([sugar, oldSoap]);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-14T00:00:00.000Z" });
  await db.syncState.put({ tableName: `bills:${shopId}`, lastSyncedAt: null, cursor: JSON.stringify({ phase: "done", before: null }), pendingCount: 0 });
});
afterEach(async () => {
  cleanup();
  act(() => setScreenLanguage("en"));
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30));
});

const ok = async (): Promise<CatalogWriteResult> => ({ ok: true });
async function openCatalog(l: Language) {
  use(l);
  render(<CatalogScreen localDb={db} shopId={shopId} save={ok} add={ok} saveDetails={ok} setActive={ok} create={ok} importRows={async () => ({ added: 0, alreadyThere: 0, failed: [], notSent: 0, stopReason: null })} onChanged={() => {}} onClose={() => {}} />);
  await screen.findByRole("list", { name: T("add.products", l) });
}

describe("the Catalog", () => {
  it.each(LANGUAGES)("heading, search, filters and buttons - in %s; product names, prices and units never change", async (l) => {
    await openCatalog(l);
    expect(screen.getByRole("heading", { name: T("menu.catalog", l) })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: T("add.search", l) })).toBeTruthy();
    expect(screen.getByPlaceholderText(T("catalog.searchPlaceholder", l))).toBeTruthy();
    const filters = within(screen.getByRole("radiogroup", { name: T("catalog.show", l) }));
    for (const id of ["catalog.all", "catalog.custom", "catalog.learned", "catalog.base", "catalog.archived"] as const) expect(filters.getByText(T(id, l))).toBeTruthy();
    for (const id of ["catalog.addReady", "product.addTitle", "catalog.import"] as const) expect(screen.getByRole("button", { name: T(id, l) })).toBeTruthy();
    // the row: name and price/unit exactly as stored, the use line and the Edit button said in the language
    const row = screen.getByTestId("name").closest("li")!;
    expect(within(row).getByText("Sugar")).toBeTruthy();
    expect(row.textContent).toContain("₹48 / kg");
    expect(within(row).getByLabelText(T("catalog.priceOf", l, { name: "Sugar" }))).toBeTruthy(); // the price control is named for a screen reader, in the language
    expect(within(row).getByText(T("catalog.usedMany", l, { n: 9 }))).toBeTruthy();
    expect(within(row).getByRole("button", { name: T("catalog.editLabel", l, { name: "Sugar" }) }).textContent).toBe(T("catalog.edit", l));
  });

  it.each(LANGUAGES)("an archived product offers Restore, and the empty states are said - in %s", async (l) => {
    await openCatalog(l);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: T("catalog.show", l) })).getByText(T("catalog.archived", l)));
    const restore = await screen.findByRole("button", { name: T("catalog.restoreLabel", l, { name: "Old Soap" }) });
    expect(restore.textContent).toBe(T("catalog.restore", l));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(await screen.findByText(T("catalog.noneFound", l))).toBeTruthy();
  });

  it.each(LANGUAGES)("offline: the one-line reason is said - in %s", async (l) => {
    online = false;
    await openCatalog(l);
    expect(screen.getAllByText(T("catalog.offline", l)).length).toBeGreaterThan(0);
  });

  it("the ready catalog says what it has to say", async () => {
    await db.baseProducts.bulkPut([{ id: crypto.randomUUID(), catalogVersion: 1, displayName: "Besan", sourceCategory: "grain", guardCategory: "grain", defaultUnit: "kg", suggestedPricePaise: 9_000, aliases: ["besan"], isActive: true }]);
    await openCatalog("hi");
    fireEvent.click(screen.getByRole("button", { name: T("catalog.addReady", "hi") }));
    expect(await screen.findByRole("heading", { name: T("ready.title", "hi") })).toBeTruthy();
    const add = await screen.findByRole("button", { name: T("ready.addLabel", "hi", { name: "Besan" }) });
    expect(add.textContent).toBe(T("common.add", "hi"));
    expect(screen.getByText("₹90 / kg")).toBeTruthy();
  });
});

describe("Add product and Edit product", () => {
  it.each(LANGUAGES)("Add product: labels, and the domain's refusals said in the language - in %s", async (l) => {
    use(l);
    render(<AddProductSheet existing={[]} online onCreate={ok} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: T("product.addTitle", l) })).toBeTruthy();
    expect(screen.getByText(T("product.price", l))).toBeTruthy();
    expect(screen.getByRole("button", { name: T("common.add", l) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: T("common.add", l) }));
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain(T("product.nameNeeded", l));
    expect(alerts).toContain(T("product.unitNeeded", l));
    expect(alerts).toContain(T("need.price", l));
    for (const chip of ["kg", "gm", "liter", "ml", "piece"]) expect(screen.getByRole("button", { name: chip })).toBeTruthy(); // units never change
  });

  it("a name already used names the product exactly as typed, in the language", () => {
    use("hl");
    render(<AddProductSheet existing={[{ id: "x", displayName: "Sugar", aliases: [], isActive: false }]} online onCreate={ok} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(T("product.name", "hl")), { target: { value: "Sugar" } });
    fireEvent.change(screen.getByLabelText(T("col.unit", "hl")), { target: { value: "kg" } });
    fireEvent.change(screen.getByLabelText(T("product.priceLabel", "hl")), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: T("common.add", "hl") }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(T("product.dupArchived", "hl", { name: "Sugar" }));
  });

  it("a server 'duplicate' and a failed save are said in the language", async () => {
    use("hi");
    render(<AddProductSheet existing={[]} online onCreate={async () => ({ ok: false, reason: "duplicate" })} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(T("product.name", "hi")), { target: { value: "Rusk" } });
    fireEvent.change(screen.getByLabelText(T("col.unit", "hi")), { target: { value: "pkt" } });
    fireEvent.change(screen.getByLabelText(T("product.priceLabel", "hi")), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: T("common.add", "hi") }));
    expect((await screen.findByRole("alert")).textContent).toBe(T("product.dup", "hi", { name: "Rusk" }));
  });

  it.each(LANGUAGES)("Edit product: labels, the unit note and a clash with another product - in %s", (l) => {
    use(l);
    render(<EditProductSheet product={sugar} others={[{ id: "o", displayName: "Atta", aliases: ["gehun"], isActive: true }]} online onSave={ok} onArchive={ok} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: T("product.editTitle", l) })).toBeTruthy();
    expect(screen.getByText(T("product.unitFixed", l, { unit: "kg" }))).toBeTruthy();
    expect(screen.getByRole("button", { name: T("product.archiveLabel", l) }).textContent).toBe(T("product.archive", l));
    fireEvent.change(screen.getByLabelText(T("product.name", l)), { target: { value: "Atta" } });
    expect(screen.getByRole("alert").textContent).toBe(T("product.dup", l, { name: "Atta" }));
    fireEvent.change(screen.getByLabelText(T("product.name", l)), { target: { value: "Sugar" } });
    fireEvent.change(screen.getByLabelText(T("product.otherNames", l)), { target: { value: "x\ngehun" } });
    expect(screen.getByLabelText(T("product.notSavedLabel", l)).textContent).toContain(T("product.aliasShort", l, { min: 3 }));
    expect(screen.getByLabelText(T("product.notSavedLabel", l)).textContent).toContain(T("product.aliasTaken", l));
  });

  it("offline, the sheet says why it cannot write", () => {
    use("hi");
    render(<EditProductSheet product={sugar} others={[]} online={false} onSave={ok} onClose={() => {}} />);
    expect(screen.getByText(T("catalog.offline", "hi"))).toBeTruthy();
  });
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));
async function saveBill() {
  const localId = crypto.randomUUID();
  const at = new Date();
  await finaliseBill(db, { localId, shopId, deviceId, startedAt: at.toISOString(), customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: at });
  return { localId, number: (await db.bills.get(localId))!.receiptNumber };
}

describe("History and Cancel", () => {
  const history = (props: Partial<React.ComponentProps<typeof HistoryScreen>> = {}) =>
    render(<HistoryScreen localDb={db} shopId={shopId} render={renderFiles} deviceId={deviceId} onClose={() => {}} {...props} />);

  it.each(LANGUAGES)("the list: heading, search, day label and the amount - in %s; bill number, customer and rupees never change", async (l) => {
    const { number } = await saveBill();
    use(l);
    history();
    expect(screen.getByRole("heading", { name: T("menu.history", l) })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: T("history.search", l) })).toBeTruthy();
    expect(screen.getByPlaceholderText(T("history.placeholder", l))).toBeTruthy();
    expect(await screen.findByText(T("history.today", l))).toBeTruthy();
    const row = within(screen.getByRole("list", { name: T("history.billsLabel", l) })).getAllByRole("button")[0]!;
    expect(row.textContent).toContain(number);
    expect(row.textContent).toContain("₹90");
  });

  it("the empty phone and a search with no result say so", async () => {
    use("hi");
    history();
    expect(await screen.findByText(T("history.empty", "hi"))).toBeTruthy();
    expect(screen.getByText(T("history.emptyHelp", "hi"))).toBeTruthy();
  });

  it.each(LANGUAGES)("the bill, Cancel bill, the reasons and the cancelled bill - in %s", async (l) => {
    const { localId, number } = await saveBill();
    use(l);
    history();
    fireEvent.click((await within(await screen.findByRole("list", { name: T("history.billsLabel", l) })).findAllByRole("button"))[0]!);
    const cancelButton = await screen.findByRole("button", { name: T("history.cancelButton", l) });
    fireEvent.click(cancelButton);
    const sheet = within(await screen.findByRole("region", { name: T("history.cancelButton", l) }));
    expect(sheet.getByRole("heading").textContent).toBe(T("cancel.title", l, { n: number }));
    expect(sheet.getByText(T("cancel.note", l))).toBeTruthy();
    for (const id of ["cancel.wrongItem", "cancel.wrongPrice", "cancel.wrongQuantity", "cancel.customerCancelled", "cancel.other"] as const) expect(sheet.getByText(T(id, l))).toBeTruthy();
    for (const id of ["cancel.andNew", "cancel.only", "cancel.keep"] as const) expect(sheet.getByRole("button", { name: T(id, l) })).toBeTruthy();
    fireEvent.click(sheet.getByText(T("cancel.wrongPrice", l)));
    fireEvent.click(sheet.getByRole("button", { name: T("cancel.only", l) }));
    const info = within(await screen.findByLabelText(T("history.cancellation", l)));
    await waitFor(() => expect(info.getByText(T("history.cancelledReason", l, { reason: T("cancel.wrongPrice", l) }))).toBeTruthy());
    expect(info.getByText(T("history.noReplacement", l))).toBeTruthy();
    expect((await db.bills.get(localId))!.status).toBe("cancelled");
  });

  it("Replaced by / Replaces name the other bill's number exactly", async () => {
    const a = await saveBill();
    const b = await saveBill();
    await cancelBillLocal(db, { shopId, billLocalId: a.localId, reason: "wrong_item", deviceId, replacementLocalId: b.localId });
    use("hl");
    history();
    const list = await screen.findByRole("list", { name: T("history.billsLabel", "hl") });
    fireEvent.click(within(list).getAllByRole("button").find((x) => x.querySelector(".font-medium")?.textContent?.endsWith(` ${a.number}`))!); // the title, not the row text (a time like 12:39 holds "1")
    expect(await screen.findByRole("button", { name: T("history.replacedBy", "hl", { n: b.number }) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: T("history.replacedBy", "hl", { n: b.number }) }));
    expect(await screen.findByRole("button", { name: T("history.replaces", "hl", { n: a.number }) })).toBeTruthy();
  });

  it("the sheet refuses in the language: a bill in progress, and a cancel that failed", async () => {
    use("hi");
    render(<CancelBillSheet receiptNumber="KB-7" billInProgress onCancel={async () => "Couldn't cancel the bill — try again"} onClose={() => {}} />);
    expect(screen.getByText(T("cancel.inProgress", "hi"))).toBeTruthy();
    fireEvent.click(screen.getByText(T("cancel.wrongItem", "hi")));
    fireEvent.click(screen.getByRole("button", { name: T("cancel.only", "hi") }));
    expect((await screen.findByRole("alert")).textContent).toBe(T("cancel.failed", "hi"));
  });
});

describe("the first-time shop set-up and the shop-load error", () => {
  it.each(LANGUAGES)("set-up: heading, fields, choices and the refusals - in %s", async (l) => {
    use(l);
    shopState.createShop.mockRejectedValueOnce(new Error("Setting up a shop needs an internet connection."));
    render(<OnboardingScreen />);
    expect(screen.getByRole("heading", { name: T("onboard.title", l) })).toBeTruthy();
    expect(screen.getByLabelText(T("settings.shopName", l))).toBeTruthy(); // KB-343: visible labels
    expect(screen.getByLabelText(T("onboard.phone", l))).toBeTruthy();
    expect(screen.getByText(T("onboard.question", l))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: T("onboard.ready", l) }));
    expect(screen.getByText(T("err.shopNameRequired", l))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(T("settings.shopName", l)), { target: { value: "Sharma Kirana" } });
    fireEvent.click(screen.getByRole("button", { name: T("onboard.empty", l) }));
    expect(await screen.findByText(T("onboard.offline", l))).toBeTruthy();
  });

  it.each(LANGUAGES)("the shop-load error and the loading line - in %s (English mode is English, not Hinglish)", (l) => {
    use(l);
    shopState.loadError = true;
    const { unmount } = render(<ShopGate />);
    expect(screen.getByText(T("app.serverDown", l))).toBeTruthy();
    expect(screen.getByRole("button", { name: T("retry.button", l) })).toBeTruthy();
    unmount();
    shopState.loadError = false;
    shopState.loading = true;
    render(<ShopGate />);
    expect(screen.getByText(T("app.loading", l))).toBeTruthy();
    shopState.loading = false;
  });
});

describe("what never changes", () => {
  it("every Checkpoint B entry has all three languages, and 'Cash' is never translated", () => {
    for (const id of Object.keys(MESSAGES) as MessageId[]) for (const l of LANGUAGES) expect(MESSAGES[id][l].trim(), `${id} ${l}`).not.toBe("");
    expect(JSON.stringify(MESSAGES)).not.toMatch(/नकद|Nakad/);
  });
});
