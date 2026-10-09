// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import type { ImportOutcome, ImportRow } from "@/data/catalogImport";
import { makeXlsx } from "@/data/testXlsx";
import { CatalogImportSheet } from "./CatalogImportSheet";
import { CatalogScreen } from "./CatalogScreen";
import { isUpdateSafe, resetUpdateGate, setGate } from "@/pwa/updateGate";

// KB-314 (D68, owner 10 Oct 2026): the import sheet over the Catalog. Pick a file -> a column mapping the shopkeeper can
// change -> a PREVIEW (new / already in your shop / problems, the units found, the aliases left out) -> confirm. It is
// ADD-ONLY and ONLINE-only; the writing itself is data/catalogImport.ts (its own e2e) - here it is a fake.

const shopId = "11111111-1111-4111-8111-111111111111";
const D = (...codes: number[]) => String.fromCharCode(...codes);
const product = (displayName: string, over: Partial<LocalShopProduct> = {}): LocalShopProduct => ({
  id: crypto.randomUUID(), shopId, baseProductId: null, displayName, category: null, unit: "kg", pricePaise: 4_800, aliases: [displayName.toLowerCase()],
  source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...over,
});

let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  cleanup();
  resetUpdateGate();
  vi.restoreAllMocks();
});

const ok = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({ added: 0, alreadyThere: 0, failed: [], notSent: 0, stopReason: null, ...over });

function setup(existing: LocalShopProduct[] = [], run?: (rows: ImportRow[], p: (d: number, t: number) => void) => Promise<ImportOutcome>) {
  const runner = vi.fn(run ?? (async (rows: ImportRow[]) => ok({ added: rows.length })));
  const onClose = vi.fn();
  render(<CatalogImportSheet existing={existing} online={online} run={runner} onClose={onClose} />);
  return { run: runner, onClose };
}
const csv = (text: string, name = "items.csv") => new File([text], name, { type: "text/csv" });
async function pick(file: File) {
  fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [file] } });
}
const GOOD = "Name,Price,Unit\nSugar,45,Kg\nSalt,20,kg\nTea,250,kg\n";
const confirm = () => screen.getByRole("button", { name: /^Add \d+ products?$/ });

describe("the sheet", () => {
  it("starts with the instructions, a file chooser and a sample CSV", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Import products" })).toBeTruthy();
    expect(screen.getByText(/first row must be the column names/i)).toBeTruthy();
    expect(screen.getByLabelText("Choose a file")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download sample CSV" })).toBeTruthy();
  });

  it("is a place an app update must never reload under (an overlay)", () => {
    setGate("idle billing screen", true);
    expect(isUpdateSafe()).toBe(true); // the screen under it is idle...
    setup();
    expect(isUpdateSafe()).toBe(false); // ...but an import in progress is not
  });

  it("the sample CSV downloads as UTF-8 with a byte-order mark, so Excel shows the Hindi", async () => {
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => ((blob = b), "blob:sample"));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Download sample CSV" }));
    expect(click).toHaveBeenCalled();
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader(); // jsdom's own Blob: Node's Response does not read it
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob!);
    }));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // text() would strip the BOM - the bytes show it
    expect(new TextDecoder().decode(bytes)).toContain("Name,Price,Unit");
  });
});

describe("the preview", () => {
  it("counts what will be added, what is already there and what is wrong - and shows the mapping it found", async () => {
    setup([product("Sugar")]);
    await pick(csv("Item name,Sale price,Unit,Stock\nSugar,50,kg,3\nSalt,20,kg,4\nTea,,kg,1\n"));
    expect((await screen.findByRole("status", { name: "Summary" })).textContent).toBe("1 to add · 1 already in your shop · 1 problem");
    expect((screen.getByLabelText("Name column") as HTMLSelectElement).selectedOptions[0]!.textContent).toMatch(/Item name/);
    expect((screen.getByLabelText("Price column") as HTMLSelectElement).selectedOptions[0]!.textContent).toMatch(/Sale price/);
    expect(screen.getByText(/Not used: Stock/)).toBeTruthy();
    expect(confirm().textContent).toBe("Add 1 product");
  });

  it("an already-there product shows the shop's price beside the file's, and says nothing is changed", async () => {
    setup([product("Chini", { pricePaise: 4_800, unit: "kg" })]);
    await pick(csv("Name,Price,Unit\nChini,50,gm\n"));
    const list = await screen.findByRole("list", { name: "Already in your shop" });
    expect(list.textContent).toContain("Chini");
    expect(list.textContent).toContain("₹48");
    expect(list.textContent).toContain("₹50");
    expect(list.textContent).toMatch(/not changed/i);
  });

  it("a decomposed Devanagari name and 'Chini  ' are matched to the shop's as already there", async () => {
    const composed = D(0x929) + D(0x92e);
    setup([product(composed), product("Chini")]);
    await pick(csv(`Name,Price,Unit\n${D(0x928, 0x93c, 0x92e)},10,piece\n"Chini  ",50,kg\n`));
    expect((await screen.findByRole("status", { name: "Summary" })).textContent).toBe("0 to add · 2 already in your shop · 0 problems");
  });

  it("a problem row says which line and why; only the first 20 are listed", async () => {
    setup();
    const bad = Array.from({ length: 25 }, (_, i) => `P${i},,kg`).join("\n");
    await pick(csv(`Name,Price,Unit\nGood,5,kg\n${bad}\n`));
    const list = await screen.findByRole("list", { name: "Problems" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(21); // 20 + the "and 5 more" line
    expect(list.textContent).toContain("Line 3");
    expect(list.textContent).toMatch(/Price needed/);
    expect(list.textContent).toMatch(/and 5 more/);
  });

  it("lists every distinct unit with its count, and flags one the app does not know", async () => {
    setup();
    await pick(csv("Name,Price,Unit\nA,1,Kg\nB,1,kilo\nC,1,Kgg\n"));
    const units = await screen.findByRole("list", { name: "Units found" });
    const items = within(units).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/kg.*2/);
    expect(items.join(" ")).toMatch(/kgg.*not a unit the app knows/i);
  });

  it("lists the aliases that were left out and why", async () => {
    setup([product("Salt")]);
    await pick(csv("Name,Price,Unit,Aliases\nSugar,45,kg,\"chini, salt, ch\"\n"));
    const list = await screen.findByRole("list", { name: "Aliases left out" });
    expect(list.textContent).toMatch(/salt/);
    expect(list.textContent).toMatch(/another product/);
    expect(list.textContent).toMatch(/ch\b.*shorter than 3/);
  });

  it("changing a column in the mapping recomputes the preview", async () => {
    setup();
    await pick(csv("Name,Cost,Rate,Unit\nSugar,1,45,kg\n"));
    const price = (await screen.findByLabelText("Price column")) as HTMLSelectElement;
    expect(price.selectedOptions[0]!.textContent).toMatch(/Rate/);
    expect(screen.getByRole("list", { name: "To add" }).textContent).toContain("₹45");
    fireEvent.change(price, { target: { value: "1" } });
    expect(screen.getByRole("list", { name: "To add" }).textContent).toContain("₹1");
  });

  it("a file without a Unit column cannot be added until one is chosen - nothing defaults", async () => {
    const { run } = setup();
    await pick(csv("Name,Price\nSugar,45\n"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Unit/);
    expect(screen.queryByRole("button", { name: /^Add \d+ products?$/ })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("shows text as text: a name with markup is not rendered as markup", async () => {
    setup();
    await pick(csv('Name,Price,Unit\n"<b>Bold</b> Sugar",45,kg\n'));
    const list = await screen.findByRole("list", { name: "To add" });
    expect(list.textContent).toContain("<b>Bold</b> Sugar");
    expect(list.querySelector("b")).toBeNull();
  });

  it("reads a real .xlsx workbook", async () => {
    setup();
    await pick(new File([makeXlsx([["Name", "Price", "Unit"], ["Sugar", 45.5, "kg"], ["Salt", 20, "kg"]])], "items.xlsx"));
    expect((await screen.findByRole("status", { name: "Summary" })).textContent).toBe("2 to add · 0 already in your shop · 0 problems");
  });

  it("a file that cannot be read says why and offers another try", async () => {
    setup();
    await pick(new File([new Uint8Array([0x4e, 0x0a, 0xe9, 0xff])], "bad.csv"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/UTF-8/);
    expect(screen.getByLabelText("Choose a file")).toBeTruthy();
  });
});

describe("adding", () => {
  it("sends only the NEW rows - name, paise, unit, category, aliases - and shows the result", async () => {
    const { run, onClose } = setup([product("Salt")]);
    await pick(csv("Name,Price,Unit,Category,Aliases\nSugar,45.50,Kg,Grocery,\"chini, cheeni\"\nSalt,99,kg,,\n"));
    fireEvent.click(await screen.findByRole("button", { name: "Add 1 product" }));
    await screen.findByRole("heading", { name: "Import finished" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual([{ name: "Sugar", pricePaise: 4_550, unit: "kg", category: "Grocery", aliases: ["chini", "cheeni"], sku: null, barcode: null }]);
    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("Added 1 · already there 0 · failed 0");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows progress while it runs, and nothing else can be pressed", async () => {
    let release: (o: ImportOutcome) => void = () => {};
    const { run } = setup([], (rows, progress) => new Promise<ImportOutcome>((resolve) => { progress(200, rows.length); release = resolve; }));
    await pick(csv(GOOD));
    fireEvent.click(await screen.findByRole("button", { name: "Add 3 products" }));
    expect((await screen.findByRole("status", { name: "Progress" })).textContent).toMatch(/Adding 200 of 3|Adding/);
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    release(ok({ added: 3 }));
    await screen.findByRole("heading", { name: "Import finished" });
  });

  it("a stopped run says where, and that running it again is safe", async () => {
    setup([], async () => ok({ added: 200, notSent: 50, stopReason: "23514: price_paise check" }));
    await pick(csv(GOOD));
    fireEvent.click(await screen.findByRole("button", { name: "Add 3 products" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/stopped/i);
    expect(alert.textContent).toMatch(/50/);
    expect(alert.textContent).toMatch(/again/i);
    expect(alert.textContent).toMatch(/skipped/i);
  });

  it("per-row failures are listed, first 20", async () => {
    const failed = Array.from({ length: 25 }, (_, i) => ({ name: `P${i}`, reason: "42501" }));
    setup([], async () => ok({ added: 1, failed }));
    await pick(csv(GOOD));
    fireEvent.click(await screen.findByRole("button", { name: "Add 3 products" }));
    const list = await screen.findByRole("list", { name: "Not added" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(21);
  });

  it("a run that throws is reported, not swallowed", async () => {
    setup([], async () => {
      throw new Error("network");
    });
    await pick(csv(GOOD));
    fireEvent.click(await screen.findByRole("button", { name: "Add 3 products" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't|try again/i);
  });

  it("offline: the preview works, adding does not", async () => {
    online = false;
    const { run } = setup();
    await pick(csv(GOOD));
    expect(await screen.findByText(/Needs internet to add products/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Add 3 products" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });

  it("with nothing to add there is no Add button - the shopkeeper is told why", async () => {
    setup([product("Sugar")]);
    await pick(csv("Name,Price,Unit\nSugar,45,kg\n"));
    await screen.findByRole("status", { name: "Summary" });
    expect(screen.queryByRole("button", { name: /^Add \d+ products?$/ })).toBeNull();
    expect(screen.getByText(/Nothing new to add/)).toBeTruthy();
  });
});

describe("in the Catalog", () => {
  let db: KiranaBillDB;
  beforeEach(async () => {
    db = new KiranaBillDB(`ui-import-${crypto.randomUUID()}`);
    await db.shopProducts.bulkPut([product("Sugar"), product("Old Soap", { isActive: false })]);
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  const open = async (run = vi.fn(async (rows: ImportRow[]) => {
    for (const r of rows) await db.shopProducts.put(product(r.name, { pricePaise: r.pricePaise, unit: r.unit }));
    return ok({ added: rows.length });
  }), onChanged = vi.fn()) => {
    render(<CatalogScreen localDb={db} shopId={shopId} save={vi.fn()} add={vi.fn()} importRows={run} onChanged={onChanged} onClose={vi.fn()} />);
    await screen.findByRole("list", { name: "Products" });
    return { run, onChanged };
  };

  it("has 'Import from file'; it opens the sheet over the Catalog", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Import from file" }));
    expect(await screen.findByRole("heading", { name: "Import products" })).toBeTruthy();
  });

  it("offline the button is disabled with the same note as the other catalog changes", async () => {
    online = false;
    await open();
    expect(screen.getByRole("button", { name: "Import from file" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("hidden (inactive) products count as 'already in your shop' - the database would refuse the name", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Import from file" }));
    await pick(csv("Name,Price,Unit\nOld Soap,30,piece\n"));
    const list = await screen.findByRole("list", { name: "Already in your shop" });
    expect(list.textContent).toMatch(/hidden/i);
  });

  it("after an import the Catalog shows the new products and the billing catalog is told to reload", async () => {
    const { run, onChanged } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Import from file" }));
    await pick(csv("Name,Price,Unit\nTea,250,kg\nSalt,20,kg\n"));
    fireEvent.click(await screen.findByRole("button", { name: "Add 2 products" }));
    await screen.findByRole("heading", { name: "Import finished" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Products" })).getAllByRole("listitem").map((li) => within(li).getByTestId("name").textContent)).toEqual(expect.arrayContaining(["Tea", "Salt", "Sugar"])));
  });

  it("an import that added nothing does not tell billing to reload", async () => {
    const { onChanged } = await open(vi.fn(async () => ok({ alreadyThere: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "Import from file" }));
    await pick(csv("Name,Price,Unit\nTea,250,kg\n"));
    fireEvent.click(await screen.findByRole("button", { name: "Add 1 product" }));
    await screen.findByRole("heading", { name: "Import finished" });
    expect(onChanged).not.toHaveBeenCalled();
  });
});
